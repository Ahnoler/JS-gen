# 步骤 element 分层 + 坐标入库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 录制时把步骤操作控件的 `region_id`/`region_label`/`layers[]` + `bbox`（内容坐标）写入 `trajectory_step.element_json`，使元素分层直接读 step、步骤级高亮可用 bbox。

**Architecture:** Python 录制动作时（`_capture_element` / `_enrich_click_element`）evaluate 已注入 `PAGE_LOCATOR_HELPERS` 的 snippet，对控件调 `assignRegion`（分层）+ 内容坐标 `stepBBoxOf`（复用泛化 `pickScrollRoot`），新字段随 element dict 透传进 `element_json`（Node 侧已确认不裁剪）。只影响新录制。

**Tech Stack:** Python（scripts/controller/actions/）+ Node（src/cdp/locator-candidates.js 生成 helpers）；characterization 断言（无浏览器）。

**Spec:** `docs/superpowers/specs/2026-08-17-step-element-region-bbox-design.md`

## Global Constraints

- bbox 为**内容坐标系**：`x1=rect.left-box.x`、`y1=rect.top+root.scrollTop-box.y`、x2/y2 同理（对齐阶段截图 `metadata.rect`，`phase-screenshot-capture.js` pushCollected 同一公式）。
- `pickScrollRoot` 泛化逻辑与 `src/cdp/phase-screenshot-page.js` 的 `PICK_SCROLL_ROOT_FN` 一致（标准主区优先 → 全页最高可滚动容器 → document）。
- 只影响新录制；存量步骤不回填。
- characterization 用 `assert_true` 模式（参考 `scripts/characterization/characterize-capture-element-xpath.py`），`sys.path.insert(0, ROOT)` + `from scripts.controller.actions import _js_snippets`。
- 不提交 git 之外的文件；CHANGELOG 由 Task 5 追加 `[Unreleased]` → `### Changed`。

---

### Task 1: PAGE_LOCATOR_HELPERS 加 pickScrollRoot + stepBBoxOf（分层/坐标基础）

**Files:**
- Modify: `src/cdp/locator-candidates.js`（PAGE_LOCATOR_HELPERS 模板字符串，追加两个函数）
- Modify: `src/cdp/phase-screenshot-page.js`（collect 表达式去重：移除 `${PICK_SCROLL_ROOT_FN}` 内联，改用 helpers 里的 `pickScrollRoot`；scroll 表达式保留 `PICK_SCROLL_ROOT_FN`）
- Regenerate: `scripts/controller/actions/js_snippets/_locator_helpers_js.py`（`node scripts/_gen_locator_helpers_py.mjs`）
- Create: `scripts/characterization/characterize-step-region-bbox.py`
- Test: `python scripts/characterization/characterize-step-region-bbox.py`

**Interfaces:**
- Consumes: 无（基础层）
- Produces: 注入浏览器环境的 `pickScrollRoot()`（返回滚动根元素）与 `stepBBoxOf(el)`（返回 `{x1,y1,x2,y2}` 内容坐标），供 Task 2/3 的 snippet 调用；`_locator_helpers_js.py` 同步生成。

- [ ] **Step 1: Write the failing characterization**

Create `scripts/characterization/characterize-step-region-bbox.py`:

