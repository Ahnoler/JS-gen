/**
 * Smoke: import replay modules (no live server / Playwright required).
 */
import { prepareReplay, getLatestReplay } from '../src/services/replay-service.js';
import { assembleActionToScript } from '../src/services/assemble-service.js';
import { isScriptExecuting, abortActiveScriptRun } from '../src/runtime/script-runner.js';

console.log('replay-service exports:', typeof prepareReplay, typeof getLatestReplay);
console.log('assemble-service:', typeof assembleActionToScript);
console.log('script-runner idle:', !isScriptExecuting(), 'abort:', typeof abortActiveScriptRun);
console.log('ok: accept-replay-apis import smoke');
