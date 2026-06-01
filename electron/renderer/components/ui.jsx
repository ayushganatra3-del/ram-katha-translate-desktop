// Small shared UI atoms: buttons, icons, spinner, status dot, logo.
import { T } from "./theme.js";

// ---- Buttons ------------------------------------------------------------

const BTN_BASE = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  border: "none",
  borderRadius: 10,
  padding: "12px 20px",
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: 0.4,
  transition: "filter 0.12s ease, opacity 0.12s ease",
};

const VARIANTS = {
  primary: { background: T.saffron, color: "#1a1a1a" },
  danger: { background: T.red, color: "#ffffff" },
  ghost: { background: "transparent", color: T.text, border: `1px solid ${T.border}` },
  blue: { background: T.blue, color: "#ffffff" },
};

export function Button({ variant = "primary", disabled, style, children, ...rest }) {
  const v = VARIANTS[variant] || VARIANTS.primary;
  return (
    <button
      disabled={disabled}
      style={{ ...BTN_BASE, ...v, opacity: disabled ? 0.45 : 1, ...style }}
      onMouseOver={(e) => !disabled && (e.currentTarget.style.filter = "brightness(1.1)")}
      onMouseOut={(e) => (e.currentTarget.style.filter = "none")}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconButton({ title, onClick, children, style }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 38,
        height: 38,
        borderRadius: 9,
        background: "transparent",
        border: `1px solid ${T.border}`,
        color: T.textMuted,
        ...style,
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.color = T.text;
        e.currentTarget.style.borderColor = T.saffron;
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.color = T.textMuted;
        e.currentTarget.style.borderColor = T.border;
      }}
    >
      {children}
    </button>
  );
}

// ---- Icons (inline SVG, currentColor) ----------------------------------

const svgProps = (size) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
});

export const GearIcon = ({ size = 20 }) => (
  <svg {...svgProps(size)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const PlayIcon = ({ size = 18 }) => (
  <svg {...svgProps(size)} fill="currentColor" stroke="none">
    <path d="M8 5v14l11-7z" />
  </svg>
);

export const StopIcon = ({ size = 16 }) => (
  <svg {...svgProps(size)} fill="currentColor" stroke="none">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

export const ExternalIcon = ({ size = 16 }) => (
  <svg {...svgProps(size)}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

export const RefreshIcon = ({ size = 16 }) => (
  <svg {...svgProps(size)}>
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

export const BackIcon = ({ size = 18 }) => (
  <svg {...svgProps(size)}>
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

export const EyeIcon = ({ size = 18 }) => (
  <svg {...svgProps(size)}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const EyeOffIcon = ({ size = 18 }) => (
  <svg {...svgProps(size)}>
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

export const WarnIcon = ({ size = 16 }) => (
  <svg {...svgProps(size)}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

// ---- Spinner & status dot ----------------------------------------------

export function Spinner({ size = 16, color = T.saffron }) {
  return (
    <span
      className="mt-spin"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        border: `2px solid ${color}40`,
        borderTopColor: color,
        borderRadius: "50%",
      }}
    />
  );
}

export function Dot({ color = T.green, size = 10, blink = false }) {
  return (
    <span
      className={blink ? "mt-blink" : undefined}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        boxShadow: `0 0 8px ${color}`,
      }}
    />
  );
}

// ---- Logo ---------------------------------------------------------------

export function Logo({ size = 34 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `radial-gradient(circle at 30% 30%, ${T.saffron}, #e65100)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#1a1a1a",
        fontWeight: 900,
        fontSize: size * 0.4,
        letterSpacing: 0.5,
        flexShrink: 0,
        boxShadow: `0 0 14px ${T.saffron}55`,
      }}
    >
      MT
    </div>
  );
}