```python
#!/usr/bin/env python3
"""Characterize step region/bbox persistence (recording-side region + coords)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_helpers_have_scroll_root_and_bbox() -> None:
    from scripts.controller.actions.js_snippets._locator_helpers_js import PAGE_LOCATOR_HELPERS

    assert_true("function pickScrollRoot" in PAGE_LOCATOR_HELPERS, "helpers embed pickScrollRoot")
    assert_true("scrollHeight > best.scrollHeight" in PAGE_LOCATOR_HELPERS, "generic tallest-container scan")
    assert_true("function stepBBoxOf" in PAGE_LOCATOR_HELPERS, "helpers embed stepBBoxOf")
    assert_true("root.scrollTop" in PAGE_LOCATOR_HELPERS, "bbox uses content coords (scrollTop offset)")


def test_phase_screenshot_collect_uses_helpers_root() -> None:
    # collect 表达式不得再内联 pickScrollRoot（与 helpers 重复定义会语法冲突）
    src = (ROOT / "src/cdp/phase-screenshot-page.js").read_text(encoding="utf-8")
    assert_true("PICK_SCROLL_ROOT_FN" in src, "scroll expression keeps its own root fn")
    collect = src.split("buildPhaseScreenshotCollectExpression", 1)[1]
    assert_true("PICK_SCROLL_ROOT_FN" not in collect, "collect must not inline PICK_SCROLL_ROOT_FN (helpers provide it)")


def main() -> int:
    test_helpers_have_scroll_root_and_bbox()
    test_phase_screenshot_collect_uses_helpers_root()
    print("characterize-step-region-bbox: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run — expect FAIL**

```powershell
python scripts/characterization/characterize-step-region-bbox.py
```

Expected: `AssertionError: helpers embed pickScrollRoot`（当前 helpers 无该函数）。

- [ ] **Step 3: Add pickScrollRoot + stepBBoxOf to PAGE_LOCATOR_HELPERS**

In `src/cdp/locator-candidates.js`, inside the `PAGE_LOCATOR_HELPERS` template string (near `assignRegion`/`buildRegionLayers`, before the closing backtick), append:

```js
    function pickScrollRoot() {
      const cands = document.querySelectorAll('.el-main, .app-main');
      for (let k = 0; k < cands.length; k++) {
        const el = cands[k];
        const s = getComputedStyle(el);
        const oy = s.overflowY || s.overflow;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 8) return el;
      }
      let best = null;
      const all = document.querySelectorAll('div, main, section, article');
      for (let k = 0; k < all.length; k++) {
        const el = all[k];
        if (el.clientHeight < 100) continue;
        const s = getComputedStyle(el);
        const oy = s.overflowY || s.overflow;
        if (oy !== 'auto' && oy !== 'scroll') continue;
        if (el.scrollHeight <= el.clientHeight + 8) continue;
        if (!best || el.scrollHeight > best.scrollHeight) best = el;
      }
      if (best) return best;
      return document.scrollingElement || document.documentElement;
    }
    function stepBBoxOf(el) {
      if (!el || !el.getBoundingClientRect) return null;
      const root = pickScrollRoot();
      const isDoc = root === document.scrollingElement || root === document.documentElement;
      const box = isDoc ? { x: 0, y: 0 } : root.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return {
        x1: Math.round(r.left - box.x),
        y1: Math.round(r.top + root.scrollTop - box.y),
        x2: Math.round(r.right - box.x),
        y2: Math.round(r.bottom + root.scrollTop - box.y),
      };
    }
