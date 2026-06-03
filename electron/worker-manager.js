'use strict';

/**
 * worker-manager.js
 * --------------------------------------------------------------------------
 * Spawns, monitors and restarts the morari-translate captioning worker.
 *
 * Deliberately has NO Electron dependency: it is a plain EventEmitter so it can
 * be unit-tested in Node against a mock worker. The Electron main process wires
 * its events to IPC.
 *
 * Events:
 *   'log'    -> { line, level, ts }      one classified log line
 *   'status' -> full state snapshot      { status, stats, restartCount, lastError, message }
 *
 * Status values: 'idle' | 'loading' | 'running' | 'restarting' | 'stopped' | 'failed'
 */

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const RESTART_DELAY_MS = 3000; // wait before auto-restart (Part 2 #8)
const CRASH_WINDOW_MS = 60000; // circuit-breaker window
const MAX_CRASHES = 3; // crashes within the window before giving up
const KILL_GRACE_MS = 4000; // SIGTERM -> SIGKILL grace period
const STATS_THROTTLE_MS = 400; // coalesce stat-driven status emits
const MAX_LATENCY_SAMPLES = 50;

/**
 * Decide which worker directory to use (pure / fs-based, no Electron).
 *  - packaged build  -> the bundled worker under resources/worker
 *  - development      -> the in-repo bundled worker once it has source,
 *                        else a configured override (mock/external), else bundled
 */
function chooseWorkerPath({ isPackaged, resourcesPath, bundledDir, overridePath }) {
  if (isPackaged) return path.join(resourcesPath, 'worker');
  if (bundledDir && fs.existsSync(path.join(bundledDir, 'package.json'))) return bundledDir;
  if (overridePath && String(overridePath).trim() && fs.existsSync(String(overridePath).trim())) {
    return String(overridePath).trim();
  }
  return bundledDir;
}

/**
 * First-launch setup phase for a worker directory.
 *  'missing'      -> no worker source bundled (package.json / src/index.js absent)
 *  'needs-install'-> source present but node_modules missing (run npm install)
 *  'ready'        -> good to go
 */
function computeSetupPhase(workerPath) {
  const hasPkg = workerPath && fs.existsSync(path.join(workerPath, 'package.json'));
  const hasEntry = workerPath && fs.existsSync(path.join(workerPath, 'src', 'index.js'));
  if (!hasPkg || !hasEntry) return 'missing';
  if (!fs.existsSync(path.join(workerPath, 'node_modules'))) return 'needs-install';
  return 'ready';
}

/** Read the worker's version from its package.json (or null). */
function readWorkerVersion(workerPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(workerPath, 'package.json'), 'utf8'));
    return pkg.version || null;
  } catch (_) {
    return null;
  }
}

/**
 * Run `npm install` in the worker directory (first-launch dependency setup).
 * Streams output lines to onLog and resolves { ok, error }.
 */
function installDependencies(workerPath, onLog) {
  return new Promise((resolve) => {
    const emit = (line) => {
      if (onLog && line) onLog(line);
    };
    const isWin = process.platform === 'win32';
    const npmCmd = isWin ? 'npm.cmd' : 'npm';
    let child;
    try {
      child = spawn(npmCmd, ['install', '--no-audit', '--no-fund', '--loglevel=info'], {
        cwd: workerPath,
        env: process.env,
        shell: isWin, // npm is a .cmd on Windows -> must run through the shell
      });
    } catch (err) {
      resolve({ ok: false, error: `Failed to run npm: ${err.message}` });
      return;
    }

    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        emit(l);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => resolve({ ok: false, error: `Failed to run npm: ${err.message}` }));
    child.on('exit', (code) => {
      if (buf.trim()) emit(buf.trim());
      if (code === 0) {
        // Guarantee node_modules exists so setup is considered complete even
        // for a worker that happens to declare zero dependencies.
        try {
          fs.mkdirSync(path.join(workerPath, 'node_modules'), { recursive: true });
        } catch (_) {}
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: `npm install exited with code ${code}` });
      }
    });
  });
}

/**
 * Validate that a worker repo is present and installed (Part 6).
 * Returns { valid, error } with the exact spec error strings.
 */
