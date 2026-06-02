import { useState } from "react";
import { T, styles } from "./theme.js";
import { Button, IconButton, BackIcon, EyeIcon, EyeOffIcon, WarnIcon, Spinner } from "./ui.jsx";

export default function SettingsScreen({ settings, schema, versions, onClose }) {
  const [form, setForm] = useState({ ...settings });
  const [reveal, setReveal] = useState({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null); // { config, worker, path }

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const toggleReveal = (key) => setReveal((r) => ({ ...r, [key]: !r[key] }));

  const handleSave = async () => {
    setSaving(true);
    setResult(null);
    try {
      const res = await window.workerAPI.saveSettings(form);
      setResult(res);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: T.bg }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "16px 24px",
          borderBottom: `1px solid ${T.border}`,
        }}
      >
        <IconButton title="Back" onClick={onClose}>
          <BackIcon />
        </IconButton>
        <div style={{ fontSize: 18, fontWeight: 800 }}>Settings</div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: T.textMuted }}>Saved to this computer</span>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          {schema.map((section) => (
            <div key={section.id} style={{ ...styles.card, marginBottom: 18 }}>
              <h3 style={styles.sectionTitle}>{section.title}</h3>
              {section.description && (
                <p style={{ margin: "0 0 16px", fontSize: 13, color: T.textMuted }}>{section.description}</p>
              )}

              {section.note && (
                <pre
                  className="selectable"
                  style={{
                    background: T.bg,
                    border: `1px solid ${T.border}`,
                    borderRadius: 8,
                    padding: "12px 14px",
                    margin: 0,
                    fontSize: 12.5,
                    color: T.textMuted,
                    whiteSpace: "pre-wrap",
                    fontFamily: "monospace",
                  }}
                >
                  {section.note}
                </pre>
              )}

              {(section.fields || []).map((field) => (
                <FieldRow
                  key={field.key}
                  field={field}
                  value={form[field.key] != null ? form[field.key] : ""}
                  revealed={!!reveal[field.key]}
                  onToggleReveal={() => toggleReveal(field.key)}
                  onChange={(v) => setField(field.key, field.uppercase ? v.toUpperCase() : v)}
                />
              ))}
            </div>
          ))}

          <div style={{ textAlign: "center", color: T.textMuted, fontSize: 12, padding: "8px 0 4px" }}>
            Morari Translate v{(versions && versions.app) || "?"}
            {"  ·  "}
            Worker v{(versions && versions.worker) || "not bundled"}
          </div>
        </div>
      </div>

      {/* Sticky save bar */}
      <div
        style={{
          borderTop: `1px solid ${T.border}`,
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          background: T.surface,
        }}
      >
        {result && <SaveResult result={result} />}
        <div style={{ flex: 1 }} />
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? <Spinner size={16} color="#1a1a1a" /> : null}
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}

function FieldRow({ field, value, revealed, onToggleReveal, onChange }) {
  const isPassword = field.type === "password";
  const inputType = isPassword && !revealed ? "password" : field.type === "number" ? "text" : "text";

  return (
    <div style={{ marginBottom: 16 }}>
      <label style={styles.label}>
        {field.label}
        {field.required && <span style={{ color: T.saffron }}> *</span>}
      </label>

      {field.type === "select" ? (
        <select style={styles.input} value={value} onChange={(e) => onChange(e.target.value)}>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : (
        <div style={{ position: "relative", display: "flex" }}>
          <input
            type={inputType}
            style={{
              ...styles.input,
              paddingRight: isPassword ? 44 : 12,
              fontFamily: isPassword ? "monospace" : "inherit",
            }}
            value={value}
            placeholder={field.placeholder || ""}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => onChange(e.target.value)}
          />
          {isPassword && (
            <button
              type="button"
              title={revealed ? "Hide" : "Show"}
              onClick={onToggleReveal}
              style={{
                position: "absolute",
                right: 6,
                top: 0,
                bottom: 0,
                width: 34,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "none",
                color: T.textMuted,
              }}
            >
              {revealed ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          )}
        </div>
      )}

      {field.help && <div style={styles.help}>{field.help}</div>}
    </div>
  );
}

function SaveResult({ result }) {
  if (!result.ok) {
    return (
      <Pill color={T.red}>
        <WarnIcon /> {result.error || "Save failed"}
      </Pill>
    );
  }
  const config = result.config || { ok: true };
  if (config.ok) {
    return <Pill color={T.green}>✓ CONFIG OK — settings saved</Pill>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Pill color={T.red}>
        <WarnIcon /> {config.fatal}
      </Pill>
      {config.errors && config.errors.length > 1 && (
        <span style={{ fontSize: 11, color: T.textMuted }}>
          {config.errors.length} issues to fix
        </span>
      )}
    </div>
  );
}

function Pill({ color, children }) {
  return (
    <span
      className="mt-fadein"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        color,
        background: `${color}18`,
        border: `1px solid ${color}66`,
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}
