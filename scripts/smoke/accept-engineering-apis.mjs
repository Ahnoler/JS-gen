/**
 * Smoke: import engineering assets that remain supported.
 * /api/test/assemble and /api/test/run keep working after the replay stack is removed.
 */
import { assembleActionToScript } from '../../src/services/assemble-service.js';
import {
  isScriptExecuting,
  abortActiveScriptRun,
  executeScript,
} from '../../src/runtime/script-runner.js';
import { CTRL_OBJECT, CTRL_PROMPT_BLOCK, getInjectionCode } from '../../src/ctrl-actions/index.js';

if (typeof assembleActionToScript !== 'function') throw new Error('assembleActionToScript missing');
if (typeof isScriptExecuting !== 'function') throw new Error('isScriptExecuting missing');
if (typeof abortActiveScriptRun !== 'function') throw new Error('abortActiveScriptRun missing');
if (typeof executeScript !== 'function') throw new Error('executeScript missing');
if (typeof CTRL_OBJECT !== 'string' || !CTRL_OBJECT.includes('fillFormField')) throw new Error('CTRL_OBJECT missing');
if (typeof getInjectionCode !== 'function') throw new Error('getInjectionCode missing');
if (typeof CTRL_PROMPT_BLOCK !== 'string' || !CTRL_PROMPT_BLOCK.includes('window.CTRL')) throw new Error('CTRL_PROMPT_BLOCK missing');

console.log('assemble-service:', typeof assembleActionToScript);
console.log('script-runner idle:', !isScriptExecuting(), 'abort:', typeof abortActiveScriptRun);
console.log('ctrl-actions:', typeof CTRL_OBJECT, typeof getInjectionCode, typeof CTRL_PROMPT_BLOCK);
console.log('ok: accept-engineering-apis import smoke');
