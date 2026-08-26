/**
 * Shared BiB / remote-bridge screencast forward timing.
 * Spec: docs/superpowers/specs/2026-08-11-bib-stream-fps-cap-design.md
 *
 * Resolution/quality are NOT controlled here — only forward cadence + CDP everyNthFrame.
 */
export const TARGET_FPS = 11;
export const DEFAULT_MIN_FORWARD_MS = 90;
export const DEFAULT_EVERY_NTH_FRAME = 2;

const MIN_FORWARD_CLAMP = [50, 500];
const EVERY_NTH_CLAMP = [1, 5];

function parseIntEnv(raw, fallback) {
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Resolve screencast forward cadence + CDP everyNthFrame from env overrides.
 * @param {Record<string, string|undefined>} [env] Environment map (defaults to process.env).
 * @returns {{ minForwardMs: number, everyNthFrame: number }} Clamped timing config.
 */
export function resolveScreencastTiming(env = process.env) {
  const minForwardMs = clamp(
    parseIntEnv(env.BIB_STREAM_MIN_FORWARD_MS, DEFAULT_MIN_FORWARD_MS),
    MIN_FORWARD_CLAMP[0],
    MIN_FORWARD_CLAMP[1],
  );
  const everyNthFrame = clamp(
    parseIntEnv(env.BIB_STREAM_EVERY_NTH_FRAME, DEFAULT_EVERY_NTH_FRAME),
    EVERY_NTH_CLAMP[0],
    EVERY_NTH_CLAMP[1],
  );
  return { minForwardMs, everyNthFrame };
}
