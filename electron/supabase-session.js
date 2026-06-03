'use strict';

/**
 * supabase-session.js
 * --------------------------------------------------------------------------
 * Auto-create (upsert) the session row in Supabase before the worker spawns,
 * so a first-time session code never makes the worker crash with
 * "Session not found". No manual SQL / setup script required.
 *
 * Uses the Supabase REST (PostgREST) API with the service-role key, so it has
 * no extra npm dependency (relies on the global fetch in Node 18+/Electron).
 *
 * NOTE on schema: the worker owns the real `sessions` table definition, which
 * this app can't see. We upsert only the session-code column and let the DB
 * fill defaults for everything else. If your table names the code column
 * differently (or requires other NOT NULL columns), set SESSION_TABLE /
 * SESSION_CODE_COLUMN in the worker config — the upsert reads those overrides.
 */

const DEFAULT_TABLE = 'sessions';
const DEFAULT_CODE_COLUMN = 'code';

// Session mode values the worker (src/index.js) routes on. The worker reads
// these from the Supabase session row's `session_mode` column, NOT from the
// MODE env var. Confirmed against the worker's mode dispatch:
//   - SESSION_MODE_MIC ('live_input')        -> runInputSession (mic / audio).
//   - SESSION_MODE_WATCHBACK ('recorded_youtube') -> recorded YouTube playback.
const SESSION_MODE_MIC = 'live_input';
const SESSION_MODE_WATCHBACK = 'recorded_youtube';

// The worker's session-mode column is `session_mode` (not `mode`).
const MODE_COLUMN = 'session_mode';

/**
 * Upsert a row keyed by the session code. Idempotent: an existing row is merged
 * (merge-duplicates), so re-using a code is never an error.
 *
 * @param {object} opts
 * @param {string} opts.url          SUPABASE_URL
 * @param {string} opts.serviceKey   SUPABASE_SERVICE_ROLE_KEY
 * @param {string} opts.sessionCode  the configured session code (e.g. GSJZ76)
 * @param {string} [opts.mode]       session mode column (e.g. live_mic / live_youtube)
 * @param {string} [opts.status]     session status column (e.g. "live")
 * @param {string} [opts.table]      override table name (default "sessions")
 * @param {string} [opts.codeColumn] override code column (default "code")
 * @returns {Promise<{ok:boolean, error?:string, status?:number}>}
 */
async function ensureSession({ url, serviceKey, sessionCode, mode, status, table, codeColumn } = {}) {
  if (!url || !serviceKey) {
    return { ok: false, error: 'Supabase URL or service-role key not configured.' };
  }
  if (!sessionCode) {
    return { ok: false, error: 'No session code to create.' };
  }
  if (typeof fetch !== 'function') {
    return { ok: false, error: 'fetch is unavailable in this runtime (needs Node 18+).' };
  }

  const tbl = table || DEFAULT_TABLE;
  const col = codeColumn || DEFAULT_CODE_COLUMN;
  const base = String(url).replace(/\/+$/, '');
  const endpoint = `${base}/rest/v1/${encodeURIComponent(tbl)}?on_conflict=${encodeURIComponent(col)}`;

  // Only set the code by default; add mode/status when provided so the worker
  // starts capturing immediately (status=live) in the right mode instead of
  // sitting in "waiting for live".
  const row = { [col]: sessionCode };
  if (mode) row[MODE_COLUMN] = mode;
  if (status) row.status = status;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        // merge-duplicates => upsert; return=minimal => no body echoed back.
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([row]),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: `Supabase ${res.status}: ${detail || res.statusText}` };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = {
  ensureSession,
  DEFAULT_TABLE,
  DEFAULT_CODE_COLUMN,
  MODE_COLUMN,
  SESSION_MODE_MIC,
  SESSION_MODE_WATCHBACK,
};
