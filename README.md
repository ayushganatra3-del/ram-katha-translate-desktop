# Morari Translate — Desktop

A cross-platform desktop app that wraps the **morari-translate** live katha
captioning worker. An event organiser opens the app, enters a session code and
audio source, presses **Start**, and captions flow to viewers — no terminal, no
batch files, no technical knowledge required.

Replaces the old "run a batch file + keep a terminal alive" setup.

![icon](build/icon.png)

---

## What it does

Three screens:

1. **Setup** — session code, LIVE (mic/line-in) or WATCHBACK (YouTube URL),
   audio-input picker, and a **Start Session** button.
2. **Monitor** — live header (session, mode, uptime, LIVE dot), a stats row
   (STT provider · translation model · corpus entries · canonical hits · avg
   latency), a colour-coded log feed, worker status (RUNNING / RESTARTING /
   STOPPED / FAILED), **Stop Session** and **Open Watch Page**.
3. **Settings** — every worker env var, grouped into sections; sensitive keys
   are masked with a show/hide toggle. Saves to `{userData}/worker.env` and runs
   a config validator that reports **CONFIG OK** or the error inline.

The worker is launched as a **child process** with stdout/stderr piped into the
log feed. On a non-zero crash it auto-restarts after 3s; after 3 crashes in 60s
it stops and shows a red **FAILED** banner. The worker is always killed on app
quit (no orphans).

---

## Project layout

```
ram-katha-translate-desktop/
  electron/
    main.js              Electron main process (window, IPC, lifecycle)
    preload.js           contextBridge -> window.workerAPI (the only bridge)
    worker-manager.js    spawn / monitor / restart + CONFIG OK parsing
    env-store.js         config schema, worker.env read/write, validation
    renderer/
      index.html         renderer shell (loads dist/bundle.js)
      styles.css         global styles, design tokens, animations
      index.js           React entry
      components/
        App.jsx          root: screen routing + worker event wiring
        SetupScreen.jsx
        MonitorScreen.jsx
        SettingsScreen.jsx
        LogFeed.jsx
        StatRow.jsx
        theme.js         design tokens + shared style fragments
        ui.jsx           shared atoms (buttons, icons, spinner, logo)
  scripts/
    build-renderer.js    esbuild bundler for the renderer
    generate-assets.js   makes build/icon.png + dmg background (sharp)
    test/run-all.js      headless test suite (no Electron required)
    mock-worker/         fake worker for trying the app without the real repo
  build/                 packaging assets (icon, dmg background) — committed
  package.json
  electron-builder.yml   .dmg (mac) + .exe NSIS (win) config
```

---

## Prerequisites

- **Node.js 18+** installed and on the `PATH` (the worker is run as `node`).
- The **morari-translate worker** repo on the same machine, with its
  dependencies installed (`npm install` inside the worker folder so
  `node_modules` exists).

---

## Develop / run

```bash
npm install
npm start        # bundles the renderer, then launches Electron
npm run dev      # same, with DevTools open
```

`npm start` always rebuilds `electron/renderer/dist/bundle.js` first, so there is
no separate build step to remember.

### Try it without the real worker

A mock worker is included that imitates the real worker's output (startup, the
`CONFIG OK` line, canonical hits, translations with latency, warns, locked-work):

```bash
cd scripts/mock-worker && npm install && cd ../..   # creates node_modules
npm start
```

Then in **Settings** set **Worker Path** to the absolute path of
`scripts/mock-worker`, fill the required keys with any non-empty value, save,
and press **Start Session** on the Setup screen.

---

## Configuration

All settings are edited in the **Settings** screen and stored in
`{userData}/worker.env`:

| OS      | Location                                                            |
| ------- | ------------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/morari-translate-desktop/worker.env` |
| Windows | `%APPDATA%\morari-translate-desktop\worker.env`                     |
| Linux   | `~/.config/morari-translate-desktop/worker.env`                     |

See [`.env.example`](.env.example) for the full annotated list. Critical values
(pre-filled as defaults): `STT_PROVIDER=sarvam`,
`TRANSLATION_OPENAI_BASE_URL=https://openrouter.ai/api/v1`,
`DEFAULT_MODEL=google/gemini-2.5-flash`, `LOCKED_WORK_MODE=on`.

The session source (mode / audio device / YouTube URL / start position) is set
per-event on the Setup screen and passed to the worker at launch as
`MODE`, `AUDIO_INPUT_DEVICE`, `WATCHBACK_URL`, `WATCHBACK_START_SECONDS`.

---

## Build installers

```bash
npm run build:mac    # -> dist-build/Morari Translate-1.0.0-{arm64,x64}.dmg
npm run build:win    # -> dist-build/Morari Translate-Setup-1.0.0.exe (NSIS)
npm run build:all    # both (where the host toolchain allows)
```

> **Cross-compilation note:** a macOS `.dmg` can only be produced on macOS.
> Build the Mac installer on a Mac and the Windows installer on Windows (or a
> CI matrix). The packaging config, app structure and icon pipeline are
> identical across targets and validated in CI via an unpacked build.

Icons/backgrounds in `build/` are committed, so packaging needs no extra tools.
To regenerate them: `npm run generate-assets`.

---

## Test

```bash
npm test
```

Runs a headless suite (no Electron) covering config defaults, `worker.env`
round-trips, the config validator, the session→env mapping, log-line
classification, worker-path validation, and — against real child processes — a
full start → CONFIG OK → stats → stop cycle plus the crash auto-restart and
3-strike circuit breaker.

---

## Design notes / deviations from the original brief

- **Renderer bundling (esbuild, not CDN `<script>` tags).** The brief sketched
  loading React/Babel from a CDN with no build step. That does not work in
  practice: Electron serves the renderer over `file://`, where Babel-standalone
  cannot fetch external `.jsx` files (Chromium blocks cross-`file://` fetches),
  and a CDN dependency breaks the app offline. To honour the intent ("no
  webpack, keep it simple, works on first run") while being production-robust,
  the separate `.jsx` components + React are bundled locally with **esbuild** (a
  single tiny dependency). The UI/behaviour is identical and fully offline.
- **`listAudioDevices` uses `navigator.mediaDevices`** in the preload rather
  than an IPC call — the main process cannot enumerate audio inputs without
  native modules (Part 1 of the brief specifies `enumerateDevices`). The
  `window.workerAPI` surface is otherwise exactly as specified.
- **Open Watch Page** uses `window.open`, intercepted by the main process and
  routed to `shell.openExternal` — keeps the preload surface to the specified
  methods while never opening links inside Electron.
- **Session-source env var names** (`MODE`, `AUDIO_INPUT_DEVICE`,
  `WATCHBACK_URL`, `WATCHBACK_START_SECONDS`) are best-effort, as the brief did
  not list them. Adjust the mapping in `electron/env-store.js` →
  `toWorkerEnv()` if your worker build expects different names.

---

## Security

Standard Electron hardening: `contextIsolation: true`, `nodeIntegration:
false`, a strict Content-Security-Policy, a single privileged bridge
(`preload.js`), external links forced through `shell.openExternal`, and a
single-instance lock. API keys live only in `worker.env` on the user's machine.
