import { useState, useEffect, useCallback, useRef } from "react";
import SetupScreen from "./SetupScreen.jsx";
import MonitorScreen from "./MonitorScreen.jsx";
import SettingsScreen from "./SettingsScreen.jsx";
import FirstRunScreen from "./FirstRunScreen.jsx";
import { T } from "./theme.js";
import { Logo, Spinner, Button, IconButton, GearIcon, WarnIcon } from "./ui.jsx";

const DEFAULT_STATS = {
  sttProvider: null,
  sttModel: null,
  translationModel: null,
  lockedWork: null,
  corpusEntries: null,
  canonicalHits: 0,
  avgLatencyMs: null,
};

const MAX_LOGS = 250;

export default function App() {
  // Startup gate: checking -> (first-run | missing) -> ready
  const [phase, setPhase] = useState("checking");
  const [versions, setVersions] = useState({ app: null, worker: null });
  const [isPackaged, setIsPackaged] = useState(false);

  const [screen, setScreen] = useState("setup"); // setup | monitor | settings
  const returnScreenRef = useRef("setup");

  const [settings, setSettings] = useState(null);
  const [schema, setSchema] = useState([]);
  const [workerValidation, setWorkerValidation] = useState({ valid: false, error: "Loading…" });

  const [sessionConfig, setSessionConfig] = useState(null);
  const [status, setStatus] = useState("idle");
  const [stats, setStats] = useState(DEFAULT_STATS);
  const [restartCount, setRestartCount] = useState(0);
  const [lastError, setLastError] = useState(null);

  const [logs, setLogs] = useState([]);
  const logIdRef = useRef(0);

  const refreshSettings = useCallback(async () => {
    const res = await window.workerAPI.loadSettings();
    setSettings(res.env);
    setSchema(res.schema);
    setWorkerValidation(res.worker);
    setVersions({ app: res.appVersion, worker: res.workerVersion });
    setIsPackaged(!!res.isPackaged);
    return res;
  }, []);

  const init = useCallback(async () => {
    const st = await window.workerAPI.getSetupStatus();
    setVersions({ app: st.appVersion, worker: st.workerVersion });
    await refreshSettings();
    if (st.phase === "needs-install") setPhase("first-run");
    else if (st.phase === "missing") setPhase("missing");
    else setPhase("ready");
  }, [refreshSettings]);

  useEffect(() => {
    init();
  }, [init]);

  // Subscribe to worker streams once.
  useEffect(() => {
    const offLog = window.workerAPI.onLog((d) => {
      setLogs((prev) => {
        const next = prev.concat({ id: logIdRef.current++, ...d });
        return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
      });
    });
    const offStatus = window.workerAPI.onStatus((s) => {
      setStatus(s.status);
      setStats(s.stats || DEFAULT_STATS);
      setRestartCount(s.restartCount || 0);
      if (s.lastError) setLastError(s.lastError);
    });
    return () => {
      offLog && offLog();
      offStatus && offStatus();
    };
  }, []);

  const handleStart = useCallback(async (cfg) => {
    setLogs([]);
    setStats(DEFAULT_STATS);
    setLastError(null);
    setRestartCount(0);
    setStatus("loading");
    setSessionConfig(cfg);
    const res = await window.workerAPI.start(cfg);
    if (res && res.ok) setScreen("monitor");
    else setStatus("idle");
    return res;
  }, []);

  const handleStop = useCallback(async () => {
    await window.workerAPI.stop();
    setScreen("setup");
  }, []);

  const openSettings = useCallback(() => {
    returnScreenRef.current = screen;
    setScreen("settings");
  }, [screen]);

  const closeSettings = useCallback(async () => {
    await init();
    setScreen(returnScreenRef.current || "setup");
  }, [init]);

  if (phase === "checking") return <CenterShell>Loading Morari Translate…</CenterShell>;

  // Settings is reachable from any phase (so a dev can set a worker path, etc.).
  if (screen === "settings" && settings) {
    return <SettingsScreen settings={settings} schema={schema} versions={versions} onClose={closeSettings} />;
  }

  if (phase === "first-run") return <FirstRunScreen onComplete={init} />;
  if (phase === "missing") return <WorkerMissingScreen isPackaged={isPackaged} onOpenSettings={openSettings} />;

  if (!settings) return <CenterShell>Loading…</CenterShell>;

  if (screen === "monitor") {
    return (
      <MonitorScreen
        sessionConfig={sessionConfig}
        status={status}
        stats={stats}
        restartCount={restartCount}
        lastError={lastError}
        logs={logs}
        onStop={handleStop}
        onOpenSettings={openSettings}
      />
    );
  }
  return (
    <SetupScreen
      settings={settings}
      workerValidation={workerValidation}
      onStart={handleStart}
      onOpenSettings={openSettings}
      onRefresh={refreshSettings}
    />
  );
}

function CenterShell({ children }) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        background: T.bg,
      }}
    >
      <Logo size={56} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, color: T.textMuted }}>
        <Spinner /> {children}
      </div>
    </div>
  );
}

function WorkerMissingScreen({ isPackaged, onOpenSettings }) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        background: T.bg,
        padding: 32,
        textAlign: "center",
      }}
    >
      <Logo size={56} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, color: T.red, fontWeight: 700, fontSize: 18 }}>
        <WarnIcon /> Captioning engine not found
      </div>
      <p style={{ color: T.textMuted, maxWidth: 520, margin: 0 }}>
        {isPackaged
          ? "This build doesn't contain the worker. Please reinstall the latest release."
          : "The bundled worker (electron/worker) has no source yet. Copy the morari-translate worker files into it, or set a Worker Path in Settings to point at an existing worker."}
      </p>
      {!isPackaged && (
        <Button variant="ghost" onClick={onOpenSettings} style={{ marginTop: 8 }}>
          <GearIcon size={16} /> Open Settings
        </Button>
      )}
    </div>
  );
}