function validateWorkerPath(workerPath) {
  const p = String(workerPath || '').trim();
  if (!p) {
    return { valid: false, error: 'No worker path set. Set the Worker Path in Settings.' };
  }
  if (!fs.existsSync(p) || !fs.existsSync(path.join(p, 'src', 'index.js'))) {
    return { valid: false, error: `Worker not found at ${p}. Please update in Settings.` };
  }
  if (!fs.existsSync(path.join(p, 'node_modules'))) {
    return { valid: false, error: `Worker dependencies not installed. Run npm install in ${p}.` };
  }
  return { valid: true, error: null };
}

/** Classify a log line into a colour level for the UI. Order = priority. */
function classifyLine(line) {
  const l = String(line).toLowerCase();
  if (/\[error\]|fatal|stt fail|\bexception\b|unhandled|\btraceback\b|\bcrash/.test(l)) return 'red';
  if (/\[warn\]|\bretry\b|retrying|rate limit|rate-limit|throttle|\bwarning\b/.test(l)) return 'yellow';
  if (/\bconfig ok\b|\[ok\]|canonical hit|\[canonical\]|translation success|translated/.test(l)) return 'green';
  if (/\[locked-work\]/.test(l)) return 'blue';
  return 'white';
}

const DEFAULT_STATS = Object.freeze({
  sttProvider: null,
  sttModel: null,
  translationModel: null,
  lockedWork: null,
  corpusEntries: null,
  canonicalHits: 0,
  avgLatencyMs: null,
});

class WorkerManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.nodeBinary = options.nodeBinary || 'node';
    this.workerScript = options.workerScript || path.join('src', 'index.js');

    // Timings — default to the spec values; overridable for fast tests.
    this.restartDelayMs = options.restartDelayMs != null ? options.restartDelayMs : RESTART_DELAY_MS;
    this.crashWindowMs = options.crashWindowMs != null ? options.crashWindowMs : CRASH_WINDOW_MS;
    this.maxCrashes = options.maxCrashes != null ? options.maxCrashes : MAX_CRASHES;
    this.killGraceMs = options.killGraceMs != null ? options.killGraceMs : KILL_GRACE_MS;
    this.statsThrottleMs = options.statsThrottleMs != null ? options.statsThrottleMs : STATS_THROTTLE_MS;

    this.child = null;
    this.workerPath = null;
    this.workerEnv = null;

    this.intentionalStop = false;
    this.restartTimer = null;
    this.killTimer = null;
    this.statsTimer = null;
    this.crashTimestamps = [];

    this._stdoutBuf = '';
    this._stderrBuf = '';
    this._latencySamples = [];

    this.state = {
      status: 'idle',
      stats: { ...DEFAULT_STATS },
      restartCount: 0,
      lastError: null,
      message: null,
    };
  }

  // ---- public API -------------------------------------------------------

  /**
   * Start a session.
   * @param {object} opts { workerPath, env }
   * @returns {{ok:boolean, error?:string}}
   */
  start({ workerPath, env } = {}) {
    const check = validateWorkerPath(workerPath);
    if (!check.valid) return { ok: false, error: check.error };

    // Reset session state.
    this.stop({ silent: true });
    this.intentionalStop = false;
    this.crashTimestamps = [];
    this._latencySamples = [];
    this.workerPath = String(workerPath).trim();
    this.workerEnv = env || {};
    this.state = {
      status: 'loading',
      stats: { ...DEFAULT_STATS },
      restartCount: 0,
      lastError: null,
      message: 'Loading corpus…',
    };

    this._spawn();
    return { ok: true };
  }

  /**
   * Stop the session. Disables auto-restart.
   * @param {object} opts { silent } when silent, don't emit a 'stopped' status.
   */
  stop({ silent = false } = {}) {
    this.intentionalStop = true;
    this._clearTimers();
    const child = this.child;
    this.child = null;
    if (child && !child.killed) {
      try {
        child.kill('SIGTERM');
      } catch (_) {}
      // Hard-kill if it doesn't exit in time.
      this.killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch (_) {}
      }, this.killGraceMs);
      if (this.killTimer.unref) this.killTimer.unref();
    }
    if (!silent) {
      this.state.status = 'stopped';
      this.state.message = null;
      this._emitState();
    }
    return { ok: true };
  }

  /** Synchronous hard kill for app shutdown (before-quit). */
  killNow() {
    this.intentionalStop = true;
    this._clearTimers();
    const child = this.child;
    this.child = null;
    if (child && !child.killed) {
      try {
        child.kill('SIGKILL');
      } catch (_) {}
    }
  }

  getState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  isRunning() {
    return !!this.child;
  }

  // ---- internals --------------------------------------------------------

  _clearTimers() {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.killTimer) {
      clearTimeout(this.killTimer);
      this.killTimer = null;
    }
    if (this.statsTimer) {
      clearTimeout(this.statsTimer);
      this.statsTimer = null;
    }
  }

  _spawn() {
    let child;
    // [debug] confirm the configured env vars actually reach the worker. Logs
    // key NAMES, a few NON-secret values, and secret presence as booleans —
    // never secret values. Lets us see e.g. that STT_PROVIDER=sarvam is sent.
    const e = this.workerEnv || {};
    console.log('[debug] env keys being passed to worker:', Object.keys(e));
    console.log(
      '[debug] STT_PROVIDER=%s SARVAM_MODEL=%s SARVAM_LANGUAGE_CODE=%s MODE=%s OPENAI_BASE_URL=%s | set? SARVAM_API_KEY=%s OPENAI_API_KEY=%s SUPABASE_SERVICE_ROLE_KEY=%s',
      e.STT_PROVIDER, e.SARVAM_MODEL, e.SARVAM_LANGUAGE_CODE, e.MODE, e.OPENAI_BASE_URL,
      !!e.SARVAM_API_KEY, !!e.OPENAI_API_KEY, !!e.SUPABASE_SERVICE_ROLE_KEY
    );
    try {
      child = spawn(this.nodeBinary, [this.workerScript], {
        cwd: this.workerPath,
        env: { ...process.env, ...this.workerEnv },
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      this._onSpawnError(err);
      return;
    }

    this.child = child;
    this._stdoutBuf = '';
    this._stderrBuf = '';

    // Guard every handler by child identity so a stale child (killed during a
    // restart/stop) can never mutate state belonging to the current child.
    child.stdout.on('data', (chunk) => {
      if (this.child === child) this._onData(chunk, false);
    });
    child.stderr.on('data', (chunk) => {
      if (this.child === child) this._onData(chunk, true);
    });
    child.on('error', (err) => {
      if (this.child === child) this._onSpawnError(err);
    });
    child.on('exit', (code, signal) => {
      if (this.child === child) this._onExit(code, signal);
    });

    this._emitState();
  }

  _onSpawnError(err) {
    const msg =
      err && err.code === 'ENOENT'
        ? `Failed to launch worker: "${this.nodeBinary}" not found on PATH. Install Node.js and try again.`
        : `Failed to launch worker: ${err && err.message ? err.message : String(err)}`;
    this.state.lastError = msg;
    this._emitLog(msg, 'red');
    // Treat a spawn failure like a non-zero exit so the circuit breaker applies.
    this.child = null;
    this._onExit(1, null);
  }

  _onData(chunk, isStderr) {
    const bufKey = isStderr ? '_stderrBuf' : '_stdoutBuf';
    this[bufKey] += chunk.toString('utf8');
    let idx;
    while ((idx = this[bufKey].indexOf('\n')) >= 0) {
      const raw = this[bufKey].slice(0, idx).replace(/\r$/, '');
      this[bufKey] = this[bufKey].slice(idx + 1);
      if (raw.length > 0) this._handleLine(raw);
    }
  }

  _handleLine(line) {
    const level = classifyLine(line);
    const statsChanged = this._updateStatsFromLine(line, level);

    if (level === 'red') this.state.lastError = line;

    // The CONFIG OK line means the corpus finished loading -> RUNNING.
    if (this._parseConfigOk(line)) {
      this.crashTimestamps = []; // a healthy start resets the breaker
      this.state.restartCount = 0;
      this.state.status = 'running';
      this.state.message = null;
      this._emitLog(line, level);
      this._emitState();
      return;
    }

    this._emitLog(line, level);
    // Push refreshed stats (canonical hits / latency) to the UI, throttled.
    if (statsChanged) this._emitStateThrottled();
  }

  /** Parse the "[jarvis] CONFIG OK: ..." line into stats. Returns true on match. */
  _parseConfigOk(line) {
    if (!/config ok/i.test(line)) return false;

    const stats = this.state.stats;
    // Full format: CONFIG OK: sarvam/saaras:v3 + google/gemini-2.5-flash + locked-work=on + 1625 entries
    const full = line.match(
      /config ok:\s*([^\s+]+)\s*\+\s*([^\s+]+)\s*\+\s*locked-work=(\w+)\s*\+\s*(\d+)\s*entries/i
    );
    if (full) {
      const [sttProvider, ...rest] = full[1].split('/');
      stats.sttProvider = sttProvider || full[1];
      stats.sttModel = rest.join('/') || null;
      stats.translationModel = full[2];
      stats.lockedWork = full[3];
      stats.corpusEntries = parseInt(full[4], 10);
      return true;
    }

    // Lenient fallbacks if the format drifts.
    const models = line.match(/config ok:\s*(\S+)\s*\+\s*(\S+)/i);
    if (models) {
      const [sttProvider, ...rest] = models[1].split('/');
      stats.sttProvider = sttProvider || models[1];
      stats.sttModel = rest.join('/') || null;
      stats.translationModel = models[2];
    }
    const locked = line.match(/locked-work=(\w+)/i);
    if (locked) stats.lockedWork = locked[1];
    const entries = line.match(/(\d+)\s*entries/i);
    if (entries) stats.corpusEntries = parseInt(entries[1], 10);
    return true;
  }

  _updateStatsFromLine(line, level) {
    const stats = this.state.stats;
    let changed = false;

    // Canonical hits this session.
    if (/canonical hit|\[canonical\]/i.test(line)) {
      stats.canonicalHits = (stats.canonicalHits || 0) + 1;
      changed = true;
    }

    // Translation latency: collect "<n>ms" found on translation/ok lines.
    if (/translat|\[ok\]|latency|took/i.test(line)) {
      const m = line.match(/(\d+)\s*ms\b/i);
      if (m) {
        const ms = parseInt(m[1], 10);
        if (!Number.isNaN(ms) && ms >= 0 && ms < 600000) {
          this._latencySamples.push(ms);
          if (this._latencySamples.length > MAX_LATENCY_SAMPLES) this._latencySamples.shift();
          const sum = this._latencySamples.reduce((a, b) => a + b, 0);
          stats.avgLatencyMs = Math.round(sum / this._latencySamples.length);
          changed = true;
        }
      }
    }

    return changed;
  }

  _onExit(code, signal) {
    this.child = null;
    this._stdoutBuf = '';
    this._stderrBuf = '';

    if (this.intentionalStop) {
      this.state.status = 'stopped';
      this.state.message = null;
      this._emitState();
      return;
    }

    this._emitLog(`[worker exited] code=${code} signal=${signal || 'none'}`, code === 0 ? 'white' : 'red');

    // Clean exit (code 0) without an explicit stop -> just stopped, no restart loop.
    if (code === 0) {
      this.state.status = 'stopped';
      this.state.message = null;
      this._emitState();
      return;
    }

    // Non-zero exit -> crash. Apply the circuit breaker.
    const now = Date.now();
    this.crashTimestamps.push(now);
    this.crashTimestamps = this.crashTimestamps.filter((t) => now - t <= this.crashWindowMs);

    if (this.crashTimestamps.length >= this.maxCrashes) {
      this.state.status = 'failed';
      this.state.message = `Worker failed ${this.maxCrashes} times in ${Math.round(this.crashWindowMs / 1000)}s. Auto-restart disabled.`;
      this._emitLog(this.state.message, 'red');
      this._emitState();
      return;
    }

    // Schedule an auto-restart.
    this.state.status = 'restarting';
    this.state.restartCount += 1;
    this.state.message = `Worker crashed (code ${code}). Restarting in ${Math.round(this.restartDelayMs / 1000)}s… (attempt ${this.state.restartCount})`;
    this._emitLog(this.state.message, 'yellow');
    this._emitState();

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.intentionalStop) return;
      this.state.status = 'loading';
      this.state.message = 'Loading corpus…';
      this._emitState();
      this._spawn();
    }, this.restartDelayMs);
  }

  _emitLog(line, level) {
    this.emit('log', { line, level, ts: Date.now() });
  }

  _emitState() {
    if (this.statsTimer) {
      clearTimeout(this.statsTimer);
      this.statsTimer = null;
    }
    this.emit('status', this.getState());
  }

  /** Coalesced status emit for high-frequency stat changes. */
  _emitStateThrottled() {
    if (this.statsTimer) return;
    this.statsTimer = setTimeout(() => {
      this.statsTimer = null;
      this.emit('status', this.getState());
    }, this.statsThrottleMs);
    if (this.statsTimer.unref) this.statsTimer.unref();
  }
}

module.exports = {
  WorkerManager,
  validateWorkerPath,
  classifyLine,
  DEFAULT_STATS,
  chooseWorkerPath,
  computeSetupPhase,
  readWorkerVersion,
  installDependencies,
};
