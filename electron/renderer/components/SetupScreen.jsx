import { useState, useEffect, useCallback } from "react";
import { T, styles } from "./theme.js";
import { Button, IconButton, GearIcon, PlayIcon, RefreshIcon, WarnIcon, Logo, Spinner } from "./ui.jsx";

const SESSION_CODE_RE = /^[A-Z0-9]{4,8}$/;
const TIME_RE = /^(\d{1,2}:)?\d{1,2}:\d{2}$/; // mm:ss or h:mm:ss

export default function SetupScreen({ settings, workerValidation, onStart, onOpenSettings, onRefresh }) {
  const [sessionCode, setSessionCode] = useState((settings.SESSION_CODE || "").toUpperCase());
  const [mode, setMode] = useState("live");
  const [audioDevices, setAudioDevices] = useState([]);
  const [audioDeviceId, setAudioDeviceId] = useState("");
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [startPosition, setStartPosition] = useState("00:00");
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      const devices = await window.workerAPI.listAudioDevices();
      setAudioDevices(devices);
      setAudioDeviceId((prev) => {
        if (prev && devices.some((d) => d.deviceId === prev)) return prev;
        return devices.length ? devices[0].deviceId : "";
      });
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === "live") loadDevices();
  }, [mode, loadDevices]);

  const workerOk = workerValidation && workerValidation.valid;

  const validate = () => {
    if (!SESSION_CODE_RE.test(sessionCode)) {
      return "Session Code must be 4–8 uppercase letters/numbers (e.g. GSJZ76).";
    }
    if (mode === "watchback") {
      if (!youtubeUrl.trim()) return "Enter a YouTube URL for watchback mode.";
      if (!/^https?:\/\//i.test(youtubeUrl.trim())) return "YouTube URL must start with http(s)://";
      if (startPosition.trim() && !TIME_RE.test(startPosition.trim())) {
        return "Start Position must be mm:ss (e.g. 12:30).";
      }
    }
    return null;
  };

  const handleStart = async () => {
    setError(null);
    if (!workerOk) {
      setError(workerValidation.error);
      return;
    }
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    const selected = audioDevices.find((d) => d.deviceId === audioDeviceId);
    const cfg = {
      sessionCode: sessionCode.trim().toUpperCase(),
      mode,
      audioDeviceId: mode === "live" ? audioDeviceId : "",
      audioDeviceLabel: mode === "live" && selected ? selected.label : "",
      youtubeUrl: mode === "watchback" ? youtubeUrl.trim() : "",
      startPosition: mode === "watchback" ? startPosition.trim() : "",
    };
    setStarting(true);
    try {
      const res = await onStart(cfg);
      if (!res || !res.ok) setError((res && res.error) || "Failed to start the worker.");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div style={{ height: "100%", overflowY: "auto", background: T.bg }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "28px 24px 48px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 28 }}>
          <Logo />
          <div style={{ marginLeft: 12, flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 0.3 }}>Morari Translate</div>
            <div style={{ fontSize: 12, color: T.textMuted }}>Live Katha Captioning</div>
          </div>
          <IconButton title="Settings" onClick={onOpenSettings}>
            <GearIcon />
          </IconButton>
        </div>

        {/* Worker not ready banner */}
        {!workerOk && (
          <Banner color={T.yellow} icon={<WarnIcon />}>
            <div style={{ flex: 1 }}>{workerValidation.error}</div>
            <button
              onClick={onOpenSettings}
              style={{ background: "transparent", color: T.yellow, border: `1px solid ${T.yellow}`, borderRadius: 8, padding: "6px 12px", fontWeight: 700 }}
            >
              Open Settings
            </button>
          </Banner>
        )}

        <div style={{ ...styles.card }}>
          <h2 style={{ margin: "0 0 18px", fontSize: 16 }}>New Session</h2>

          {/* Session code */}
          <Field label="Session Code" help="4–8 letters/numbers. This is what viewers use to watch.">
            <input
              style={{ ...styles.input, letterSpacing: 3, fontWeight: 700, fontSize: 18 }}
              value={sessionCode}
              maxLength={8}
              placeholder="GSJZ76"
              onChange={(e) => setSessionCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            />
          </Field>

          {/* Mode toggle */}
          <Field label="Mode">
            <div style={{ display: "flex", gap: 8 }}>
              <ModeButton active={mode === "live"} onClick={() => setMode("live")}>
                🎙️ LIVE
              </ModeButton>
              <ModeButton active={mode === "watchback"} onClick={() => setMode("watchback")}>
                ▶️ WATCHBACK
              </ModeButton>
            </div>
          </Field>

          {/* Live: audio input */}
          {mode === "live" && (
            <Field label="Audio Input" help="System microphone or line-in used to capture the katha audio.">
              <div style={{ display: "flex", gap: 8 }}>
                <select
                  style={{ ...styles.input, flex: 1 }}
                  value={audioDeviceId}
                  onChange={(e) => setAudioDeviceId(e.target.value)}
                >
                  {audioDevices.length === 0 && <option value="">No input devices found</option>}
                  {audioDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
                <IconButton title="Refresh devices" onClick={loadDevices}>
                  {devicesLoading ? <Spinner size={16} /> : <RefreshIcon />}
                </IconButton>
              </div>
            </Field>
          )}

          {/* Watchback: youtube url + start */}
          {mode === "watchback" && (
            <>
              <Field label="YouTube URL">
                <input
                  style={styles.input}
                  value={youtubeUrl}
                  placeholder="https://www.youtube.com/watch?v=..."
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                />
              </Field>
              <Field label="Start Position" help="Where to begin in the video (mm:ss).">
                <input
                  style={{ ...styles.input, width: 140 }}
                  value={startPosition}
                  placeholder="00:00"
                  onChange={(e) => setStartPosition(e.target.value)}
                />
              </Field>
            </>
          )}

          {error && (
            <Banner color={T.red} icon={<WarnIcon />}>
              <div style={{ flex: 1 }}>{error}</div>
            </Banner>
          )}

          <Button
            variant="primary"
            disabled={!workerOk || starting}
            style={{ width: "100%", marginTop: 8, padding: "14px 20px", fontSize: 15 }}
            onClick={handleStart}
          >
            {starting ? <Spinner size={16} color="#1a1a1a" /> : <PlayIcon />}
            {starting ? "STARTING…" : "START SESSION"}
          </Button>
        </div>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: T.textMuted }}>
          Captions will be available at{" "}
          <span style={{ color: T.saffron }}>
            morari-translate.vercel.app/watch/{sessionCode || "CODE"}
          </span>
        </div>
      </div>
    </div>
  );
}

function Field({ label, help, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={styles.label}>{label}</label>
      {children}
      {help && <div style={styles.help}>{help}</div>}
    </div>
  );
}

function ModeButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "12px",
        borderRadius: 8,
        fontWeight: 700,
        letterSpacing: 0.5,
        border: `1px solid ${active ? T.saffron : T.border}`,
        background: active ? `${T.saffron}22` : T.bg,
        color: active ? T.saffron : T.textMuted,
      }}
    >
      {children}
    </button>
  );
}

function Banner({ color, icon, children }) {
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
        padding: "12px 14px",
        marginBottom: 18,
        fontSize: 13,
      }}
    >
      <span style={{ display: "flex", flexShrink: 0 }}>{icon}</span>
      {children}
    </div>
  );
}
