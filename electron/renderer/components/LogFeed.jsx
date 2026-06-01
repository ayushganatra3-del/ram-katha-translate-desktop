import { useRef, useLayoutEffect, useState } from "react";
import { T, LEVEL_COLORS } from "./theme.js";

// Scrolling, colour-coded log feed. Auto-scrolls to the newest line unless the
// user has scrolled up to read history.
export default function LogFeed({ logs }) {
  const containerRef = useRef(null);
  const stickRef = useRef(true); // stick to bottom?
  const [pinned, setPinned] = useState(true);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    stickRef.current = atBottom;
    setPinned(atBottom);
  };

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [logs]);

  const jumpToBottom = () => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      stickRef.current = true;
      setPinned(true);
    }
  };

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="selectable"
        style={{
          height: "100%",
          overflowY: "auto",
          background: "#141414",
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: "10px 14px",
          fontFamily: "'SF Mono', Menlo, Consolas, 'Courier New', monospace",
          fontSize: 12.5,
          lineHeight: 1.6,
        }}
      >
        {logs.length === 0 && (
          <div style={{ color: T.textMuted, padding: 8 }}>Waiting for worker output…</div>
        )}
        {logs.map((log) => (
          <div
            key={log.id}
            className="mt-fadein"
            style={{ color: LEVEL_COLORS[log.level] || T.text, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          >
            <span style={{ color: T.textMuted, marginRight: 8 }}>{fmtTime(log.ts)}</span>
            {log.line}
          </div>
        ))}
      </div>

      {!pinned && (
        <button
          onClick={jumpToBottom}
          style={{
            position: "absolute",
            right: 16,
            bottom: 12,
            background: T.saffron,
            color: "#1a1a1a",
            border: "none",
            borderRadius: 20,
            padding: "6px 14px",
            fontSize: 12,
            fontWeight: 700,
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          }}
        >
          ↓ Jump to latest
        </button>
      )}
    </div>
  );
}

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
