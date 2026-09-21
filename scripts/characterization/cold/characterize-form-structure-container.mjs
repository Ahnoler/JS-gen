/**
 * Type B form-structure container resolution (replay save_form_snapshot).
 *
 * Regression: Element UI renders `aria-label="dialog"` on every `.el-dialog`
 * (`:aria-label="title || 'dialog'"`), while the recorder derives the
 * `unnamed` sentinel from an EMPTY `.el-dialog__title`. The verifier used to
 * require an empty aria-label for `unnamed`, so `dialog:<trigger>|unnamed`
 * never resolved → `container_not_found` → the whole replay step was reported
 * failed even though the page executed it.
 *
 *   node scripts/characterization/cold/characterize-form-structure-container.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/');

/** Pull a triple-quoted Python constant out of a js_snippets source file. */
function pyConst(src, name) {
  const re = new RegExp(name + "\\s*=\\s*'''([\\s\\S]*?)'''\\r?\\n");
  const m = src.match(re);
  if (!m) throw new Error(`cannot extract ${name}`);
  // Python source escapes regex backslashes as `\\`; the runtime string has `\`.
  return m[1].replace(/\\\\/g, '\\');
}

const containerSrc = readFileSync(`${ROOT}scripts/controller/actions/js_snippets/container.py`, 'utf8');
const miscSrc = readFileSync(`${ROOT}scripts/controller/actions/js_snippets/misc.py`, 'utf8');
const GET_CONTAINER = pyConst(containerSrc, 'JS_GET_CONTAINER');
const VERIFY_JS = pyConst(miscSrc, 'JS_VERIFY_FORM_STRUCTURE')
  .replace(/'''\s*\+\s*JS_GET_CONTAINER\s*\+\s*'''/g, GET_CONTAINER);

const FIELDS = ['客户编号', '客户名称', '对公客户类型', '证件类型', '证件号码', '客户状态'];
const FIELDS_ARG = FIELDS.map((label) => ({ label, is_required: false }));

const STYLE = `
  .el-form-item { display:flex; gap:8px; }
  input { width:120px; }
`;

function formItem(label) {
  return `<div class="el-form-item"><label class="el-form-item__label">${label}</label>`
    + '<div class="el-form-item__content"><input class="el-input__inner" /></div></div>';
}

function dialog({ ariaLabel, titleText }) {
  const title = `<span class="el-dialog__title">${titleText || ''}</span>`;
  return '<div class="el-dialog__wrapper" style="position:fixed;top:0;left:0;right:0;bottom:0;overflow:auto;">'
    + `<div class="el-dialog" role="dialog" aria-modal="true" aria-label="${ariaLabel}">`
    + `<div class="el-dialog__header">${title}</div>`
    + `<div class="el-dialog__body">${FIELDS.map(formItem).join('')}</div>`
    + '</div></div>';
}

function drawer({ ariaLabel }) {
  return '<div class="el-drawer__wrapper" style="position:fixed;top:0;left:0;right:0;bottom:0;overflow:auto;">'
    + `<div class="el-drawer" aria-label="${ariaLabel}">`
    + `<div class="el-drawer__body">${FIELDS.map(formItem).join('')}</div>`
    + '</div></div>';
}

// Custom title slot: Element UI renders no .el-dialog__title node, so the
// recorder (JS_IDENTIFY_CONTAINER, title-text only) still records "unnamed".
function dialogCustomTitle({ ariaLabel, slotText }) {
  return '<div class="el-dialog__wrapper" style="position:fixed;top:0;left:0;right:0;bottom:0;overflow:auto;">'
    + `<div class="el-dialog" role="dialog" aria-modal="true" aria-label="${ariaLabel}">`
    + `<div class="el-dialog__header"><div class="my-title">${slotText}</div></div>`
    + `<div class="el-dialog__body">${FIELDS.map(formItem).join('')}</div>`
    + '</div></div>';
}

