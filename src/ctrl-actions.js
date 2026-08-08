/**
 * ctrl-actions.js — Canonical source for window.CTRL (replay / assemble).
 *
 * Legacy: For product replay prefer live `_replay.py`. CTRL remains the
 * engineering injection surface for assemble/test-run and the deprecated
 * `/api/v2/trajectories/:id/replay/*` path. Keep name-level parity with
 * Python cues via `node scripts/characterization/characterize-ctrl.mjs`.
 *
 * `CTRL_OBJECT` + `getInjectionCode()` are the single source of truth for the
 * CTRL.* surface injected into Playwright scripts. Agent-side duplicates live
 * in scripts/actions/_js_snippets.py and inline evaluate in actions/*.py —
 * keep name-level parity via `node scripts/characterization/characterize-ctrl.mjs` (not
 * byte-identical; agent has extra JS beyond CTRL).
 *
 * Consumers:
 *   1. assemble / script_assembler — getInjectionCode() → window.CTRL
 *   2. LLM prompt blocks — CTRL_PROMPT_BLOCK / CTRL_API_TABLE
 *
 * Implementation moved to ./ctrl-actions/index.js (CTRL_OBJECT assembled from
 * method-group parts in ./ctrl-actions/*.js). This file stays as the canonical
 * entry path so existing imports keep working.
 */
export * from './ctrl-actions/index.js';
