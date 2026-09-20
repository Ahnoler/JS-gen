/**
 * Characterization: DOM 枚举遮挡误杀修复（#910④）—— buildDomTree.js isTopElement
 * 的 Element-UI 浮层豁免 + vendor 单源覆写接线。
 *
 * 生产事故：el-dialog footer「确 定」被「请选择」触发的 el-select tree-popover
 * 展开遮挡；browser_use 0.1.48 buildDomTree.js 的 isTopElement（:856-933）用
 * elementFromPoint 命中测试，:927 取 topEl 后向上走祖先链不含候选元素 →
 * :933 return false → 不分配 index → agent 元素表没有确定钮。
 *
 * 修复形态（三层钉死）：
 *   V  scripts/vendor/browser_use/buildDomTree.js   上游 0.1.48 副本 + isTopElement
 *      补丁：主文档祖先链 miss 后，topEl 落在 .el-popper（排除 tooltip）内 →
 *      仍算 top（瞬态浮层不取消可交互元素资格；el-dialog/.el-overlay 不属
 *      .el-popper 家族，模态真遮挡行为不变）
 *   P  scripts/agent_utils.py patch_dom_tree_js()    wrap DomService.__init__ 覆写 js_code
 *   W  scripts/session_runner.py + scripts/main.py   patch 接线
 *
 * 层2 不回归钉：semantic_snapshot.js LIMITS.buttons=40（本单元不碰层2）。
 *
 * 全部为 read_text needle + 源码切片断言（零 import 被测模块、零行为驱动）：
 * 上述任一区域被改动，对应断言即红，倒逼改者显式确认语义迁移。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
// RED-safe 读：文件缺失返回空串，让后续 needle 断言逐条 FAIL 而非脚本崩溃
const readOrEmpty = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};

const VENDOR = readOrEmpty(join(ROOT, 'scripts/vendor/browser_use/buildDomTree.js'));
const AGENT = readOrEmpty(join(ROOT, 'scripts/agent_utils.py'));
const RUNNER = readOrEmpty(join(ROOT, 'scripts/session_runner.py'));
const MAIN = readOrEmpty(join(ROOT, 'scripts/main.py'));
const SNAPSHOT = readOrEmpty(join(ROOT, 'scripts/controller/actions/js_snippets/semantic_snapshot.py'));

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
};
// 容错切片：起点未命中返回空串（RED-safe），终点未命中切到文件尾
const sliceFrom = (hay, startNeedle, endNeedle) => {
  const i = hay.indexOf(startNeedle);
  if (i < 0) return '';
  const j = hay.indexOf(endNeedle, i + startNeedle.length);
  return j < 0 ? hay.slice(i) : hay.slice(i, j);
};

// ── 1. vendor 副本：isTopElement 补丁形态 ─────────────────────────────────────
// 切片：从 `function isTopElement` 到下一个 `function `（isInExpandedViewport）
const isTop = sliceFrom(VENDOR, 'function isTopElement', 'function ');
const POPPER_NEEDLE = "closest('.el-popper')";
const walkIdx = isTop.indexOf('while (current && current !== document.documentElement)');
const mainTopIdx = isTop.indexOf('const topEl = document.elementFromPoint');
const exemptIdx = isTop.indexOf(POPPER_NEEDLE);
const lastMissIdx = isTop.lastIndexOf('return false');
record('1a vendor 副本存在且含 isTopElement',
  VENDOR.length > 0 && isTop.length > 0);
record('1b 主文档祖先链 miss 后有 .el-popper 豁免（miss 后、return false 前的索引关系）',
  exemptIdx >= 0
  && mainTopIdx >= 0 && exemptIdx > mainTopIdx
  && walkIdx >= 0 && exemptIdx > walkIdx
  && exemptIdx < lastMissIdx,
  exemptIdx >= 0 ? `exempt@${exemptIdx}, walk@${walkIdx}, lastMiss@${lastMissIdx}` : 'exemption 缺失');
record('1c 豁免排除 tooltip：popper 含 el-tooltip__popper 类时不豁免',
  isTop.includes('el-tooltip__popper') && isTop.indexOf('el-tooltip__popper') > exemptIdx);
record('1d viewportExpansion === -1 早退豁免保持原样（位于 iframe 分支之前）',
  isTop.includes('viewportExpansion === -1')
  && isTop.indexOf('viewportExpansion === -1') < isTop.indexOf('doc !== window.document'));
record('1e iframe 分支保持原样（doc !== window.document → 默认 top）',
  isTop.includes('doc !== window.document'));

// ── 2. vendor 副本：整文件完整性 + 文件头标注 ────────────────────────────────
record('2a 副本含 buildDomTree 主函数（整文件完整性粗检）',
  VENDOR.includes('function buildDomTree('));
record('2b 副本文件头标注 vendored 来源与版本',
  VENDOR.includes('* Vendored from browser_use 0.1.48'));

// ── 3. patch_dom_tree_js：DomService.__init__ wrap + js_code 覆写 + 失败回退 ──
const patchBody = sliceFrom(AGENT, 'def patch_dom_tree_js(', '\ndef ');
record('3a agent_utils 含 patch_dom_tree_js 定义',
  patchBody.length > 0);
record('3b wrap DomService.__init__（原 init 后覆写）',
  patchBody.includes('DomService'));
record('3c vendor 副本读全文覆写 self.js_code',
  patchBody.includes('self.js_code = js'));
record('3d 副本缺失/读取异常回退 stock 并 stderr 告警（不抛错）',
  patchBody.includes('[agent-domtree-patch] vendor buildDomTree.js unavailable, using stock js'));

// ── 4. 接线：session_runner 与 main 均调用 patch_dom_tree_js ─────────────────
record('4a session_runner 接线 patch_dom_tree_js()',
  RUNNER.includes('patch_dom_tree_js()'));
record('4b main 接线 patch_dom_tree_js()',
  MAIN.includes('patch_dom_tree_js()'));

// ── 5. 层2 不回归：semantic_snapshot LIMITS 原样 ─────────────────────────────
record('5a semantic_snapshot LIMITS.buttons=40 仍在（本单元不碰层2）',
  SNAPSHOT.includes('buttons: 40'));

const bad = results.filter((r) => !r.ok);
console.log(`\ncharacterize-domtree-occlusion: ${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
