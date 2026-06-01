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
    title: 'Worker Location',
    description:
      'Where the morari-translate worker repo lives on this machine. The folder must contain src/index.js and an installed node_modules.',
    fields: [
      {
        key: 'WORKER_PATH',
        label: 'Worker Path',
        type: 'path',
        appOnly: true,
        prominent: true,
        placeholder: '/Users/you/morari-translate/worker',
        help: 'Absolute path to the worker repo folder (contains src/index.js).',
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
        key: 'SUPABASE_SERVICE_KEY',
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
        key: 'TRANSLATION_OPENAI_API_KEY',
        label: 'OpenRouter API Key',
        type: 'password',
        sensitive: true,
        required: true,
        placeholder: 'sk-or-v1-...',
      },
      {
        key: 'TRANSLATION_OPENAI_BASE_URL',
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
        default: '60000',
      },
      {
        key: 'CANONICAL_MATCH_MIN_TRIGGER_LEN',
        label: 'Canonical Min Trigger Length',
        type: 'number',
        default: '8',
      },
    ],
  },
  {
    id: 'fallback',
    title: 'Emergency Fallback',
    description:
      'Optional. If OpenRouter is unavailable, switch the OpenRouter Translation fields above to a fallback provider. Example values:',
    note:
      'TRANSLATION_OPENAI_BASE_URL = https://api.quatarly.cloud/v1\n' +
      'TRANSLATION_OPENAI_API_KEY = qua-sub-...\n' +
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
  if (/[\s#"'`$\\]/.test(v) || /[\r\n]/.test(v)) {
    return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '') + '"';
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

  const baseUrl = String(env.TRANSLATION_OPENAI_BASE_URL || '').trim();
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    errors.push('TRANSLATION_OPENAI_BASE_URL must be a valid http(s) URL.');
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
 */
function toWorkerEnv(savedEnv, sessionConfig = {}) {
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

  const mode = (sessionConfig.mode || 'live').toLowerCase();
  out.MODE = mode;

  if (mode === 'watchback') {
    if (sessionConfig.youtubeUrl) out.WATCHBACK_URL = String(sessionConfig.youtubeUrl).trim();
    const startSeconds = parseTimeToSeconds(sessionConfig.startPosition);
    out.WATCHBACK_START_SECONDS = String(startSeconds);
    if (sessionConfig.startPosition) out.WATCHBACK_START = String(sessionConfig.startPosition).trim();
  } else {
    if (sessionConfig.audioDeviceLabel) out.AUDIO_INPUT_DEVICE = String(sessionConfig.audioDeviceLabel);
    if (sessionConfig.audioDeviceId) out.AUDIO_INPUT_DEVICE_ID = String(sessionConfig.audioDeviceId);
  }

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
