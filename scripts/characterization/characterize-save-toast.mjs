/**
 * Characterization: click_save toast classification (fail-first, else success).
 *
 * Parses successRe / failRe from scripts/actions/_js_snippets.py (JS_SCAN_SAVE_OUTCOME)
 * so regex drift fails loudly instead of a stale copy in this file.
 *
 * Run:
 *   node scripts/characterization/characterize-save-toast.mjs
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const SNIPPETS = join(ROOT, 'scripts', 'actions', '_js_snippets.py');

const source = readFileSync(SNIPPETS, 'utf8');

function extractRegex(name) {
  const re = new RegExp(`const ${name} = (\\/.*?\\/);`);
  const m = source.match(re);
  assert(m, `could not find const ${name} in ${SNIPPETS}`);
  return new RegExp(m[1].slice(1, -1));
}

const successRe = extractRegex('successRe');
const failRe = extractRegex('failRe');

const ERROR_CLASS_RE = /el-notification--error|el-message--error|el-message--warning/;

/** Mirrors post-fix JS_SCAN_SAVE_OUTCOME collect() classification. */
function classifyToast(text, className = '') {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'skip';
  if (failRe.test(t) || ERROR_CLASS_RE.test(className || '')) return 'error';
  return 'success';
}

const cases = [
  {
    label: 'trajectory-35 toast (no 成功 keyword)',
    text: '已提交创建！保存的客户，客户状态为【信贷正式客户】',
    expect: 'success',
  },
  {
    label: 'validation: empty name',
    text: '客户名称不能为空',
    expect: 'error',
  },
  {
    label: 'validation: id format',
    text: '证件号码格式校验不通过',
    expect: 'error',
  },
  {
    label: 'legacy whitelist: 操作成功',
    text: '操作成功',
    expect: 'success',
  },
  {
    label: 'legacy whitelist: 保存成功',
    text: '保存成功',
    expect: 'success',
  },
  {
    label: 'error CSS class without fail keyword',
    text: '请检查输入',
    className: 'el-message el-message--error',
    expect: 'error',
  },
];

for (const c of cases) {
  const got = classifyToast(c.text, c.className || '');
  assert(
    got === c.expect,
    `${c.label}: expected ${c.expect}, got ${got} for "${c.text}"`,
  );
}

// successRe / failRe are still present in source (not deleted during refactor)
assert(successRe.test('操作成功'), 'parsed successRe should match 操作成功');
assert(failRe.test('保存失败'), 'parsed failRe should match 保存失败');

console.log('characterize-save-toast: OK');
process.exit(0);
