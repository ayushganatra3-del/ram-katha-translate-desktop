import { useState, useEffect, useRef } from "react";
import { T } from "./theme.js";
import { Button, IconButton, GearIcon, StopIcon, ExternalIcon, WarnIcon, Dot, Spinner, Logo } from "./ui.jsx";
import StatRow from "./StatRow.jsx";
import LogFeed from "./LogFeed.jsx";

const WATCH_BASE = "https://morari-translate.vercel.app/watch/";

const STATUS_META = {
  idle: { label: "IDLE", color: T.textMuted },
  loading: { label: "LOADING", color: T.yellow },
  running: { label: "RUNNING", color: T.green },
  restarting: { label: "RESTARTING", color: T.yellow },
  stopped: { label: "STOPPED", color: T.red },
  failed: { label: "FAILED", color: T.red },
};

export default function MonitorScreen({
  sessionConfig,
  status,
  stats,
  restartCount,
  lastError,
  logs,
  onStop,
  onOpenSettings,
}) {
  const sessionCode = (sessionConfig && sessionConfig.sessionCode) || "—";
  const mode = (sessionConfig && sessionConfig.mode) || "live";
  const uptime = useUptime();
  const meta = STATUS_META[status] || STATUS_META.idle;

  const openWatchPage = () => {
    if (sessionCode && sessionCode !== "—") window.open(WATCH_BASE + sessionCode, "_blank");
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: T.bg, padding: 20, gap: 14 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: "12px 18px",
        }}
      >
        <Logo size={30} />
        <div>
          <div style={{ fontSize: 11, color: T.textMuted, letterSpacing: 0.5 }}>SESSION</div>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 2 }}>{sessionCode}</div>
        </div>

        <Divider />
        <HeaderStat label="MODE" value={mode.toUpperCase()} />
        <Divider />
        <HeaderStat label="UPTIME" value={uptime} mono />

        <div style={{ flex: 1 }} />

        {/* LIVE indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Dot color={meta.color} blink={status === "running"} />
          <span style={{ fontWeight: 800, letterSpacing: 1, color: meta.color }}>
            {status === "running" ? "LIVE" : meta.label}
          </span>
        </div>

        <IconButton title="Settings" onClick={onOpenSettings} style={{ marginLeft: 6 }}>
          <GearIcon />
        </IconButton>
      </div>

      {/* Status banners */}
      {status === "loading" && (
        <Banner color={T.yellow}>
          <Spinner color={T.yellow} /> Loading corpus from Supabase… the worker is starting up (~10s).
        </Banner>
      )}
      {status === "restarting" && (
        <Banner color={T.yellow}>
          <WarnIcon /> Worker restarting… (attempt {restartCount}). Auto-recovering after a crash.
        </Banner>
      )}
      {status === "failed" && (
        <Banner color={T.red}>
          <WarnIcon />
          <div>
            <div style={{ fontWeight: 700 }}>Worker failed — auto-restart disabled after 3 crashes.</div>
            {lastError && (
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2, fontFamily: "monospace" }}>{lastError}</div>
            )}
          </div>
        </Banner>
      )}

      {/* Worker status pill row */}
      <WorkerStatusBar status={status} meta={meta} />

      {/* Stats */}
      <StatRow stats={stats} />

      {/* Log feed */}
      <LogFeed logs={logs} />

      {/* Controls */}
      <div style={{ display: "flex", gap: 12 }}>
        <Button variant="danger" onClick={onStop} style={{ flex: 1 }}>
          <StopIcon /> STOP SESSION
        </Button>
        <Button variant="blue" onClick={openWatchPage} style={{ flex: 1 }}>
          <ExternalIcon /> OPEN WATCH PAGE
        </Button>
      </div>
    </div>
  );
}

function WorkerStatusBar({ status, meta }) {
  const isUp = status === "running";
  const isWarn = status === "loading" || status === "restarting";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 13,
        color: T.textMuted,
      }}
    >
      <span>Worker status:</span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          background: `${meta.color}1f`,
          border: `1px solid ${meta.color}66`,
          color: meta.color,
          borderRadius: 20,
          padding: "4px 12px",
          fontWeight: 800,
          letterSpacing: 0.6,
        }}
      >
        {isWarn ? <Spinner size={12} color={meta.color} /> : <Dot color={meta.color} size={8} blink={isUp} />}
        {meta.label}
      </span>
    </div>
  );
}

function HeaderStat({ label, value, mono }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: T.textMuted, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, fontFamily: mono ? "monospace" : "inherit" }}>{value}</div>
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 34, background: T.border }} />;
}

function Banner({ color, children }) {
  return (
    <div
      className="mt-fadein"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: `${color}18`,
        border: `1px solid ${color}66`,
        color,
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}

function useUptime() {
  const startRef = useRef(Date.now());
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.floor((Date.now() - startRef.current) / 1000);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