```

**Do NOT change** the logic vs `phase-screenshot-page.js` `PICK_SCROLL_ROOT_FN`（同一公式）。

- [ ] **Step 4: Dedupe collect expression in phase-screenshot-page.js**

In `src/cdp/phase-screenshot-page.js`, `buildPhaseScreenshotCollectExpression` 的模板字符串：删除 `${PICK_SCROLL_ROOT_FN}` 那行（helpers 已注入 `pickScrollRoot`，collect 表达式 `(${PAGE_LOCATOR_HELPERS})` 自带）；保留 `const root = pickScrollRoot();` 调用。`buildPhaseScreenshotScrollExpression` **不改**（该表达式不注入 helpers，保留 `${PICK_SCROLL_ROOT_FN}`）。

- [ ] **Step 5: Regenerate Python helpers**

```bash
node scripts/_gen_locator_helpers_py.mjs
```

Expected: `scripts/controller/actions/js_snippets/_locator_helpers_js.py` 更新（含 pickScrollRoot/stepBBoxOf）。

- [ ] **Step 6: Run — expect PASS**

```powershell
python scripts/characterization/characterize-step-region-bbox.py
node scripts/characterization/characterize-phase-highlight-screenshot.mjs
```

Expected: `characterize-step-region-bbox: OK` + phase-highlight-screenshot `ok`（collect 去重未破坏截图链路）。

- [ ] **Step 7: Commit**

```bash
git add src/cdp/locator-candidates.js src/cdp/phase-screenshot-page.js scripts/controller/actions/js_snippets/_locator_helpers_js.py scripts/characterization/characterize-step-region-bbox.py
git commit -m "feat(record): PAGE_LOCATOR_HELPERS gains pickScrollRoot + stepBBoxOf (step region/bbox base)"
```

---

### Task 2: JS_CAPTURE_FROM_XPATH 返回 region/layers/bbox

**Files:**
- Modify: `scripts/controller/actions/js_snippets/fill_core.py`（`JS_CAPTURE_FROM_XPATH` 返回对象）
- Modify: `scripts/characterization/characterize-step-region-bbox.py`（追加断言）
- Test: `python scripts/characterization/characterize-step-region-bbox.py`

**Interfaces:**
- Consumes: Task 1 的 `assignRegion`/`pickScrollRoot`/`stepBBoxOf`（helpers 已注入）
- Produces: `JS_CAPTURE_FROM_XPATH` 返回对象新增 `region_id`/`region_label`/`layers`/`bbox`，供 Task 4 `_capture_element` 透传

- [ ] **Step 1: Write the failing assertions**

Append to `characterize-step-region-bbox.py`:

```python
def test_capture_has_region_bbox() -> None:
    from scripts.controller.actions import _js_snippets as sn

    js = sn.JS_CAPTURE_FROM_XPATH
    assert_true("assignRegion(host)" in js, "capture computes region via assignRegion")
    assert_true("stepBBoxOf(host)" in js, "capture computes bbox")
    assert_true("region_id: reg.region_id" in js, "capture returns region_id")
    assert_true("layers: Array.isArray(reg.layers)" in js, "capture returns layers")
    assert_true("bbox: stepBBoxOf(host)" in js, "capture returns bbox")
```

And register it in `main()` before the final print:

```python
    test_capture_has_region_bbox()
```

- [ ] **Step 2: Run — expect FAIL**

```powershell
python scripts/characterization/characterize-step-region-bbox.py
```

Expected: `AssertionError: capture computes region via assignRegion`.

- [ ] **Step 3: Extend the capture return object**

In `fill_core.py`, `JS_CAPTURE_FROM_XPATH` 的返回对象（`return { xpath: primary, ... candidates: [...] }`）前加：

```js
  const reg = assignRegion(host);
```

并在返回对象内追加（在 `target_kind` 之后）：

```js
    region_id: reg.region_id || '',
    region_label: reg.region_label || '',
    layers: Array.isArray(reg.layers) ? reg.layers : [],
    bbox: stepBBoxOf(host),
```

保持其余字段不变。

- [ ] **Step 4: Run — expect PASS**

```powershell
python scripts/characterization/characterize-step-region-bbox.py
python scripts/characterization/characterize-capture-element-xpath.py
```

Expected: 两者 OK（原有 capture 断言不破坏）。

- [ ] **Step 5: Commit**

```bash
git add scripts/controller/actions/js_snippets/fill_core.py scripts/characterization/characterize-step-region-bbox.py
git commit -m "feat(record): JS_CAPTURE_FROM_XPATH returns region_id/layers/bbox"
```

---

### Task 3: JS_ENRICH_CLICK_LOCATOR 返回 region/layers/bbox

**Files:**
- Modify: `scripts/controller/actions/js_snippets/enrich.py`（`JS_ENRICH_CLICK_LOCATOR` 返回对象）
- Modify: `scripts/characterization/characterize-step-region-bbox.py`（追加断言）
- Test: `python scripts/characterization/characterize-step-region-bbox.py`

**Interfaces:**
- Consumes: Task 1 helpers（`assignRegion`/`stepBBoxOf`）；snippet 内控件变量为 `el`
- Produces: `JS_ENRICH_CLICK_LOCATOR` 返回对象新增 4 字段，供 Task 4 `_enrich_click_element` 透传

- [ ] **Step 1: Write the failing assertions**

Append:

```python
def test_enrich_has_region_bbox() -> None:
    from scripts.controller.actions import _js_snippets as sn

    js = sn.JS_ENRICH_CLICK_LOCATOR
    assert_true("assignRegion(el)" in js, "enrich computes region via assignRegion")
    assert_true("stepBBoxOf(el)" in js, "enrich computes bbox")
    assert_true("region_id: reg.region_id" in js, "enrich returns region_id")
    assert_true("bbox: stepBBoxOf(el)" in js, "enrich returns bbox")
