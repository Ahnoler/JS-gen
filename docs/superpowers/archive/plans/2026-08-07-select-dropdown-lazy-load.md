# Select dropdown lazy-load before pick — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `JS_SELECT_OPTION` misses the target option in the open dropdown, stably scroll the list to lazy-load more items, then rematch — so Agent `select_option` and live `_replay.py` can pick bottom options (e.g. 此次评级建议等级 → `较差`).

**Architecture:** Make `JS_SELECT_OPTION` an **async** evaluate body; on first-pass miss (not empty), find `.el-select-dropdown__wrap` / scrollbar wrap, scroll to bottom until `itemCount`+`scrollHeight` stable (≤8 rounds, stop after 2 unchanged), rematch once. Python call sites stay `await page.evaluate(JS_SELECT_OPTION, …)`.

**Tech Stack:** Python agent (`_js_snippets.py`, `_form.py`, `_replay.py`), Playwright `page.evaluate`, characterization scripts, optional CDP 9242.

**Spec:** `docs/superpowers/archive/specs/2026-08-07-select-dropdown-lazy-load-design.md`  
**E2E baseline:** `.superpowers/sdd/cdp-e2e-select-lazy.json` (21 → 32 options after stable scroll)

## 分层总览（LV）

| 层 | 中文名 | 交付物 | Task |
|----|--------|--------|------|
| **L1** | 表征门禁 | cues：wrap 选择器 + 稳态滚底 + async | Task 1 |
| **L2** | JS 实现 | `JS_SELECT_OPTION` miss→滚底→再匹配 | Task 2 |
| **L3** | 验收文档 | CHANGELOG 短条目；可选 CDP 冒烟；spec Implemented | Task 3 |

```
L1 表征(红) ──► L2 JS_SELECT_OPTION ──► L3 CHANGELOG / CDP
                     │
                     ├─ Agent select_option (已共用)
                     └─ _replay.py select_option (已共用)
```

## Global Constraints

- Surface: Agent + live `_replay.py` only via shared `JS_SELECT_OPTION`; **do not** change `CTRL.selectOption` this iteration.
- Strategy **B**: match first; scroll-load only on miss (not before every pick).
- Match rules unchanged: exact / includes / `first` / `exactOnly`.
- Scroll wrap priority: `.el-select-dropdown__wrap` → `.el-scrollbar__wrap` → overflow scroll child; none → no scroll.
- Load loop: ≤8 rounds, ~250ms wait, stop when count+`scrollHeight` unchanged **twice**; not unbounded.
- Do not fall back to `document.querySelectorAll` all dropdown items.
- TDD: characterization fails before production change.
- `docs/` gitignored — commit `scripts/` (+ `CHANGELOG.md` if noted); specs/plans stay local.

## File map

| File | Role |
|------|------|
| `scripts/actions/_js_snippets.py` | Async `JS_SELECT_OPTION` + stable scroll-load |
| `scripts/characterization/characterize-select-lazy-load.py` | New characterization (cues) |
| `CHANGELOG.md` | Brief Unreleased behavior note |
| `scripts/actions/_form.py` / `_replay.py` | **No logic change** expected (already evaluate shared JS) |

---

### Task 1（L1）：表征 — lazy-load cues

**Files:**
- Create: `scripts/characterization/characterize-select-lazy-load.py`
- Test: same

**Interfaces:**
- Produces: failing then passing cues against `_js_snippets.py` source
- Consumes: none

- [ ] **Step 1: Write failing characterization**

