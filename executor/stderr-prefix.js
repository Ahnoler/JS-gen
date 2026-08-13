/**
 * Per-slot stderr line prefix + flush buffer for executor SessionSlot.
 */

export function shortSid(sessionId) {
  return String(sessionId || '')
    .replace(/-/g, '')
    .slice(0, 8)
    .toLowerCase();
}

export function prefixLine(slotIndex, sessionId, line) {
  const sid = shortSid(sessionId);
  return `[slot:${Number(slotIndex)} sid:${sid}] ${line}`;
}

/**
 * @param {{
 *   slotIndex: number,
 *   sessionId: string,
 *   onFlush: (lines: string[]) => void,
 *   flushMs?: number,
 *   maxLines?: number,
 *   now?: () => number,
 * }} opts
 */
export function createStderrLineBuffer(opts) {
  const flushMs = opts.flushMs ?? 200;
  const maxLines = opts.maxLines ?? 50;
  const now = opts.now || (() => Date.now());
  let pending = '';
  /** @type {string[]} */
  let queue = [];
  let timer = null;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function flushQueue() {
    clearTimer();
    if (!queue.length) {
      return;
    }
    const batch = queue;
    queue = [];
    try {
      opts.onFlush(batch);
    } catch {}
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flushQueue();
    }, flushMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function enqueue(prefixed) {
    queue.push(prefixed);
    if (queue.length >= maxLines) flushQueue();
    else schedule();
  }

  return {
    push(chunk) {
      pending += chunk.toString();
      const parts = pending.split('\n');
      pending = parts.pop() || '';
      for (const raw of parts) {
        enqueue(prefixLine(opts.slotIndex, opts.sessionId, raw));
      }
    },
    flush(flushOpts) {
      if (flushOpts?.end && pending) {
        enqueue(prefixLine(opts.slotIndex, opts.sessionId, pending));
        pending = '';
      }
      flushQueue();
    },
    dispose() {
      clearTimer();
      queue = [];
      pending = '';
    },
  };
}
