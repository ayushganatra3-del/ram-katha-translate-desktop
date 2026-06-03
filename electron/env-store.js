'use strict';

/**
 * env-store.js
 * --------------------------------------------------------------------------
 * Single source of truth for the worker's configuration.
 *
 *  - SCHEMA           : declarative description of every setting (drives both
 *                       the Settings UI and the validators).
 *  - getDefaults()    : default config object derived from the schema.
 *  - loadEnv(dir)     : read {dir}/worker.env, merged over defaults.
 *  - saveEnv(dir,obj) : write {dir}/worker.env (grouped, with section comments).
 *  - validateConfig() : lightweight "config validator" used on Settings save.
 *  - toWorkerEnv()    : build the final env map passed to the spawned worker,
 *                       merging saved settings with per-session selections.
 *
 * This module has NO dependency on Electron so it can be unit-tested in plain
 * Node. The Electron main process passes in app.getPath('userData').
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ENV_FILENAME = 'worker.env';

/**
 * Declarative configuration schema. Mirrors Part 3 of the build spec.
 * `appOnly` fields are stored in worker.env for the app's own use but are NOT
 * forwarded to the worker process as environment variables.
 */
const SCHEMA = [
  {
    id: 'worker',
    title: 'Worker Location (developer override)',
    description:
      'Packaged builds bundle the worker automatically — you never need this. In development only, point at an external worker repo (must contain src/index.js). Leave blank to use the bundled electron/worker.',
    fields: [
      {
        key: 'WORKER_PATH',
        label: 'Worker Path (dev only)',
        type: 'path',
        appOnly: true,
        default: '',
        placeholder: 'C:\\Users\\you\\morari-translate\\worker',
        help: 'Optional. Overrides the bundled worker during development.',
      },
    ],
  },
  {
    id: 'supabase',
    title: 'Supabase',
    description: 'Database holding live captions, session state and the canonical corpus.',
    fields: [
      {
        key: 'SUPABASE_URL',
        label: 'Supabase URL',
        type: 'text',
        required: true,
        default: 'https://haysrsrrqowqucfqdalq.supabase.co',
      },
      {
        key: 'SUPABASE_SERVICE_ROLE_KEY',
        label: 'Service Role Key',
        type: 'password',
        sensitive: true,
        required: true,
        placeholder: 'eyJhbGciOi...',
      },
    ],
  },
  {
    id: 'session',
    title: 'Session',
    description: 'Set per event. Can also be set on the Setup screen before starting.',
    fields: [
      {
        key: 'SESSION_CODE',
        label: 'Session Code',
        type: 'text',
        uppercase: true,
        placeholder: 'GSJZ76',
        help: '4–8 letters/numbers, e.g. GSJZ76.',
      },
    ],
  },
  {
    id: 'sarvam',
    title: 'Sarvam STT',
    description: 'Speech-to-text provider. For live katha captioning this must be Sarvam.',
    fields: [
      {
        key: 'STT_PROVIDER',
        label: 'STT Provider',
        type: 'text',
        required: true,
        default: 'sarvam',
        help: 'Must be "sarvam".',
      },
      {
        key: 'SARVAM_API_KEY',
        label: 'Sarvam API Key',
        type: 'password',
        sensitive: true,
        required: true,
      },
      { key: 'SARVAM_MODEL', label: 'Sarvam Model', type: 'text', default: 'saaras:v3' },
      { key: 'SARVAM_LANGUAGE_CODE', label: 'Language Code', type: 'text', default: 'hi-IN' },
    ],
  },
  {
    id: 'translation',
    title: 'OpenRouter Translation',
    description: 'Translation runs through OpenRouter (not OpenAI directly).',
    fields: [
      {
        key: 'OPENAI_API_KEY',
        label: 'OpenRouter API Key',
        type: 'password',
        sensitive: true,
        required: true,
        placeholder: 'sk-or-v1-...',
      },
      {
        key: 'OPENAI_BASE_URL',
        label: 'Base URL',
        type: 'text',
        required: true,
        default: 'https://openrouter.ai/api/v1',
      },
      {
        key: 'DEFAULT_MODEL',
        label: 'Default Model',
        type: 'text',
        required: true,
        default: 'google/gemini-2.5-flash',
      },
      { key: 'TRANSLATOR_MODE', label: 'Translator Mode', type: 'text', default: 'context' },
    ],
  },
  {
    id: 'features',
    title: 'Features',
    description: 'Tuning flags for locked-work mode and canonical matching.',
    fields: [
      {
        key: 'LOCKED_WORK_MODE',
        label: 'Locked-Work Mode',
        type: 'select',
        default: 'on',
        options: ['on', 'off'],
      },
      {
        key: 'SOURCE_CONTEXT_WINDOW_MS',
        label: 'Source Context Window (ms)',
        type: 'number',
        default: '30000',
        help: '30000 (30s) keeps translator input tokens under the ~2000 ceiling that warned at 60s.',
      },
      {
        key: 'CANONICAL_MATCH_MIN_TRIGGER_LEN',
        label: 'Canonical Min Trigger Length',
        type: 'number',
        default: '8',
      },
      {
        key: 'MINIMAL_PIPELINE',
        label: 'Minimal Pipeline (debug)',
        type: 'select',
        default: 'off',
        options: ['off', 'on'],
        help: 'On = STT → translate → display only (bypasses canonical, corpus and locked-work). For verification only.',
      },
    ],
  },
  {
    id: 'fallback',
    title: 'Emergency Fallback',
    description:
      'Optional. If OpenRouter is unavailable, switch the OpenRouter Translation fields above to a fallback provider. Example values:',
    note:
      'OPENAI_BASE_URL = https://api.quatarly.cloud/v1\n' +
      'OPENAI_API_KEY = qua-sub-...\n' +
      'DEFAULT_MODEL = gemini-3-flash',
    fields: [],
  },
];