```python
#!/usr/bin/env python3
"""Characterize el-select lazy-load before pick (JS_SELECT_OPTION)."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.actions._js_snippets import JS_SELECT_OPTION


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    js = JS_SELECT_OPTION
    assert_true(
        "async" in js and ("(arg)" in js or "arg" in js[:80]),
        "JS_SELECT_OPTION must be async evaluate body",
    )
    assert_true("el-select-dropdown__wrap" in js, "wrap selector")
    assert_true("el-scrollbar__wrap" in js, "scrollbar wrap fallback")
    assert_true("scrollHeight" in js, "stable load uses scrollHeight")
    assert_true(
        "SELECT_LAZY_LOAD" in js or "stableStreak" in js or "stable" in js.lower(),
        "stable-load marker / streak",
    )
    # Must not scroll before attempting first match — strategy B cue:
    # marker comment near miss path
    assert_true(
        "SELECT_LAZY_LOAD_ON_MISS" in js,
        "SELECT_LAZY_LOAD_ON_MISS marker on miss path only",
    )
    print("characterize-select-lazy-load: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run — expect FAIL**

Run: `python scripts/characterization/characterize-select-lazy-load.py`  
Expected: FAIL (missing markers / not async)

- [ ] **Step 3: Commit test only (optional) or hold until Task 2**

Prefer commit with Task 2 in one go if TDD red was verified locally; or:

```bash
git add scripts/characterization/characterize-select-lazy-load.py
git commit -m "test: characterize select dropdown lazy-load cues"
```

---

### Task 2（L2）：实现 — async `JS_SELECT_OPTION` + miss 后稳态滚底

**Files:**
- Modify: `scripts/actions/_js_snippets.py` (`JS_SELECT_OPTION` starting ~L987)
- Test: `scripts/characterization/characterize-select-lazy-load.py`

**Interfaces:**
- Consumes: existing dropdown resolution (`__last_select_trigger`, `JS_FIND_VISIBLE_DROPDOWN`)
- Produces: `JS_SELECT_OPTION = '''async (arg) => { ... }'''` — same return strings (`ok:…`, `no-items`, `option-not-found:…`)

- [ ] **Step 1: Confirm Task 1 still fails (RED)**

- [ ] **Step 2: Refactor `JS_SELECT_OPTION` to async and add load-on-miss**

Keep existing arg parsing, dropdown find, `visibleItems` / `pickPool`, `tryClick`, `FIRST_ALIASES`, exact/includes/`exactOnly` logic.

Structural change (conceptual — merge into existing function body):

```javascript
JS_SELECT_OPTION = '''async (arg) => {
    // ... existing arg / dropdown / items / pickPool / tryClick setup ...

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const collectItems = () => {
        let items = dropdown && dropdown !== document
            ? dropdown.querySelectorAll('.el-select-dropdown__item')
            : [];
        if (items.length === 0) {
            const vis = ''' + JS_FIND_VISIBLE_DROPDOWN + ''';
            if (vis && vis !== document) items = vis.querySelectorAll('.el-select-dropdown__item');
        }
        return items;
    };
    const buildPool = (items) => {
        const visibleItems = [...items].filter(/* existing visibility filter */);
        return visibleItems.length > 0 ? visibleItems : [...items];
    };
    const matchInPool = (pickPool) => {
        // existing first / exact / includes → tryClick or null
    };

    let items = collectItems();
    let pickPool = buildPool(items);
    if (pickPool.length === 0) {
        const hasEmpty = /* existing empty check */;
        if (hasEmpty) return 'no-items';
        return 'no-items';
    }
    let hit = matchInPool(pickPool);
    if (hit) return hit;

    /* SELECT_LAZY_LOAD_ON_MISS */
    const findWrap = (dd) => {
        if (!dd || dd === document) return null;
        const w1 = dd.querySelector('.el-select-dropdown__wrap');
        if (w1 && w1.scrollHeight > w1.clientHeight + 2) return w1;
        const w2 = dd.querySelector('.el-scrollbar__wrap');
        if (w2 && w2.scrollHeight > w2.clientHeight + 2) return w2;
        for (const n of dd.querySelectorAll('*')) {
            const s = getComputedStyle(n);
            if ((s.overflowY === 'auto' || s.overflowY === 'scroll')
                && n.scrollHeight > n.clientHeight + 2) return n;
        }
        return null;
    };
    try {
        const wrap = findWrap(dropdown);
        if (wrap) {
            let stableStreak = 0;
            let prevCount = pickPool.length;
            let prevHeight = wrap.scrollHeight;
            for (let i = 0; i < 8; i++) {
                wrap.scrollTop = wrap.scrollHeight;
                await sleep(250);
                items = collectItems();
                pickPool = buildPool(items);
                const h = wrap.scrollHeight;
                const c = pickPool.length;
                if (c === prevCount && h === prevHeight) {
                    stableStreak += 1;
                } else {
                    stableStreak = 0;
                    prevCount = c;
                    prevHeight = h;
                }
                if (stableStreak >= 2) break;
            }
            hit = matchInPool(pickPool);
            if (hit) return hit;
        }
    } catch (e) {
        items = collectItems();
        pickPool = buildPool(items);
        hit = matchInPool(pickPool);
        if (hit) return hit;
    }

    // existing option-not-found preview return
    const preview = pickPool.slice(0, 30).map(i => i.textContent.trim()).filter(Boolean);
    return 'option-not-found:' + preview.join(', ');
}'''
```

Important:
- Do **not** run lazy-load when first-pass already hits.
- Empty panel: return `no-items` **before** scroll (existing empty check).
- Do not broaden to all document dropdown items.

- [ ] **Step 3: Run characterization — expect PASS**

```bash
python scripts/characterization/characterize-select-lazy-load.py
python scripts/characterization/characterize-xpath-fill-select.py
python scripts/characterization/characterize-ctrl.mjs
```

Expected: all OK (`characterize-ctrl` still maps `selectOption` → `JS_SELECT_OPTION` cue).

- [ ] **Step 4: Commit**

```bash
git add scripts/actions/_js_snippets.py scripts/characterization/characterize-select-lazy-load.py
git commit -m "feat(select): lazy-load dropdown options on miss before pick"
```

---

### Task 3（L3）：CHANGELOG + 可选 CDP + spec 状态

**Files:**
- Modify: `CHANGELOG.md` `[Unreleased]`
- Local: mark spec Status → Implemented
- Optional: CDP smoke script using existing `.superpowers/sdd/cdp_e2e_select_lazy.py` pattern

- [ ] **Step 1: CHANGELOG**

Under `[Unreleased]` → **Changed** (or **Fixed**):

```markdown
- **el-select 懒加载选项：** `JS_SELECT_OPTION` 首轮未命中时，对下拉滚动容器稳态滚底加载更多选项后再匹配（Agent `select_option` 与 live `_replay.py` 共用）。不改 `CTRL.selectOption`。
  影响：`scripts/actions/_js_snippets.py`（调用方 `_form.py` / `_replay.py` 无接口变更）。
  Python 同步提示：无（scripts 侧）；若 Python 控制面自带同源 snippets 需对齐。
```

(Adjust wording to match repo CHANGELOG style.)

- [ ] **Step 2: Optional CDP**

If `http://127.0.0.1:9242` up and page has 此次评级建议等级:

1. Open select → confirm first pool lacks `较差`
2. `page.evaluate(JS_SELECT_OPTION, '较差')` → `ok:较差`  
Do not fail Task 3 if CDP unavailable — note in report.

- [ ] **Step 3: Spec status** → `Implemented` on local design md.

- [ ] **Step 4: Commit CHANGELOG**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG for select dropdown lazy-load on miss"
```

---

## Spec coverage（自检）

| Spec requirement | Task |
|------------------|------|
| Miss → scroll-load → rematch | T2 |
| Agent + live replay via shared JS | T2 (no Python fork) |
| Async evaluate | T2 |
| Wrap priority + stable ≤8 / streak 2 | T2 |
| Skip scroll on hit / empty / no wrap | T2 |
| exactOnly / first unchanged | T2 |
| Characterization cues | T1 |
| CDP E2E optional | T3 |
| CTRL out of scope | respected |

## Placeholder / consistency

- Marker names: `SELECT_LAZY_LOAD_ON_MISS` required by Task 1.
- Return contract strings unchanged.
- No dual Python evaluate orchestration.
