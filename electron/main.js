'use strict';

/**
 * main.js — Electron main process.
 * --------------------------------------------------------------------------
 *  - Creates the (secure) BrowserWindow and loads the renderer.
 *  - Owns the WorkerManager and forwards its events to the renderer over IPC.
 *  - Handles all privileged work: file I/O (env-store), worker spawning,
 *    external link opening, and audio permission grants.
 */

const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const path = require('path');

const envStore = require('./env-store');
const { ensureSession, SESSION_MODE_MIC, SESSION_MODE_YOUTUBE } = require('./supabase-session');
const {
  WorkerManager,
  validateWorkerPath,
  chooseWorkerPath,
  computeSetupPhase,
  readWorkerVersion,
  installDependencies,
} = require('./worker-manager');

const isDev = process.argv.includes('--dev');
// Test-only hook: when MT_SMOKE_SCREENSHOT points at a path, the app renders,
// writes a screenshot there and quits. Inert in normal/production use.
const smokeShot = process.env.MT_SMOKE_SCREENSHOT;

/** @type {BrowserWindow|null} */
let mainWindow = null;
const workerManager = new WorkerManager();

function userDataDir() {
  return app.getPath('userData');
}

// Resolve the worker directory. In a packaged build the worker ships inside the
// app (resources/worker) and needs no user config; in development we use the
// in-repo worker once it has source, otherwise a configured override.
//
// The electron/worker submodule is the *full* morari-translate repo, whose
// actual worker lives in a nested `worker/` subdirectory — so the dev source is
// electron/worker/worker (package.json + src/index.js live there). Packaged
// builds copy only that subdir to resources/worker (see electron-builder.yml).
function resolveWorkerPath(env) {
  return chooseWorkerPath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    bundledDir: path.join(__dirname, 'worker', 'worker'),
    overridePath: env && env.WORKER_PATH,
  });
}

// In packaged builds the worker path is automatic, so hide the Worker Path
// (developer-only) field from Settings.
function schemaForRenderer() {
  if (!app.isPackaged) return envStore.SCHEMA;
  return envStore.SCHEMA.filter((section) => section.id !== 'worker');
}

let setupInstallRunning = false;

