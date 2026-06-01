import { T } from "./theme.js";

// Stats row: STT provider | translation model | corpus entries |
// canonical hits this session | avg translation latency.
export default function StatRow({ stats }) {
  const s = stats || {};
  const stt = s.sttProvider ? `${s.sttProvider}${s.sttModel ? " / " + s.sttModel : ""}` : "—";
  const cells = [
    { label: "STT Provider", value: stt },
    { label: "Translation Model", value: s.translationModel || "—" },
    { label: "Corpus Entries", value: fmtNum(s.corpusEntries) },
    { label: "Canonical Hits", value: s.canonicalHits != null ? String(s.canonicalHits) : "0", accent: true },
    { label: "Avg Latency", value: s.avgLatencyMs != null ? `${s.avgLatencyMs} ms` : "—" },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cells.length}, 1fr)`,
        gap: 1,
        background: T.border,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {cells.map((c) => (
        <div key={c.label} style={{ background: T.surface, padding: "12px 14px" }}>
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color: T.textMuted,
              marginBottom: 4,
              whiteSpace: "nowrap",
            }}
          >
            {c.label}
          </div>
          <div
            title={String(c.value)}
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: c.accent ? T.saffron : T.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function fmtNum(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString();
}
