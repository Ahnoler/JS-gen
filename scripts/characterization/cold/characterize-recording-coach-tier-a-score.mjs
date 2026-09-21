import assert from 'node:assert/strict';
import { scoreTierACase, positiveForbidHit } from '../../../tools/recording-coach/scripts/eval-tier-a.mjs';

// Negation-safe forbid: denials must not false-fail
assert.equal(positiveForbidHit('不允许 curl 进 taskText', '允许 curl'), false);
assert.equal(positiveForbidHit('禁止用 DONE 作结论前缀', '用 DONE'), false);
assert.equal(positiveForbidHit('不可以写入 curl', '可以写入'), false);
assert.equal(positiveForbidHit('允许 curl 进 taskText', '允许 curl'), true);
assert.equal(positiveForbidHit('请用 DONE 收尾', '用 DONE'), true);

const a2Deny = scoreTierACase('否，禁止把 curl 或 POST /api/v2 写进 taskText（不允许 curl）。', {
  expectAny: ['禁止', '不能', '不允许', '否'],
  forbidAny: ['允许 curl', '可以 curl', '可以写入'],
});
assert.equal(a2Deny.ok, true, a2Deny.reasons.join('; '));

const a2Allow = scoreTierACase('可以，允许 curl 写进 taskText。', {
  expectAny: ['禁止', '不能', '不允许', '否'],
  forbidAny: ['允许 curl', '可以 curl'],
});
assert.equal(a2Allow.ok, false);

const a5Deny = scoreTierACase('假成功用 BLOCKED_；禁止用 DONE 作结论前缀。', {
  expectAny: ['BLOCKED_', '假成功'],
  forbidAny: ['结论：DONE', '用 DONE', '报 DONE'],
});
assert.equal(a5Deny.ok, true, a5Deny.reasons.join('; '));

const a5Bad = scoreTierACase('可以用 DONE 报成功。', {
  expectAny: ['BLOCKED_', '假成功'],
  forbidAny: ['用 DONE', '报 DONE'],
});
assert.equal(a5Bad.ok, false);

console.log('OK characterize-recording-coach-tier-a-score');