```

Register in `main()`.

- [ ] **Step 2: Run — expect FAIL**

```powershell
python scripts/characterization/characterize-step-region-bbox.py
```

Expected: `AssertionError: enrich computes region via assignRegion`.

- [ ] **Step 3: Extend the enrich return object**

In `enrich.py`, `JS_ENRICH_CLICK_LOCATOR` 的返回对象（`return { tag_name: loc.tag ... locator_fallback_reason }`）前加：

```js
  const reg = assignRegion(el);
```

并在返回对象内追加（`target_kind` 之后）：

```js
    region_id: reg.region_id || '',
    region_label: reg.region_label || '',
    layers: Array.isArray(reg.layers) ? reg.layers : [],
    bbox: stepBBoxOf(el),
```

- [ ] **Step 4: Run — expect PASS**

```powershell
python scripts/characterization/characterize-step-region-bbox.py
python scripts/characterization/characterize-icon-buttons.py
```

Expected: 两者 OK。

- [ ] **Step 5: Commit**

```bash
git add scripts/controller/actions/js_snippets/enrich.py scripts/characterization/characterize-step-region-bbox.py
git commit -m "feat(record): JS_ENRICH_CLICK_LOCATOR returns region_id/layers/bbox"
```

---

### Task 4: `_helpers.py` 透传 region/layers/bbox 到 element dict

**Files:**
- Modify: `scripts/controller/actions/_helpers.py`（`_capture_element` ~line 301-341、`_enrich_click_element` ~line 343-400）
- Modify: `scripts/characterization/characterize-step-region-bbox.py`（追加断言）
- Test: `python scripts/characterization/characterize-step-region-bbox.py` + import smoke

**Interfaces:**
- Consumes: Task 2/3 snippet 返回的新字段（`info['region_id']` 等）
- Produces: element dict（`_record_action(..., element=element)` 的 element）含 `region_id`/`region_label`/`layers`/`bbox`，Node 侧原样写入 `element_json`

- [ ] **Step 1: Write the failing assertions**

Append:

```python
def test_helpers_passthrough_region_bbox() -> None:
    src = (ROOT / "scripts/controller/actions/_helpers.py").read_text(encoding="utf-8")
    # 注意：_helpers.py 现有 dict 用双引号风格
    assert_true('"region_id": info.get("region_id")' in src, "_capture_element passes region_id")
    assert_true('"bbox": info.get("bbox")' in src, "_capture_element passes bbox")
    assert_true('"layers": info.get("layers")' in src, "_capture_element passes layers")
    assert_true('"region_label": info.get("region_label")' in src, "_capture_element passes region_label")
```

Register in `main()`.

- [ ] **Step 2: Run — expect FAIL**

```powershell
python scripts/characterization/characterize-step-region-bbox.py
```

Expected: `AssertionError: _capture_element passes region_id`.

- [ ] **Step 3: Pass through in both helpers**

In `_helpers.py`:

1. `_capture_element` 的返回 dict（`return { "xpath": ... "target_kind": ... }`）追加：

```python
        "region_id": info.get("region_id") or "",
        "region_label": info.get("region_label") or "",
        "layers": info.get("layers") if isinstance(info.get("layers"), list) else [],
        "bbox": info.get("bbox") if isinstance(info.get("bbox"), dict) else None,
