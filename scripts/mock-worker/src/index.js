'use strict';

/**
 * Mock morari-translate worker — for trying the desktop app WITHOUT the real
 * worker repo. It imitates the real worker's stdout: a startup sequence, the
 * "[jarvis] CONFIG OK: ..." line (~2s in), then a stream of colour-coded events
 * (translations with latency, canonical hits, the occasional warn / locked-work).
 *
 * Reads its config from environment variables, exactly like the real worker.
 *
 * Optional test knobs:
 *   MOCK_STARTUP_MS   delay before CONFIG OK         (default 2000)
 *   MOCK_TICK_MS      delay between event lines      (default 1500)
 *   MOCK_CRASH=1      exit(1) to test auto-restart
 *   MOCK_CRASH_AFTER_MS  when to crash               (default 2500)
 */

const log = (s) => process.stdout.write(s + '\n');
const err = (s) => process.stderr.write(s + '\n');

const env = process.env;
const sttProvider = env.STT_PROVIDER || 'sarvam';
const sttModel = env.SARVAM_MODEL || 'saaras:v3';
const translationModel = env.DEFAULT_MODEL || 'google/gemini-2.5-flash';
const lockedWork = env.LOCKED_WORK_MODE || 'on';
const corpusEntries = 1625;

const startupMs = parseInt(env.MOCK_STARTUP_MS || '2000', 10);
const tickMs = parseInt(env.MOCK_TICK_MS || '1500', 10);

log('[jarvis] booting morari-translate worker (mock)');
log(`[jarvis] session=${env.SESSION_CODE || '(none)'} mode=${env.MODE || 'live'}`);
if ((env.MODE || 'live') === 'watchback') {
  log(`[jarvis] watchback url=${env.WATCHBACK_URL || '(none)'} start=${env.WATCHBACK_START || '0'}`);
} else {
  log(`[jarvis] audio input=${env.AUDIO_INPUT_DEVICE || '(system default)'}`);
}
log(`[jarvis] stt=${sttProvider} translation via ${env.TRANSLATION_OPENAI_BASE_URL || 'openrouter'}`);
log('[jarvis] loading canonical corpus from supabase…');

// Crash mode for testing the auto-restart / circuit breaker.
if (env.MOCK_CRASH === '1') {
  const after = parseInt(env.MOCK_CRASH_AFTER_MS || '2500', 10);
  setTimeout(() => {
    err('[error] FATAL: simulated worker crash (MOCK_CRASH=1)');
    process.exit(1);
  }, after);
}

let running = true;
process.on('SIGTERM', () => {
  log('[jarvis] received SIGTERM, shutting down');
  running = false;
  process.exit(0);
});
process.on('SIGINT', () => process.exit(0));

const PHRASES = [
  'राम राम',
  'जय सियाराम',
  'हनुमान चालीसा',
  'मानस का गान',
  'भजन कीर्तन',
];
const TRANSLATIONS = [
  'Ram Ram',
  'Glory to Sita-Ram',
  'Hanuman Chalisa',
  'the song of the Manas',
  'devotional singing',
];

let i = 0;
function tick() {
  if (!running) return;
  const idx = i % PHRASES.length;
  const latency = 180 + Math.floor(Math.random() * 320);
  const roll = Math.random();

  if (roll < 0.25) {
    log(`[canonical] canonical hit: "${PHRASES[idx]}" -> "${TRANSLATIONS[idx]}" (corpus)`);
  } else if (roll < 0.35) {
    err(`[warn] sarvam stt retry (rate limit) — backing off 500ms`);
  } else if (roll < 0.45) {
    log(`[locked-work] holding work-id ramcharitmanas:doha:${100 + idx}`);
  } else {
    log(`[ok] translated "${PHRASES[idx]}" -> "${TRANSLATIONS[idx]}" in ${latency}ms`);
  }
  i += 1;
  setTimeout(tick, tickMs);
}

setTimeout(() => {
  if (!running) return;
  log(
    `[jarvis] CONFIG OK: ${sttProvider}/${sttModel} + ${translationModel} + locked-work=${lockedWork} + ${corpusEntries} entries`
  );
  setTimeout(tick, tickMs);
}, startupMs);
