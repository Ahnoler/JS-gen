/**
 * CTRL method body (object literal parts). Edit parts here first; sync Python cues.
 * Parts concatenate byte-identically into CTRL_OBJECT — characterize-ctrl.mjs
 * verifies method-name parity; byte-identity is verified by the refactor gate.
 */
import { CTRL_PART_FORM } from './form.js';
import { CTRL_PART_SELECT } from './select.js';
import { CTRL_PART_NAV } from './nav.js';
import { CTRL_PART_TABLE } from './table.js';
import { CTRL_PART_STRUCTURE } from './structure.js';

/** window.CTRL object literal — single source of truth (assembled from parts). */
export const CTRL_OBJECT =
  CTRL_PART_FORM +
  CTRL_PART_SELECT +
  CTRL_PART_NAV +
  CTRL_PART_TABLE +
  CTRL_PART_STRUCTURE;

/**
 * 模板生成用：以 page.evaluate 注入格式输出（含缩进）
 * 用于 convertTrajectoryToScript 的模板
 */
export function getInjectionCode(indent = 2) {
  const sp = ' '.repeat(indent);
  return `${sp}// Inject Element UI helpers into browser context (from controller.py)
${sp}await page.evaluate(() => {
${sp}  window.CTRL = ${CTRL_OBJECT.replace(/\n/g, '\n' + sp + '  ')};
${sp}});`;
}

/**
 * LLM prompt 用：以 Markdown 代码块格式输出（可复制）
 * 用于 Agent prompt 中让 LLM 直接复制 CTRL 函数定义
 */
export const CTRL_PROMPT_BLOCK = '```javascript\nawait page.evaluate(() => {\n  window.CTRL = ' + CTRL_OBJECT.replace(/\n/g, '\n  ') + '\n});\n```';

/**
 * CTRL API 签名表（LLM prompt 用）
 */
export const CTRL_API_TABLE = `| 函数 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| CTRL.fillFormField | (label, value) | 'ok' / 'ok-date' / 'ok-placeholder' / 'ok-fuzzy' / 'field-disabled' / 'label-not-found' | 填充 el-input/textarea；成功均以 ok 开头；Vue/.is-disabled 只读字段返回 field-disabled |
| CTRL.selectOption | (label, option) | 'ok-triggered' / 'ok-triggered-placeholder' / 'select-disabled' / 'label-not-found' | 下拉选择 el-select，option='first' 选第一项 |
| CTRL.selectDate | (label, dateStr) | 'ok-date:xxx' / 'ok-already:xxx' / 'label-not-found' | 设置 el-date-editor，格式 YYYY-MM-DD |
| CTRL.clickRadio | (label, option) | 'ok' / 'disabled' / 'option-not-found' / 'label-not-found' | 点击 el-radio |
| CTRL.selectTreeOption | (label, option) | 'ok:xxx (code)' / 'ok-search:xxx' / 'ok-fallback:xxx (code)' / 'disabled' / 'no-tree-component' | 树选择器；只读 TsscMultiTree 返回 disabled |
| CTRL.isFormItemDisabled | (item, inputEl?, trigger?) | true/false | 可编辑判定：原生 disabled + .is-disabled 包装 + Vue props.disabled || CTRL.clickMenuItem | (text) | 'ok' / 'ok-expanded' / 'not-found' | 点击 el-menu-item，自动展开 el-submenu |
| CTRL.clickTableRowButton | (rowText, btnText) | 'ok' / 'ok-icon' / 'button-not-found-in-row:{rowButtons,rowHasRadio}' / 'row-not-found' | 点击 el-table 行内操作按钮；行内无按钮时返回行内实际按钮与 radio 提示（工具栏模式：radio 选中 + 点工具栏按钮），不再盲点首个按钮 |
| CTRL.clickTableRowRadio | (rowText) | 'ok' / 'radio-not-found' / 'row-not-found' | 选中 el-table 行内单选按钮 |
| CTRL.closeDialog | () | 'ok' / 'ok-notification' / 'ok-cancel' / 'no-overlay-open' | 关闭通知/弹窗/抽屉 |
| CTRL.waitForLoading | () | 超时返回 'timeout' | 等待 loading 遮罩 + CSS 动画结束（200ms 轮询，最长 30s） |
| CTRL.switchTab | (name) | 'ok' / 'tab-not-found' | 切换 el-tabs |
| CTRL.checkFieldValue | (label) | 值 / 'empty' / 'label-not-found' | 读取表单字段当前值 |
| CTRL.clickAdjacentButton | (label) | 'ok-clicked' / 'already-filled'(非ok跳过) / 'no-button-found' | 点击字段旁的选择/引入按钮 |
| CTRL.clickIconButton | (buttonText) | 'ok' / 'ok-text:<label>' / 'not-found-text-button:{ambiguous}' / 'not-found' / 'button-text-empty' | 按标签点按钮：先匹配 tooltip 图标，miss 时直接点击同标签可见文字按钮（表格行内除外；页面级优先于弹层；歧义时返回候选清单） |
| CTRL.fillAddressFields | (addr) | 'ok:N' / 'no-address-fields' | 填充所有标签含"地址"的字段 |
| CTRL.expandAllTreeNodes | () | 展开节点数 | 展开全部 el-tree 节点 |

成功可录制约定：result.startsWith('ok')。跳过码（如 already-filled）不以 ok 开头。`;
