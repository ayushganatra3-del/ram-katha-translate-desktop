// Design tokens (mirror styles.css :root) and reusable inline-style fragments.

export const T = {
  bg: "#1a1a1a",
  surface: "#2a2a2a",
  border: "#3a3a3a",
  text: "#ffffff",
  textMuted: "#888888",
  saffron: "#FF9800",
  green: "#4CAF50",
  red: "#f44336",
  yellow: "#FFC107",
  blue: "#2196F3",
};

// Map a log level to its colour.
export const LEVEL_COLORS = {
  green: T.green,
  red: T.red,
  yellow: T.yellow,
  blue: T.blue,
  white: T.text,
};

export const styles = {
  card: {
    background: T.surface,
    border: `1px solid ${T.border}`,
    borderRadius: 12,
    padding: 20,
  },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: T.textMuted,
    marginBottom: 6,
  },
  input: {
    width: "100%",
    background: T.bg,
    color: T.text,
    border: `1px solid ${T.border}`,
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 14,
    outline: "none",
  },
  help: {
    fontSize: 12,
    color: T.textMuted,
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: T.saffron,
    margin: "0 0 4px 0",
  },
};