// ---- Window -------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 880,
    minHeight: 620,
    backgroundColor: '#1a1a1a',
    title: 'Morari Translate',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs navigator.mediaDevices for audio enumeration
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Open all external links in the system browser (never inside Electron).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  if (smokeShot) runSmokeTest(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Render -> (optionally run MT_SMOKE_JS) -> screenshot -> quit, logging any
// renderer failures. Test aid only; gated entirely by MT_SMOKE_SCREENSHOT.
function runSmokeTest(win) {
  const fs = require('fs');
  const js = process.env.MT_SMOKE_JS;
  const delay = parseInt(process.env.MT_SMOKE_DELAY || '1800', 10);
  win.webContents.on('console-message', (_e, _level, message) => console.log('[renderer]', message));
  win.webContents.on('render-process-gone', (_e, details) => console.error('[render-process-gone]', details));
  win.webContents.on('did-finish-load', () => {
    setTimeout(async () => {
      try {
        if (js) await win.webContents.executeJavaScript(js, true);
        await new Promise((r) => setTimeout(r, delay));
        const img = await win.webContents.capturePage();
        fs.writeFileSync(smokeShot, img.toPNG());
        console.log('[smoke] screenshot written to', smokeShot);
      } catch (err) {
        console.error('[smoke] screenshot failed:', err.message);
      }
      app.quit();
    }, 600);
  });
}

// ---- Worker -> renderer plumbing ---------------------------------------

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

workerManager.on('log', (data) => sendToRenderer('worker-log', data));
workerManager.on('status', (data) => sendToRenderer('worker-status', data));

// ---- IPC handlers -------------------------------------------------------

ipcMain.handle('load-settings', () => {
  const env = envStore.loadEnv(userDataDir());
  const workerPath = resolveWorkerPath(env);
  return {
    env,
    schema: schemaForRenderer(),
    worker: validateWorkerPath(workerPath),
    config: envStore.validateConfig(env),
    appVersion: app.getVersion(),
    workerVersion: readWorkerVersion(workerPath),
    isPackaged: app.isPackaged,
  };
});

// First-launch setup status: is the bundled worker present and installed?
ipcMain.handle('get-setup-status', () => {
  const env = envStore.loadEnv(userDataDir());
  const workerPath = resolveWorkerPath(env);
  return {
    phase: computeSetupPhase(workerPath),
    workerPath,
    appVersion: app.getVersion(),
    workerVersion: readWorkerVersion(workerPath),
  };
});

// Run `npm install` in the bundled worker on first launch, streaming output.
ipcMain.handle('install-worker', async () => {
  if (setupInstallRunning) return { ok: false, error: 'Setup already running.' };
  const env = envStore.loadEnv(userDataDir());
  const workerPath = resolveWorkerPath(env);
  if (computeSetupPhase(workerPath) === 'missing') {
    return { ok: false, error: `Worker source not found at ${workerPath}.` };
  }
  setupInstallRunning = true;
  sendToRenderer('setup-log', 'Installing worker dependencies (first launch only)…');
  try {
    const result = await installDependencies(workerPath, (line) => sendToRenderer('setup-log', line));
    if (result.ok) sendToRenderer('setup-log', 'Done. Starting the app…');
    return result;
  } finally {
    setupInstallRunning = false;
  }
});

ipcMain.handle('save-settings', (_event, incoming) => {
  const env = { ...envStore.getDefaults(), ...(incoming || {}) };
  let savedPath = null;
  try {
    savedPath = envStore.saveEnv(userDataDir(), env);
  } catch (err) {
    return { ok: false, error: `Could not save settings: ${err.message}` };
  }
  const config = envStore.validateConfig(env);
  return {
    ok: true,
    path: savedPath,
    config,
    worker: validateWorkerPath(env.WORKER_PATH),
  };
});

ipcMain.handle('worker-start', async (_event, sessionConfig) => {
  const env = envStore.loadEnv(userDataDir());

  // Validate the saved config before spawning a doomed worker.
  const merged = { ...env, SESSION_CODE: (sessionConfig && sessionConfig.sessionCode) || env.SESSION_CODE };
  const config = envStore.validateConfig(merged);
  if (!config.ok) {
    return { ok: false, error: `Config error: ${config.fatal}` };
  }

  // Auto-create the session in Supabase so the worker never crashes with
  // "Session not found" the first time a code is used. Best-effort and
  // non-blocking: if it fails (already exists, or table/column differs) we log
  // a warning and still start — an existing session is found by the worker.
  const sessionCode = String(merged.SESSION_CODE || '').trim().toUpperCase();
  if (sessionCode) {
    // The worker reads mode/status from the session ROW (not the MODE env var).
    // Pick the mode from the Setup-screen selection (LIVE/mic vs WATCHBACK/
    // YouTube) and force status=live so the worker starts capturing immediately
    // instead of sitting in "waiting for live".
    const isWatchback = String((sessionConfig && sessionConfig.mode) || 'live').toLowerCase() === 'watchback';
    const sessionMode = isWatchback ? SESSION_MODE_YOUTUBE : SESSION_MODE_MIC;
    const r = await ensureSession({
      url: env.SUPABASE_URL,
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
      sessionCode,
      mode: sessionMode,
      status: 'live',
    });
    sendToRenderer(
      'worker-log',
      r.ok
        ? { line: `[session] session "${sessionCode}" set live (mode=${sessionMode}, status=live)`, level: 'green', ts: Date.now() }
        : { line: `[session] could not set session "${sessionCode}": ${r.error} — starting anyway`, level: 'yellow', ts: Date.now() }
    );
  }

  const workerEnv = envStore.toWorkerEnv(env, sessionConfig || {});
  return workerManager.start({ workerPath: resolveWorkerPath(env), env: workerEnv });
});

ipcMain.handle('worker-stop', () => workerManager.stop());

// ---- App lifecycle ------------------------------------------------------

// Single-instance: a second launch focuses the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // Grant microphone access so the renderer can enumerate input devices.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'media' || permission === 'microphone' || permission === 'audioCapture');
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
      permission === 'media' || permission === 'microphone' || permission === 'audioCapture'
    );

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

// Ensure the detached worker never outlives the app (Part 2 #9).
app.on('before-quit', () => {
  workerManager.killNow();
});

app.on('window-all-closed', () => {
  workerManager.killNow();
  app.quit();
});
