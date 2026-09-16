# Tree-node dirty-suffix cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI/人工录制产品树节点时落库语义名（无拼接 `- `、无 `(N)`），保留 `[V-…]`；回放不依赖脏后缀；批量推送出口清洗历史脏串。

**Architecture:** 单源清洗函数（改语义后的 `stripVolatileTreeText` + DOM 优先取内层语义 span）。xpath / 录制 text / 推送共用同一规则。停止剥 `[V-…]`。

**Tech Stack:** `src/cdp/locator-builders/text.js` + `page-locator-helpers.js` → `node scripts/_gen_locator_helpers_py.mjs`；Playwright characterization；`transaction-export.js`。

**Spec:** [`docs/superpowers/specs/2026-09-16-tree-node-dirty-suffix-design.md`](../specs/2026-09-16-tree-node-dirty-suffix-design.md)

## Global Constraints

- 脏 = 后缀取值依赖其他因素：剥 `(N)`、剥装饰尾部 `- `；**保留** `[V-…]`
- 装饰 `-` 优先 DOM（内层语义 span），正则只剥尾部 `/\s*-\s*$/`，不剥名称中间 `-`
- 不手改 `_locator_helpers_js.py`（改 helpers 源后 gen）
- 不批量迁移历史 DB 行
- 不改 SPA 标题拼装（落库干净即可）

## File map

| File | Responsibility |
|------|----------------|
| `src/cdp/locator-builders/text.js` | Node 侧 `stripVolatileTreeText` + `treeSemanticTextFromNode(node)` |
| `src/cdp/page-locator-helpers.js` | 注入侧同名函数；`buildLocatorSnap` tree_node 的 `text` |
| `scripts/manual_recorder/js_parts/b.py` | sidebar 树 click 与 form tree-select 一致写入清洗文本 |
| AI click / enrich 落点 | tree_node `text` 清洗后再入 element |
| `src/services/transaction-export.js` | `buildBusinessObjectName` 对树文案出口清洗 |
| characterization | 锁住新语义 |

---

### Task 1: 清洗函数语义 + characterization

**Files:**
- Modify: `src/cdp/locator-builders/text.js` (`stripVolatileTreeText` ~57–65；新增 `treeSemanticTextFromNode`)
- Modify: `src/cdp/page-locator-helpers.js` (`stripVolatileTreeText` ~19–24；同步 DOM helper；供 snap 调用)
- Modify: `scripts/characterization/cold/characterize-locator-candidates.mjs`（现有 tree strips count ~224–228；**新增** V 保留断言）
- Create: `scripts/characterization/cold/characterize-tree-node-text.mjs`（DOM fixture：拼接 `-`、`(N)`、中间 `-`、`[V-…]`）
- Modify: `scripts/refactor/verify-all.sh` 注册新 pin
- Run: `node scripts/_gen_locator_helpers_py.mjs`

**Interfaces:**
- Consumes: 无
- Produces:
  - `stripVolatileTreeText(text: string): string` — 空白归一；剥尾部 `\(\d+\)`；剥尾部 `\s*-\s*$`；**不**剥 `[V-…]`；trim；slice(0,40)
  - `treeSemanticTextFromNode(node: Element|null): string` — 若存在 `.custom-tree-node`，优先取其内层「有实质文本的子 span」（排除 expand/icon）的 `textContent`，再经 `stripVolatileTreeText`；否则对 `cleanVisibleText(node)` 再 strip

- [ ] **Step 1: Write failing characterization**

`characterize-tree-node-text.mjs`（Playwright `setContent` fixture）：

1. 拼接：`custom-tree-node` > colored span `年龄限制` + 兄弟文本 `- ` → `treeSemanticTextFromNode` === `年龄限制`
2. 计数：文本 `金融新产品(7)` → strip === `金融新产品`
3. 中间连字符：`KB测一级-20260907-1835(1)` → `KB测一级-20260907-1835`
4. 版本：`测试111[V-0.0.1]` → **仍含** `[V-0.0.1]`
5. Offline：`buildTreeNodeXPathSmart({ text: '贷款(272)' })` 仍不含 `(272)`；`buildTreeNodeXPathSmart({ text: '测试111[V-0.0.1]' })` **xpath 字面量含** `[V-0.0.1]`（或至少 starts-with 的 lit 含 V）

同步改 `characterize-locator-candidates.mjs`：在 tree strips 旁加 V 保留用例。

- [ ] **Step 2: Run tests — expect RED**

```bash
node scripts/characterization/cold/characterize-tree-node-text.mjs
```

Expected: FAIL — V 仍被剥 / 无 DOM helper / 尾部 `-` 未处理。

- [ ] **Step 3: Implement text.js + page-locator-helpers.js**

`text.js`：

```js
export function stripVolatileTreeText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\(\d+\)\s*$/, '')
    .replace(/\s*-\s*$/, '')
    .trim()
    .slice(0, 40);
}

/** Prefer inner semantic span under .custom-tree-node; then stripVolatileTreeText. */
export function treeSemanticTextFromNode(node) { /* ... */ }
```

`page-locator-helpers.js`：模板字符串内同步两函数（注意转义）；`cleanVisibleText` 可保持；新 helper 供 snap 使用。

- [ ] **Step 4: Gen + GREEN**

```bash
node scripts/_gen_locator_helpers_py.mjs
node scripts/characterization/cold/characterize-tree-node-text.mjs
node scripts/characterization/cold/characterize-locator-candidates.mjs
node scripts/characterization/cold/characterize-locator-parity.mjs
```

- [ ] **Step 5: Commit** `fix(xpath): tree text keeps [V-], strips (N) and splice dash`

---

### Task 2: 录制落库 — snap + manual + AI

