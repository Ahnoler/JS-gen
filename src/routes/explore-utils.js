/**
 * @deprecated Prefer `src/runtime/agent-process.js`, `sse-channel.js`, `resolve-model.js`.
 * Thin re-export kept for transitional imports.
 */
export {
  PYTHON_EXE,
  AGENT_SCRIPT,
  killTree,
  killOrphans,
  flushPendingBuffer,
  waitForReady,
  isProcessAlive,
  spawnAgent,
} from '../runtime/agent-process.js';

export {
  setupSSE,
  createPushChannel,
} from '../runtime/sse-channel.js';

export { resolveModelId } from '../runtime/resolve-model.js';
