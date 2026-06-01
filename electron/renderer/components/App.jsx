import { useState, useEffect, useCallback, useRef } from "react";
import SetupScreen from "./SetupScreen.jsx";
import MonitorScreen from "./MonitorScreen.jsx";
import SettingsScreen from "./SettingsScreen.jsx";
import { T } from "./theme.js";
import { Logo, Spinner } from "./ui.jsx";

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
  const [screen, setScreen] = useState("setup"); // setup | monitor | settings
  const returnScreenRef = useRef("setup");

  const [settings, setSettings] = useState(null); // env object
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
    return res;
  }, []);

  // Initial load.
  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

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
    if (res && res.ok) {
      setScreen("monitor");
    } else {
      setStatus("idle");
    }
    return res; // SetupScreen surfaces res.error when !ok
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
    await refreshSettings();
    setScreen(returnScreenRef.current || "setup");
  }, [refreshSettings]);

  if (!settings) return <LoadingShell />;

  if (screen === "settings") {
    return <SettingsScreen settings={settings} schema={schema} onClose={closeSettings} />;
  }
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

function LoadingShell() {
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
        <Spinner /> Loading Morari Translate…
      </div>
    </div>
  );
}
