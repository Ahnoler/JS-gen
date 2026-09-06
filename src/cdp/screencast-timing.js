/**
 * Shared BiB / remote-bridge screencast forward timing + stream quality config.
 * Spec: docs/superpowers/specs/2026-08-11-bib-stream-fps-cap-design.md
 * 2026-09-05: default raised to 30fps; ack-pacing stream config added
 * (research: docs/superpowers/research/2026-09-05-screencast-optimization.md).
 *
 * Resolution/quality are only defaulted here; per-call viewport caps still clamp.
 */
export const TARGET_FPS = 30;
export const DEFAULT_MIN_FORWARD_MS = 33; // 1000 / 30fps
export const DEFAULT_EVERY_NTH_FRAME = 1;

export const DEFAULT_STREAM_QUALITY = 65; // CDP jpeg quality [40..95]
export const DEFAULT_STREAM_MAX_W = 1920;
export const DEFAULT_STREAM_MAX_H = 1080;

const MIN_FORWARD_CLAMP = [25, 500];
const EVERY_NTH_CLAMP = [1, 5];
const QUALITY_CLAMP = [40, 95];
const MAX_W_CLAMP = [320, 4096];
const MAX_H_CLAMP = [240, 4096];

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

/**
 * Resolve full stream config: forward cadence + JPEG quality + encode resolution caps.
 * Quality/resolution are env-tunable (BIB_STREAM_QUALITY / BIB_STREAM_MAX_W / BIB_STREAM_MAX_H).
 * @param {Record<string, string|undefined>} [env] Environment map (defaults to process.env).
 * @returns {{ minForwardMs: number, everyNthFrame: number, quality: number, maxW: number, maxH: number }} Clamped stream config.
 */
export function resolveScreencastStreamConfig(env = process.env) {
  const timing = resolveScreencastTiming(env);
  return {
    ...timing,
    quality: clamp(parseIntEnv(env.BIB_STREAM_QUALITY, DEFAULT_STREAM_QUALITY), QUALITY_CLAMP[0], QUALITY_CLAMP[1]),
    maxW: clamp(parseIntEnv(env.BIB_STREAM_MAX_W, DEFAULT_STREAM_MAX_W), MAX_W_CLAMP[0], MAX_W_CLAMP[1]),
    maxH: clamp(parseIntEnv(env.BIB_STREAM_MAX_H, DEFAULT_STREAM_MAX_H), MAX_H_CLAMP[0], MAX_H_CLAMP[1]),
  };
}

/**
 * Create an ack pacer that throttles Page.screencastFrameAck to the forward cadence.
 *
 * Chrome skips capture AND encode while maxFramesInFlight (3) is full; by delaying acks
 * to one per minForwardMs, the producer-side frame rate is pinned to TARGET_FPS regardless
 * of display refresh rate — skipped frames cost zero CPU on the machine running Chrome.
 * @param {{ minForwardMs: number, ack: (sessionId: number) => void }} opts Forward cadence + ack sender.
 * @returns {{ schedule: (sessionId: number) => void, cancel: () => void }} Pacer: schedule() per incoming frame, cancel() on stop.
 */
export function createAckPacer({ minForwardMs, ack }) {
  let lastAckAt = 0; // 0 = never acked yet
  let timer = null;
  let pendingId = null;
  return {
    schedule(sessionId) {
      if (sessionId == null) return;
      pendingId = sessionId;
      if (timer != null) return;
      // First ack in a burst goes out immediately (keeps first-frame latency low);
      // subsequent acks are paced to the forward cadence.
      const wait = lastAckAt === 0 ? 0 : Math.max(0, lastAckAt + minForwardMs - Date.now());
      timer = setTimeout(() => {
        timer = null;
        if (pendingId == null) return;
        const id = pendingId;
        pendingId = null;
        lastAckAt = Date.now();
        ack(id);
      }, wait);
    },
    cancel() {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      pendingId = null;
    },
  };
}
