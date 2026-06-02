'use strict';

/**
 * Headless test harness (no Electron) for the two pure modules:
 *   - env-store.js     defaults / round-trip / validation / env mapping
 *   - worker-manager.js classification / path validation / spawn / restart
 *
 * Run: npm test   (node scripts/test/run-all.js)
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const envStore = require('../../electron/env-store');
const {
  WorkerManager,
  validateWorkerPath,
  classifyLine,
  chooseWorkerPath,
  computeSetupPhase,
  readWorkerVersion,
  installDependencies,
} = require('../../electron/worker-manager');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('  ✓', name);
  } catch (err) {
    failed += 1;
    console.error('  ✗', name);
    console.error('      ', err && err.message ? err.message : err);
  }
}

function group(name) {
  console.log('\n' + name);
}

// ---- helpers ------------------------------------------------------------

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeWorkerDir(scriptBody) {
  const dir = tmpDir('mt-worker-');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), scriptBody);
  return dir;
}

function waitFor(wm, predicate, timeout, label) {
  return new Promise((resolve, reject) => {
    if (predicate(wm.getState())) return resolve(wm.getState());
    const to = setTimeout(() => {
      wm.removeListener('status', handler);
      reject(new Error(`timeout waiting for ${label} (status=${wm.getState().status})`));
    }, timeout);
    function handler(s) {
      if (predicate(s)) {
        clearTimeout(to);
        wm.removeListener('status', handler);
        resolve(s);
      }
    }
    wm.on('status', handler);
  });
}

// ---- env-store ----------------------------------------------------------

async function testEnvStore() {
  group('env-store');

  await test('getDefaults locks in the critical runtime facts', () => {
    const d = envStore.getDefaults();
    assert.strictEqual(d.STT_PROVIDER, 'sarvam');
    assert.strictEqual(d.TRANSLATION_OPENAI_BASE_URL, 'https://openrouter.ai/api/v1');
    assert.strictEqual(d.DEFAULT_MODEL, 'google/gemini-2.5-flash');
    assert.strictEqual(d.SARVAM_MODEL, 'saaras:v3');
    assert.strictEqual(d.LOCKED_WORK_MODE, 'on');
  });

  await test('saveEnv + loadEnv round-trips values (incl. special chars)', () => {
    const dir = tmpDir('mt-env-');
    const cfg = {
      ...envStore.getDefaults(),
      SUPABASE_SERVICE_KEY: 'eyJhbGciOi.JsdGVzdA',
      SESSION_CODE: 'GSJZ76',
      TRANSLATION_OPENAI_API_KEY: 'sk-or-v1-abc with space #hash',
    };
    const file = envStore.saveEnv(dir, cfg);
    assert.ok(fs.existsSync(file));
    const loaded = envStore.loadEnv(dir);
    assert.strictEqual(loaded.SESSION_CODE, 'GSJZ76');
    assert.strictEqual(loaded.SUPABASE_SERVICE_KEY, 'eyJhbGciOi.JsdGVzdA');
    assert.strictEqual(loaded.TRANSLATION_OPENAI_API_KEY, 'sk-or-v1-abc with space #hash');
  });

  await test('saveEnv + loadEnv preserves Windows paths (backslashes intact)', () => {
    const dir = tmpDir('mt-win-');
    // Includes \n, \t, \w sequences that naive double-quote escaping would mangle.
    const cases = [
      'C:\\Users\\ayush\\.openclaw\\workspace\\worker\\worker\\',
      'C:\\node\\new\\temp\\report',
      'D:\\Program Files\\worker',
    ];
    for (const winPath of cases) {
      envStore.saveEnv(dir, { ...envStore.getDefaults(), WORKER_PATH: winPath });
      const loaded = envStore.loadEnv(dir);
      assert.strictEqual(loaded.WORKER_PATH, winPath, `round-trip failed for ${winPath}`);
    }
  });

  await test('loadEnv returns defaults when no file exists', () => {
    const dir = tmpDir('mt-env-');
    const loaded = envStore.loadEnv(dir);
    assert.strictEqual(loaded.STT_PROVIDER, 'sarvam');
  });

  await test('validateConfig: full config is OK', () => {
    const env = {
      ...envStore.getDefaults(),
      SUPABASE_SERVICE_KEY: 'k',
      SARVAM_API_KEY: 'k',
      TRANSLATION_OPENAI_API_KEY: 'k',
      SESSION_CODE: 'GSJZ76',
    };
    const r = envStore.validateConfig(env);
    assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  });

  await test('validateConfig: missing required keys fail', () => {
    const r = envStore.validateConfig(envStore.getDefaults());
    assert.strictEqual(r.ok, false);
    assert.ok(r.fatal);
  });

  await test('validateConfig: STT_PROVIDER must be sarvam', () => {
    const env = {
      ...envStore.getDefaults(),
      STT_PROVIDER: 'openai',
      SUPABASE_SERVICE_KEY: 'k',
      SARVAM_API_KEY: 'k',
      TRANSLATION_OPENAI_API_KEY: 'k',
    };
    const r = envStore.validateConfig(env);
    assert.strictEqual(r.ok, false);
    assert.ok(r.errors.some((e) => /sarvam/i.test(e)));
  });

  await test('validateConfig: bad SESSION_CODE rejected', () => {
    const env = {
      ...envStore.getDefaults(),
      SUPABASE_SERVICE_KEY: 'k',
      SARVAM_API_KEY: 'k',
      TRANSLATION_OPENAI_API_KEY: 'k',
      SESSION_CODE: 'bad code!',
    };
    const r = envStore.validateConfig(env);
    assert.strictEqual(r.ok, false);
  });

  await test('parseTimeToSeconds handles mm:ss / h:mm:ss / seconds', () => {
    assert.strictEqual(envStore.parseTimeToSeconds('12:30'), 750);
    assert.strictEqual(envStore.parseTimeToSeconds('1:02:03'), 3723);
    assert.strictEqual(envStore.parseTimeToSeconds('90'), 90);
    assert.strictEqual(envStore.parseTimeToSeconds(''), 0);
  });

  await test('toWorkerEnv strips app-only keys and maps live source', () => {
    const env = { ...envStore.getDefaults(), WORKER_PATH: '/some/path' };
    const out = envStore.toWorkerEnv(env, {
      sessionCode: 'gsjz76',
      mode: 'live',
      audioDeviceId: 'dev1',
      audioDeviceLabel: 'Scarlett 2i2',
    });
    assert.strictEqual(out.WORKER_PATH, undefined, 'WORKER_PATH must not leak to worker');
    assert.strictEqual(out.SESSION_CODE, 'GSJZ76');
    assert.strictEqual(out.MODE, 'live');
    assert.strictEqual(out.AUDIO_INPUT_DEVICE, 'Scarlett 2i2');
    assert.strictEqual(out.STT_PROVIDER, 'sarvam');
  });

  await test('toWorkerEnv maps watchback source', () => {
    const out = envStore.toWorkerEnv(envStore.getDefaults(), {
      sessionCode: 'ABCD',
      mode: 'watchback',
      youtubeUrl: 'https://youtu.be/x',
      startPosition: '02:05',
    });
    assert.strictEqual(out.MODE, 'watchback');
    assert.strictEqual(out.WATCHBACK_URL, 'https://youtu.be/x');
    assert.strictEqual(out.WATCHBACK_START_SECONDS, '125');
  });
}

// ---- worker-manager: pure ----------------------------------------------

async function testWorkerManagerPure() {
  group('worker-manager (pure)');

  await test('classifyLine colour rules', () => {
    assert.strictEqual(classifyLine('[error] FATAL: STT fail'), 'red');
    assert.strictEqual(classifyLine('[warn] retry rate limit'), 'yellow');
    assert.strictEqual(classifyLine('[locked-work] holding work'), 'blue');
    assert.strictEqual(classifyLine('[ok] translated -> hi in 200ms'), 'green');
    assert.strictEqual(classifyLine('canonical hit: ram'), 'green');
    // CONFIG OK is a success line even though it mentions "locked-work=on".
    assert.strictEqual(
      classifyLine('[jarvis] CONFIG OK: sarvam/saaras:v3 + google/gemini-2.5-flash + locked-work=on + 1625 entries'),
      'green'
    );
    assert.strictEqual(classifyLine('just some info'), 'white');
  });

  await test('validateWorkerPath: empty path', () => {
    assert.strictEqual(validateWorkerPath('').valid, false);
  });

  await test('validateWorkerPath: missing dir -> "not found"', () => {
    const r = validateWorkerPath(path.join(os.tmpdir(), 'definitely-missing-xyz-123'));
    assert.strictEqual(r.valid, false);
    assert.ok(/not found/i.test(r.error));
  });

  await test('validateWorkerPath: missing node_modules -> "dependencies"', () => {
    const dir = tmpDir('mt-novm-');
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'index.js'), '');
    const r = validateWorkerPath(dir);
    assert.strictEqual(r.valid, false);
    assert.ok(/dependencies/i.test(r.error));
  });

  await test('validateWorkerPath: valid worker dir', () => {
    const dir = makeWorkerDir('// worker');
    assert.strictEqual(validateWorkerPath(dir).valid, true);
  });
}

// ---- bundled-worker setup ----------------------------------------------

async function testBundling() {
  group('bundled worker setup');

  await test('chooseWorkerPath: packaged build uses resources/worker', () => {
    const p = chooseWorkerPath({ isPackaged: true, resourcesPath: '/app/resources', bundledDir: '/x', overridePath: '/y' });
    assert.strictEqual(p, path.join('/app/resources', 'worker'));
  });

  await test('chooseWorkerPath: dev prefers bundled worker once it has source', () => {
    const bundled = makeWorkerDir('// worker'); // has package.json
    const p = chooseWorkerPath({ isPackaged: false, resourcesPath: '/r', bundledDir: bundled, overridePath: '/some/override' });
    assert.strictEqual(p, bundled);
  });

  await test('chooseWorkerPath: dev falls back to override when bundled is empty', () => {
    const emptyBundled = tmpDir('mt-empty-');
    const override = makeWorkerDir('// worker');
    const p = chooseWorkerPath({ isPackaged: false, resourcesPath: '/r', bundledDir: emptyBundled, overridePath: override });
    assert.strictEqual(p, override);
  });

  await test('computeSetupPhase: missing / needs-install / ready', () => {
    const missing = tmpDir('mt-miss-');
    assert.strictEqual(computeSetupPhase(missing), 'missing');

    const needs = tmpDir('mt-needs-');
    fs.mkdirSync(path.join(needs, 'src'), { recursive: true });
    fs.writeFileSync(path.join(needs, 'src', 'index.js'), '');
    fs.writeFileSync(path.join(needs, 'package.json'), '{"name":"w","version":"2.0.0"}');
    assert.strictEqual(computeSetupPhase(needs), 'needs-install');

    fs.mkdirSync(path.join(needs, 'node_modules'), { recursive: true });
    assert.strictEqual(computeSetupPhase(needs), 'ready');
  });

  await test('readWorkerVersion reads version from package.json', () => {
    const dir = tmpDir('mt-ver-');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"w","version":"3.4.5"}');
    assert.strictEqual(readWorkerVersion(dir), '3.4.5');
    assert.strictEqual(readWorkerVersion(tmpDir('mt-none-')), null);
  });

  await test('installDependencies runs npm install in the worker dir', async () => {
    const dir = tmpDir('mt-install-');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"w","version":"1.0.0","private":true}');
    const lines = [];
    const result = await installDependencies(dir, (l) => lines.push(l));
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.ok(fs.existsSync(path.join(dir, 'node_modules')), 'node_modules should be created');
  });
}

// ---- worker-manager: integration ---------------------------------------

const GOOD_WORKER = `
process.stdout.write('[jarvis] booting\\n');
process.stdout.write('[jarvis] loading canonical corpus...\\n');
setTimeout(() => {
  process.stdout.write('[jarvis] CONFIG OK: sarvam/saaras:v3 + google/gemini-2.5-flash + locked-work=on + 1625 entries\\n');
  setTimeout(() => {
    process.stdout.write('[canonical] canonical hit: "ram" -> "Ram"\\n');
    process.stdout.write('[ok] translated "ram" -> "Ram" in 220ms\\n');
  }, 60);
}, 120);
process.on('SIGTERM', () => process.exit(0));
setInterval(() => {}, 1000);
`;

const CRASH_WORKER = `
process.stderr.write('[error] FATAL: boom\\n');
process.exit(1);
`;

async function testWorkerManagerIntegration() {
  group('worker-manager (integration: real child processes)');

  await test('spawns, reaches RUNNING, parses CONFIG OK + stats, then stops', async () => {
    const dir = makeWorkerDir(GOOD_WORKER);
    const wm = new WorkerManager({ statsThrottleMs: 30 });
    const res = wm.start({ workerPath: dir, env: {} });
    assert.strictEqual(res.ok, true);

    await waitFor(wm, (s) => s.status === 'running', 8000, 'running');

    const s = await waitFor(
      wm,
      (st) => st.stats.canonicalHits >= 1 && st.stats.avgLatencyMs > 0,
      8000,
      'stats populated'
    );
    assert.strictEqual(s.stats.sttProvider, 'sarvam');
    assert.strictEqual(s.stats.sttModel, 'saaras:v3');
    assert.strictEqual(s.stats.translationModel, 'google/gemini-2.5-flash');
    assert.strictEqual(s.stats.lockedWork, 'on');
    assert.strictEqual(s.stats.corpusEntries, 1625);
    assert.ok(s.stats.canonicalHits >= 1);
    assert.ok(s.stats.avgLatencyMs >= 200 && s.stats.avgLatencyMs <= 240);

    wm.stop();
    const stopped = await waitFor(wm, (st) => st.status === 'stopped', 6000, 'stopped');
    assert.strictEqual(stopped.status, 'stopped');
    assert.strictEqual(wm.isRunning(), false);
  });

  await test('auto-restarts on crash, then trips the circuit breaker -> FAILED', async () => {
    const dir = makeWorkerDir(CRASH_WORKER);
    const wm = new WorkerManager({ restartDelayMs: 60, maxCrashes: 3, crashWindowMs: 60000 });
    let sawRestarting = false;
    wm.on('status', (s) => {
      if (s.status === 'restarting') sawRestarting = true;
    });

    wm.start({ workerPath: dir, env: {} });
    const failed = await waitFor(wm, (s) => s.status === 'failed', 8000, 'failed');
    assert.strictEqual(failed.status, 'failed');
    assert.ok(sawRestarting, 'should have shown RESTARTING before failing');
    assert.ok(/failed/i.test(failed.message));
    assert.strictEqual(wm.isRunning(), false);

    wm.killNow();
  });

  await test('reports a clear error when the node binary is missing', async () => {
    const dir = makeWorkerDir(GOOD_WORKER);
    const wm = new WorkerManager({ nodeBinary: 'definitely-not-node-xyz', restartDelayMs: 30, maxCrashes: 1 });
    const errors = [];
    wm.on('log', (l) => {
      if (l.level === 'red') errors.push(l.line);
    });
    wm.start({ workerPath: dir, env: {} });
    await waitFor(wm, (s) => s.status === 'failed', 6000, 'failed (spawn error)');
    assert.ok(errors.some((e) => /not found|Failed to launch/i.test(e)), errors.join(' | '));
    wm.killNow();
  });
}

// ---- run ----------------------------------------------------------------

(async () => {
  console.log('Morari Translate — test suite');
  await testEnvStore();
  await testWorkerManagerPure();
  await testBundling();
  await testWorkerManagerIntegration();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