function page(body) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${STYLE}</style></head>`
    + `<body>${body}</body></html>`;
}

async function verify(p, container) {
  const arg = JSON.stringify({ fields: FIELDS_ARG, container });
  const raw = await p.evaluate(`(${VERIFY_JS})(${arg})`);
  return { raw, report: JSON.parse(raw) };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const p = await browser.newPage();

  // 1. Reported bug: untitled Element UI dialog (aria-label="dialog", empty title)
  //    recorded as `dialog:选择客户|unnamed` must resolve on replay.
  await p.setContent(page(dialog({ ariaLabel: 'dialog', titleText: '' })));
  const untitled = await verify(p, 'dialog:选择客户|unnamed');
  assert.notEqual(
    untitled.report.error, 'container_not_found',
    'unnamed sentinel must resolve an untitled Element UI dialog (aria-label="dialog")',
  );
  assert.equal(untitled.report.ok, true, 'no structural drift for matching fields');
  assert.equal(untitled.report.count, 6, 'all 6 dialog fields scanned');
  assert.equal(untitled.report.expected_count, 6);
  console.log('ok: untitled dialog resolves via |unnamed (aria-label="dialog")');

  // 2. Titled dialog still resolves by its title (regression).
  await p.setContent(page(dialog({ ariaLabel: '新增客户校验', titleText: '新增客户校验' })));
  const titled = await verify(p, 'dialog:新增|新增客户校验');
  assert.equal(titled.report.ok, true, 'titled dialog resolves by title');
  assert.equal(titled.report.count, 6);
  console.log('ok: titled dialog resolves by title');

  // 3. `unnamed` must NOT hijack a dialog that has a real title.
  const unnamedVsTitled = await verify(p, 'dialog:新增|unnamed');
  assert.equal(
    unnamedVsTitled.report.error, 'container_not_found',
    'unnamed must not match a titled dialog',
  );
  console.log('ok: unnamed does not match a titled dialog');

  // 4. Legacy title-only id only matches a real title, not an untitled dialog.
  await p.setContent(page(dialog({ ariaLabel: 'dialog', titleText: '' })));
  const legacy = await verify(p, 'dialog:选择客户');
  assert.equal(legacy.report.error, 'container_not_found', 'legacy title id needs a real title');
  console.log('ok: legacy title-only id does not match untitled dialog');

  // 5. Missing overlay still fails safely (never falls back to page scope).
  await p.setContent(page(formItem('页面字段')));
  const missing = await verify(p, 'dialog:选择客户|unnamed');
  assert.equal(missing.report.error, 'container_not_found', 'absent overlay → container_not_found');
  console.log('ok: absent overlay → container_not_found');

  // 6. Drawer unnamed sentinel still resolves (no regression).
  await p.setContent(page(drawer({ ariaLabel: '' })));
  const dr = await verify(p, 'drawer:筛选|unnamed');
  assert.equal(dr.report.ok, true, 'untitled drawer resolves via |unnamed');
  assert.equal(dr.report.count, 6);
  console.log('ok: untitled drawer resolves via |unnamed');

  // 7. main scope still resolves and excludes overlays.
  await p.setContent(page(formItem('页面字段') + dialog({ ariaLabel: 'dialog', titleText: '' })));
  const mainScope = await verify(p, 'main');
  assert.equal(mainScope.report.ok, true, 'main scope resolves');
  assert.deepEqual(mainScope.report.fields, ['页面字段'], 'main scan excludes overlay items');
  console.log('ok: main scope excludes overlays');

  // 8. Custom title slot (no .el-dialog__title) is recorded "unnamed" too; the
  //    verifier must stay aligned with the recorder and resolve it.
  await p.setContent(page(dialogCustomTitle({ ariaLabel: '选择对公授信客户', slotText: '选择对公授信客户' })));
  const custom = await verify(p, 'dialog:选择客户|unnamed');
  assert.equal(custom.report.ok, true, 'custom-title-slot dialog resolves via |unnamed');
  assert.equal(custom.report.count, 6);
  console.log('ok: custom title slot dialog resolves via |unnamed');

  // 9. Selection-only table rows (single radio per row) must NOT be treated as
  //    form fields — their row text (business numbers) must not appear in the
  //    field list or trigger a false "added_optional" form-structure change.
  const tableWithRadioRows = `
    <div class="el-form-item"><label class="el-form-item__label">业务编号</label>`
    + `<div class="el-form-item__content"><input class="el-input__inner" /></div></div>`
    + `<div class="el-form-item"><label class="el-form-item__label">客户名称</label>`
    + `<div class="el-form-item__content"><input class="el-input__inner" /></div></div>`
    + `<div class="el-table"><div class="el-table__body-wrapper"><table><tbody>`
    + `<tr><td>PJ20260910016010</td><td><label class="el-radio"><span class="el-radio__input"><input type="radio" name="row" /></span></label></td></tr>`
    + `<tr><td>PJ20260907016009</td><td><label class="el-radio"><span class="el-radio__input"><input type="radio" name="row" /></span></label></td></tr>`
    + `</tbody></table></div></div>`;
  await p.setContent(page(tableWithRadioRows));
  const radioRowsArg = JSON.stringify({
    fields: [
      { label: '业务编号', is_required: false },
      { label: '客户名称', is_required: false },
    ],
    container: 'main',
  });
  const rawRadioRows = await p.evaluate(`(${VERIFY_JS})(${radioRowsArg})`);
  const radioRows = { raw: rawRadioRows, report: JSON.parse(rawRadioRows) };
  assert.equal(radioRows.report.ok, true, 'selection-only table rows do not cause structural drift');
  assert.equal(radioRows.report.count, 2, 'only real form fields are counted');
  assert.deepEqual(radioRows.report.fields, ['业务编号', '客户名称'], 'table row texts are not treated as field labels');
  assert.equal(radioRows.report.added_optional.length, 0, 'no added_optional from table rows');
  console.log('ok: selection-only table rows excluded from form structure scan');

  await browser.close();
  console.log('characterize-form-structure-container: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