```

2. `_enrich_click_element` 的 `out = {...}` dict（`'locator_strategy': ...` 之后）追加同样 4 行（`info.get(...)` 同字段名）。

- [ ] **Step 4: Run — expect PASS + import smoke**

```powershell
python scripts/characterization/characterize-step-region-bbox.py
python -c "from scripts.controller.actions._helpers import _capture_element, _enrich_click_element; print('import OK')"
python scripts/characterization/characterize-form-engine-wiring.py
```

Expected: 全部 OK。

- [ ] **Step 5: Commit**

```bash
git add scripts/controller/actions/_helpers.py scripts/characterization/characterize-step-region-bbox.py
git commit -m "feat(record): helpers pass region_id/layers/bbox into element dict"
```

---

### Task 5: CHANGELOG + verify-all 注册 + 湿测指南

**Files:**
- Modify: `CHANGELOG.md`（`[Unreleased]` → `### Changed`）
- Modify: `scripts/refactor/verify-all.sh`（注册新 characterization）
- Test: `bash scripts/refactor/verify-all.sh`（内嵌 Python 优先，脚本已修）

**Interfaces:**
- Consumes: Task 1-4 全部完成
- Produces: 发布记录 + 门禁注册

- [ ] **Step 1: CHANGELOG `[Unreleased]` → `### Changed` 顶部插入**

```markdown
- 2026-08-17: **步骤 element 分层 + 坐标入库**：录制时 `_capture_element`/`_enrich_click_element` 对操作控件 evaluate `assignRegion`（分层）+ `stepBBoxOf`（内容坐标，复用泛化 `pickScrollRoot`），`element_json` 新增 `region_id`/`region_label`/`layers[]`/`bbox{x1,y1,x2,y2}`（内容坐标系，对齐阶段截图 `metadata.rect`）。元素分层可直接读 step；步骤级高亮（PR-LOC-HL）用 bbox 画框。只影响新录制，存量不回填。`PAGE_LOCATOR_HELPERS` 新增 `pickScrollRoot`/`stepBBoxOf`，阶段截图 collect 表达式去重共用。
  影响范围：录制链路（scripts/controller/actions）、`_locator_helpers_js.py`（重生成）、element_json 新增字段（无 schema）。
  文件：src/cdp/locator-candidates.js, src/cdp/phase-screenshot-page.js, scripts/controller/actions/js_snippets/{fill_core,enrich}.py, scripts/controller/actions/_helpers.py, scripts/controller/actions/js_snippets/_locator_helpers_js.py, scripts/characterization/characterize-step-region-bbox.py
  Python 同步提示：element_json 新增 region_id/region_label/layers/bbox（内容坐标，滚动根=标准主区或全页最高可滚动容器）；若代理侧有类似录制链路，需在操作控件时取分层与坐标。
```

- [ ] **Step 2: verify-all.sh 注册**

在 `run "characterize-sso-auth" ...` 行后加：

```bash
run "characterize-step-region-bbox" "$PY" scripts/characterization/characterize-step-region-bbox.py
```

- [ ] **Step 3: Run gate**

```bash
bash scripts/refactor/verify-all.sh
```

Expected: ALL GREEN（`characterize-step-region-bbox` 含在内；`characterize-tree-select-record` 仍需 `playwright install`，预存环境，其余全绿）。

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md scripts/refactor/verify-all.sh
git commit -m "docs(changelog): note step element region/bbox persistence; register characterization in verify-all"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| element_json 新增 region_id/region_label/layers/bbox（内容坐标） | Task 2/3/4 |
| 坐标公式对齐 metadata.rect（box + scrollTop） | Task 1 `stepBBoxOf` |
| pickScrollRoot 泛化（含内部滚动容器） | Task 1 |
| Python 录制侧获取（_capture_element/_enrich_click_element） | Task 2/3/4 |
| 只影响新录制 | Global Constraints（无存量回填任务） |
| 消费方：分层工具 --trajectory 已支持；推送导出 regionId 自动带出 | 无代码任务（已具备，spec 4.4） |
| characterization + import smoke + 门禁 | Task 1-5 |
