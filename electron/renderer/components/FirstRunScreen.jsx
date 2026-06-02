import { useEffect, useRef, useState } from "react";
import { T } from "./theme.js";
import { Logo, Spinner, Button, WarnIcon } from "./ui.jsx";

// First-launch screen: installs the bundled worker's dependencies once.
export default function FirstRunScreen({ onComplete }) {
  const [lines, setLines] = useState([]);
  const [installing, setInstalling] = useState(true);
  const [error, setError] = useState(null);
  const boxRef = useRef(null);
  const startedRef = useRef(false);

  const run = () => {
    setError(null);
    setInstalling(true);
    setLines([]);
    window.workerAPI.installWorker().then((res) => {
      setInstalling(false);
      if (res && res.ok) onComplete();
      else setError((res && res.error) || "Setup failed.");
    });
  };

  useEffect(() => {
    const off = window.workerAPI.onSetupLog((line) => {
      setLines((prev) => {
        const next = prev.concat(line);
        return next.length > 200 ? next.slice(next.length - 200) : next;
      });
    });
    if (!startedRef.current) {
      startedRef.current = true;
      run();
    }
    return () => off && off();
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: T.bg,
        padding: 32,
      }}
    >
      <Logo size={56} />
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: "18px 0 6px" }}>First-time setup</h1>
      <p style={{ color: T.textMuted, margin: 0, textAlign: "center" }}>
        Installing the captioning engine — this happens only once (about 30 seconds).
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "20px 0 14px", height: 22 }}>
        {installing && (
          <>
            <Spinner /> <span style={{ color: T.saffron, fontWeight: 600 }}>Installing dependencies…</span>
          </>
        )}
      </div>

      <div
        ref={boxRef}
        className="selectable"
        style={{
          width: "min(680px, 92%)",
          height: 220,
          overflowY: "auto",
          background: "#141414",
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          padding: "10px 14px",
          fontFamily: "'SF Mono', Menlo, Consolas, monospace",
          fontSize: 12,
          lineHeight: 1.6,
          color: T.textMuted,
        }}
      >
        {lines.length === 0 && <div>Preparing…</div>}
        {lines.map((l, i) => (
          <div key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {l}
          </div>
        ))}
      </div>

      {error && (
        <div
          style={{
            width: "min(680px, 92%)",
            marginTop: 16,
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: `${T.red}18`,
            border: `1px solid ${T.red}66`,
            color: T.red,
            borderRadius: 10,
            padding: "12px 14px",
          }}
        >
          <WarnIcon />
          <div style={{ flex: 1, fontSize: 13 }}>{error}</div>
          <Button variant="ghost" onClick={run}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