**Files:**
- Modify: `src/cdp/page-locator-helpers.js` `buildLocatorSnap` (~1613, ~1743–1772)：`kind === 'tree_node'` 时 `t = treeSemanticTextFromNode(host) || stripVolatileTreeText(t)`
- Modify: `scripts/manual_recorder/js_parts/b.py` (~382–403)：sidebar `emit(... elMeta(tree))` 前对 text 使用与 form tree-select 相同的清洗（`treeSemanticTextFromNode(tree)` / strip）；`elMeta` 传入清洗后 textOverride
- Modify: AI 路径 — `scripts/controller/actions/click_action_engine.py` 树节点落库 `text`（~525–531 一带）；`scripts/controller/actions/_helpers.py` `_enrich_click_element` 若 `target_kind==tree_node` 对返回 `text` strip；CDP `inspect-payload-script.js` / resolve 树文本若存在则对齐
- Test: 扩展 `characterize-tree-node-text.mjs` 或 `characterize-tree-select-record.py`：断言 sidebar click payload `text` 无 `(N)` / 尾部 `-`，含 V 时保留

**Interfaces:**
- Consumes: `treeSemanticTextFromNode`, `stripVolatileTreeText`
- Produces: 录制 `element.text` / `params.text` / `option_text`（树）为清洗后语义名

- [ ] **Step 1: Failing pin** — sidebar tree click meta text still dirty for `(N)` fixture（或源码断言 `elMeta(tree)` 未调用 strip — 按现有 characterization 风格选一种）

- [ ] **Step 2: Implement snap + manual sidebar + AI enrich/capture**

`buildLocatorSnap`：

```js
let t = normalizeControlText(text) || cleanVisibleText(host);
if (kind === 'tree_node') {
  t = treeSemanticTextFromNode(host) || stripVolatileTreeText(t);
}
```

manual `b.py` sidebar 分支：与 formHost 分支一样写入清洗后 text（不要裸 `elMeta(tree)` 用脏 innerText）。

AI：enrich/capture 返回前对 tree_node `text` 调用同一规则（Python 侧可 `re` 镜像 strip 规则，或依赖 JS enrich 已清洗）。

- [ ] **Step 3: Verify**

```bash
node scripts/characterization/cold/characterize-tree-node-text.mjs
# + any new/updated record pins
```

- [ ] **Step 4: Commit** `fix(recording): stamp cleaned tree node text on AI and manual paths`

---

### Task 3: 回放文本匹配对齐

**Files:**
- Modify: 回放/点击按文本找树节点的 JS 或 Python 路径（检索 `tree_node` + `starts-with` / `elem_text` / `menu_text`）；比较前对录制串与现场串做 `stripVolatileTreeText`（或调用注入 helpers）
- 确认 xpath_smart 路径已用 strip 后 base（Task 1 后自然对齐）——本任务只补「非 xpath、纯文本」匹配缺口
- Test: cold pin 或现有 click/replay characterization 增一条：录制串 `金融新产品(7)` 与现场 `金融新产品(3)` 清洗后相等可匹配

**Interfaces:**
- Consumes: `stripVolatileTreeText`
- Produces: 回放不要求现场存在 `(N)` 或拼接 `-`

- [ ] **Step 1:** 定位纯文本树匹配点；写失败断言（脏录制串仍可命中净现场名）
- [ ] **Step 2:** 匹配前双侧 strip
- [ ] **Step 3:** GREEN + Commit `fix(replay): match tree nodes on cleaned text`

---

### Task 4: 推送出口兜底

**Files:**
- Modify: `src/services/transaction-export.js` `buildBusinessObjectName` (~78–103)
- Optional: v3 export 若另有树文案字段，同样调用
- Test: Create `scripts/characterization/cold/characterize-tree-text-export.mjs`（或扩展现有 export characterize）：`text: '年龄限制 -'` → propertiesName `年龄限制`；`测试111[V-0.0.1]` 保留 V

**Interfaces:**
- Consumes: `stripVolatileTreeText` from `src/cdp/locator-candidates.js`（或 `locator-builders/text.js`）
- Produces: 导出业务名无 `(N)` / 尾部装饰 `-`，保留 `[V-…]`

- [ ] **Step 1: Failing export pin**
- [ ] **Step 2: Implement** — 对选用的 `text`/`menu_text`/`option_text`/`el.text` 在返回前 `stripVolatileTreeText`（若 `target_kind` 为 tree 或文案匹配树脏模式；最简：对 `buildBusinessObjectName` 最终选用的 text 一律 strip——注意 **不要** 误伤按钮「下一步」等；更安全：仅当 `element.target_kind === 'tree_node'` 或 action 为树点击 / `select_tree_option` 时 strip）
- [ ] **Step 3: GREEN + Commit** `fix(export): sanitize tree node labels for partner push`

---

### Task 5: SUT 湿测（可选但推荐）

**Files:** 无代码；报告写入 `.superpowers/sdd/` 或 plan 勾选证据

- [ ] Playwright MCP：产品树点带 `(N)` 的分类、带 `[V-…]` 的产品；若可达「年龄限制」拼接树则一并点
- [ ] 断言录制/evaluate `buildLocatorSnap` 的 `text` 符合验收 §5
- [ ] 不 commit 密钥；可 commit 报告摘要

---

## Spec coverage

| Spec | Task |
|------|------|
| 停剥 `[V-…]` + 剥 `(N)` + 尾部 `-` | 1 |
| DOM 优先内层 span | 1–2 |
| 录制 AI + 人工 | 2 |
| 回放不依赖脏后缀 | 3 |
| 推送兜底 | 4 |
| 湿测 | 5 |
| 不 migrate 历史 DB | （none） |