/** Flat list of every field across all sections. */
function allFields() {
  return SCHEMA.reduce((acc, section) => acc.concat(section.fields || []), []);
}

/** The session-code format required before launching the worker. */
const SESSION_CODE_RE = /^[A-Z0-9]{4,8}$/;

/** Default config object (defaults filled in, secrets left empty). */
function getDefaults() {
  const out = {};
  for (const field of allFields()) {
    out[field.key] = field.default != null ? String(field.default) : '';
  }
  return out;
}

function envFilePath(userDataDir) {
  return path.join(userDataDir, ENV_FILENAME);
}

/** Read worker.env (if present) and merge it over the defaults. */
function loadEnv(userDataDir) {
  const defaults = getDefaults();
  const file = envFilePath(userDataDir);
  let parsed = {};
  try {
    if (fs.existsSync(file)) {
      parsed = dotenv.parse(fs.readFileSync(file));
    }
  } catch (err) {
    // Corrupt file should not crash the app — fall back to defaults.
    console.error('[env-store] failed to read', file, err.message);
  }
  return { ...defaults, ...parsed };
}

/** Quote a value for the .env file only when necessary. */
function serializeValue(value) {
  const v = value == null ? '' : String(value);
  if (v === '') return '';
  // Multiline value: double quotes (dotenv re-expands \n on read).
  if (/[\r\n]/.test(v)) {
    return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"';
  }
  // Needs quoting (spaces, #, quotes, backslashes, etc.)?
  // Prefer SINGLE quotes: dotenv treats single-quoted values literally, so
  // Windows paths (C:\Users\...\worker\) and values with spaces survive intact.
  // Double quotes would let dotenv mangle backslashes (\n, \t, \\), corrupting paths.
  if (/[\s#"'`$\\]/.test(v)) {
    if (!v.includes("'")) return "'" + v + "'";
    // Rare: value contains a single quote -> fall back to double quotes.
    return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return v;
}

/** Serialize a config object into a grouped, commented .env string. */
function serializeEnv(obj) {
  const lines = [
    '# Morari Translate — worker configuration',
    '# Managed by the Morari Translate desktop app. Edit via Settings.',
    '',
  ];
  const written = new Set();
  for (const section of SCHEMA) {
    if (!section.fields || section.fields.length === 0) continue;
    lines.push(`# --- ${section.title} ---`);
    for (const field of section.fields) {
      lines.push(`${field.key}=${serializeValue(obj[field.key])}`);
      written.add(field.key);
    }
    lines.push('');
  }
  // Preserve any extra keys the caller passed that aren't in the schema.
  const extras = Object.keys(obj).filter((k) => !written.has(k));
  if (extras.length) {
    lines.push('# --- Other ---');
    for (const k of extras) lines.push(`${k}=${serializeValue(obj[k])}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Write worker.env. Returns the file path. */
function saveEnv(userDataDir, obj) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const file = envFilePath(userDataDir);
  fs.writeFileSync(file, serializeEnv(obj), 'utf8');
  return file;
}

/**
 * Lightweight config validator (the "config validator" run on Settings save).
 * Checks that required fields are present and that a few critical values are
 * correct. Returns { ok, errors:[], fatal }.
 */
function validateConfig(env) {
  const errors = [];
  for (const field of allFields()) {
    if (field.appOnly) continue;
    if (field.required && !String(env[field.key] || '').trim()) {
      errors.push(`${field.label} (${field.key}) is required.`);
    }
  }

  // Critical runtime facts that have burned us before.
  const stt = String(env.STT_PROVIDER || '').trim().toLowerCase();
  if (stt && stt !== 'sarvam') {
    errors.push(`STT_PROVIDER must be "sarvam" (got "${env.STT_PROVIDER}").`);
  }

  const code = String(env.SESSION_CODE || '').trim();
  if (code && !SESSION_CODE_RE.test(code)) {
    errors.push('SESSION_CODE must be 4–8 uppercase letters/numbers (e.g. GSJZ76).');
  }

  const baseUrl = String(env.OPENAI_BASE_URL || '').trim();
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    errors.push('OPENAI_BASE_URL must be a valid http(s) URL.');
  }

  const supaUrl = String(env.SUPABASE_URL || '').trim();
  if (supaUrl && !/^https?:\/\//i.test(supaUrl)) {
    errors.push('SUPABASE_URL must be a valid http(s) URL.');
  }

  return { ok: errors.length === 0, errors, fatal: errors[0] || null };
}

/** Parse an "mm:ss" (or "hh:mm:ss", or plain seconds) string into seconds. */
function parseTimeToSeconds(value) {
  const v = String(value || '').trim();
  if (!v) return 0;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  const parts = v.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/**
 * Build the environment map passed to the spawned worker.
 *
 * Merges the saved settings (minus app-only keys) with the per-session
 * selections from the Setup screen. The session-source variable names
 * (MODE / AUDIO_INPUT_DEVICE / WATCHBACK_URL / …) are best-effort: adjust here
 * if your worker build expects different names.
 *
 * @param {object} savedEnv      merged settings (output of loadEnv)
 * @param {object} sessionConfig { sessionCode, mode, audioDeviceId, audioDeviceLabel, youtubeUrl, startPosition }
 * @param {string} platform      OS platform (defaults to process.platform); injectable for tests
 */
function toWorkerEnv(savedEnv, sessionConfig = {}, platform = process.platform) {
  const out = {};
  const appOnlyKeys = new Set(allFields().filter((f) => f.appOnly).map((f) => f.key));

  // 1) All non-app-only saved settings become env vars.
  for (const [key, value] of Object.entries(savedEnv)) {
    if (appOnlyKeys.has(key)) continue;
    out[key] = value == null ? '' : String(value);
  }

  // 2) Per-session overrides from the Setup screen.
  if (sessionConfig.sessionCode) {
    out.SESSION_CODE = String(sessionConfig.sessionCode).trim().toUpperCase();
  }

  // Setup source mode: 'mic' | 'live_youtube' | 'recorded_youtube'
  // ('live'/'watchback' accepted as back-compat aliases for mic/recorded).
  const rawMode = (sessionConfig.mode || 'mic').toLowerCase();
  const mode = rawMode === 'live' ? 'mic' : (rawMode === 'watchback' ? 'recorded_youtube' : rawMode);
  out.MODE = mode;

  const isMic = mode === 'mic';
  if (isMic) {
    // macOS captures audio via ffmpeg's avfoundation input, which addresses
    // devices by INDEX (":0" = system default mic), NOT by display name. Passing
    // the display name (e.g. "Default - MacBook Pro Microphone (Built-in)")
    // fails on avfoundation — that format only works with Windows dshow. So on
    // macOS always send ":0" (default device); elsewhere send the display label.
    if (platform === 'darwin') {
      out.AUDIO_INPUT_DEVICE = ':0';
    } else if (sessionConfig.audioDeviceLabel) {
      out.AUDIO_INPUT_DEVICE = String(sessionConfig.audioDeviceLabel);
    }
    if (sessionConfig.audioDeviceId) out.AUDIO_INPUT_DEVICE_ID = String(sessionConfig.audioDeviceId);
  }
  // For live_youtube / recorded_youtube the worker reads the URL and mode from
  // the Supabase session row (youtube_url / session_mode), set by ensureSession
  // in main.js — no audio-device or URL env vars are needed here.

  return out;
}

module.exports = {
  ENV_FILENAME,
  SCHEMA,
  SESSION_CODE_RE,
  allFields,
  getDefaults,
  envFilePath,
  loadEnv,
  saveEnv,
  serializeEnv,
  validateConfig,
  toWorkerEnv,
  parseTimeToSeconds,
};
