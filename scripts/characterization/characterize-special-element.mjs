/**
 * Characterization: special-element search scoring + hint helpers (no DB).
 * Run: node scripts/characterization/characterize-special-element.mjs
 */
import assert from 'assert';

// Pure scoring helpers mirrored from search service behavior
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[\s,，、;；|/\\]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 1);
}

function normalizeLegalAliases(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/法定责任人/g, '法定代表人')
    .replace(/责任人的引入/g, '代表人的引入');
}

const INTRODUCE_HINT_RE = /引入|选人|放大镜|法定代表人|法定责任人/;

function scoreCandidate(el, tag, queryText) {
  const dictLabel = tag?.dictLabel || '';
  const dictValue = tag?.dictValue || '';
  const hay = normalizeLegalAliases([
    el.name || '',
    dictLabel,
    dictValue,
    el.phaseDescription || '',
    el.remark || '',
  ].join(' '));
  const q = normalizeLegalAliases(queryText);
  let tagScore = 0;
  let lexicalScore = 0;
  if (normalizeLegalAliases(dictLabel) && q.includes(normalizeLegalAliases(dictLabel))) {
    tagScore += 40;
  } else if (
    normalizeLegalAliases(dictLabel).includes('引入')
    && q.includes('引入')
    && (q.includes('代表人') || hay.includes('代表人'))
  ) {
    tagScore += 25;
  }
  if (dictValue && q.includes(String(dictValue).toLowerCase())) tagScore += 30;
  if (el.name && q.includes(normalizeLegalAliases(el.name))) lexicalScore += 35;
  if (INTRODUCE_HINT_RE.test(q) && INTRODUCE_HINT_RE.test(hay)) lexicalScore += 20;
  const tokens = tokenize(q);
  let covered = 0;
  for (const tok of tokens) {
    if (tok.length >= 2 && hay.includes(tok)) covered += 1;
  }
  if (tokens.length) lexicalScore += Math.round((covered / tokens.length) * 30);
  return tagScore + lexicalScore;
}

const login = {
  name: '复杂登录',
  phaseDescription: '填写用户名密码并登录系统',
  remark: '',
};
const fill = {
  name: '复杂填表',
  phaseDescription: '填写客户信息表单',
  remark: '',
};
const tagLogin = { dictLabel: '登录', dictValue: 'login' };
const tagFill = { dictLabel: '填写', dictValue: 'fill' };

const s1 = scoreCandidate(login, tagLogin, '需要登录系统');
const s2 = scoreCandidate(fill, tagFill, '需要登录系统');
assert.ok(s1 > s2, `login should rank above fill for login query (${s1} vs ${s2})`);

const s3 = scoreCandidate(fill, tagFill, '填写客户信息');
assert.ok(s3 > 0, 'fill query should score > 0');

const introEl = {
  name: '对公客户引入流程',
  phaseDescription: '点击法定代表人引入按钮选择客户',
  remark: '',
};
const tagIntro = { dictLabel: '法定责任人的引入流程', dictValue: 'Introduction' };
const sIntro = scoreCandidate(
  introEl,
  tagIntro,
  '点击法定代表人/负责人证件号码的引入按钮，客户名称填写测试',
);
assert.ok(sIntro >= 40, `introduce synonym+hint should score high (${sIntro})`);

// Hint formatting (inline equivalent of Python format_special_element_hint)
function formatHint(store) {
  if (!store || !Object.keys(store).length) return '';
  const lines = Object.entries(store).map(([cid, c]) => `- id=${cid} name=${c.name}`);
  return '【特殊元素库候选】\n' + lines.join('\n');
}
const hint = formatHint({ '9': { name: '复杂登录' } });
assert.ok(hint.includes('id=9'), 'hint includes id');
assert.ok(hint.includes('复杂登录'), 'hint includes name');
assert.strictEqual(formatHint({}), '', 'empty store → empty hint');

console.log('characterize-special-element: OK');
