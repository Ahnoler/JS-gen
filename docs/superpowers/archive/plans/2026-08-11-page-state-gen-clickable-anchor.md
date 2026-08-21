# Page-state-gen Clickable Anchor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize wizard page-state anchoring so **any colliding clickable** leaf gets a verified page-state–wrapped `xpath_smart` (steps → dialog/drawer → breadcrumb/main title); unique hosts stay bare; wizard「下一步/上一步」keeps working via the same helpers.

**Architecture:** Extend `pageStateOf` / `pageStateNavXPath` in `PAGE_LOCATOR_HELPERS` (dialog/drawer kinds). In `buildLocatorSnap`, after section/titlebox attempts, if current smart still multi-hit **and** host is a text clickable (not unique form_*), try page-state wrap → re-verify unique. Remove the `isWizardNavLabel`-only gate for wrap eligibility (wizard becomes a special case of the same path). Sync Python helpers; keep `characterize-wizard-next-page-state.py` green; add `characterize-page-state-gen.mjs`.

**Tech Stack:** `src/cdp/page-locator-helpers.js`, `_gen_locator_helpers_py.mjs`, resolve inventory/collision path (reuse snap), characterization scripts.

**Spec:** `docs/superpowers/specs/2026-08-10-page-state-gen-clickable-anchor-design.md`

## Global Constraints

- Page-state signal **C**: wizard step (`is-process`/`is-active`) → else dialog/drawer title → else breadcrumb/main short title → else empty.
- Wrap **only on collision** (`eval_count ≥ 2` or uniqueness fail); never bloat unique clickables.
- Priority: verified titlebox/section → page-state → bare leaf; **never** `(…)[n]` when a verified anchor exists.
- Fail-soft: no page state / wrap still multi-hit / host mismatch → keep prior xpath; never drop matches.
- Playwright locate = relative `xpath_smart` only.
- Do **not** force-wrap unique labeled form inputs (`form_*`).
- Wizard 下一步/上一步 must not regress (`characterize-wizard-next-page-state.py`).
- Source of truth: `page-locator-helpers.js` → regen `_locator_helpers_js.py`.
- Offline-only enrich without DOM is **out of P0**.
- TDD: characterization fail → implement → green.
- Commit only if user asks.
- CHANGELOG if product-visible xpath semantics expand beyond wizard nav (yes for this cut).

## File map

| File | Role |
|------|------|
| `src/cdp/page-locator-helpers.js` | Extend `pageStateOf` / `pageStateAnchorXPath`; generalize `buildLocatorSnap` wrap |
| `scripts/controller/actions/js_snippets/_locator_helpers_js.py` | Regen sync |
| `scripts/characterization/characterize-page-state-gen.mjs` | New char (collision wrap + dialog kind + unique no-wrap) |
| `scripts/characterization/characterize-wizard-next-page-state.py` | Regression green |
| `CHANGELOG.md` | Unreleased note |
| Spec / backlog status | Implemented when green |

```text
buildLocatorSnap
  → xpathSmartOf / wizard-or-generic leaf
  → section anchor if multi
  → titlebox anchor if multi
  → if still multi && clickable && pageStateOf()
       → pageStateAnchorXPath → verify unique
  → else bare / prior
```

---

### Task 1: Characterization — page-state-gen cues

**Files:**
- Create: `scripts/characterization/characterize-page-state-gen.mjs`
- Test: same

**Interfaces:**
- Consumes: helpers source + `PAGE_LOCATOR_HELPERS` / `buildLocatorSnap` if importable from Node char pattern used by inventory
- Produces: RED until Task 2

- [ ] **Step 1: Write failing characterization**

```js
/**
 * Characterize page-state-gen (collision-only clickable anchors).
 *   node scripts/characterization/characterize-page-state-gen.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const helpers = readFileSync(join(root, 'src/cdp/page-locator-helpers.js'), 'utf8');
function ok(n) { console.log(`ok: ${n}`); }

{
  assert.match(helpers, /function pageStateOf\s*\(/);
  assert.match(helpers, /el-dialog|el-drawer/);
  assert.match(helpers, /kind:\s*['\"]dialog['\"]|kind === ['\"]dialog['\"]|wizard_step/);
  assert.match(helpers, /pageStateAnchorXPath|pageStateNavXPath/);
  ok('helpers: pageStateOf includes dialog/drawer kinds');
}

{
  // Wrap not gated only on 下一步/上一步 — look for collision-driven page-state try
  assert.match(helpers, /pageStateOf\s*\(/);
  // After generalization, wrap should run when multi-hit, not only isWizardNavLabel
  assert.match(
    helpers,
    /tryPageState|pageStateAnchor|still multi|nodesMulti.*pageState|pageStateOf\(\)[\s\S]{0,200}evalXpathAll/,
  );
  ok('helpers: page-state wrap on collision path');
}

{
  // Unique form fields must not be forced through page-state wrap gate for form_*
  assert.match(helpers, /form_/);
  ok('helpers: form_* still present (no-force-wrap cue)');
}

console.log('characterize-page-state-gen: ok');
```

Tune the middle assert after reading current helpers: today wrap is behind `isWizardNavLabel` — char should **fail** until Task 2 removes that gate and adds dialog kind + general collision wrap. Prefer asserting absence of exclusive gate:

```js
// After Task 2: isWizardNavLabel may remain for leaf text checks, but page-state wrap
// must also run for generic multi-hit buttons. Assert dialog kind + a marker comment:
assert.match(helpers, /PAGE_STATE_GEN|tryPageStateAnchor|page-state-gen/);
assert.match(helpers, /el-dialog__title|el-drawer__title/);
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node scripts/characterization/characterize-page-state-gen.mjs
```

- [ ] **Step 3: Commit** (only if user asks)

---

### Task 2: Extend `pageStateOf` + `pageStateAnchorXPath`

**Files:**
- Modify: `src/cdp/page-locator-helpers.js` (~718–759 and callers)
- Regen: `scripts/controller/actions/js_snippets/_locator_helpers_js.py`
- Test: Task 1 char (partial) + wizard regression

**Interfaces:**
- Produces:
  - `pageStateOf()` → `{ kind: 'wizard_step'|'dialog'|'drawer'|'breadcrumb'|'main', title }` or `null`
  - `pageStateAnchorXPath(host, leafLocal, pageState)` (rename from `pageStateNavXPath` **or** keep alias `pageStateNavXPath = pageStateAnchorXPath` for wizard char)
- Consumes: existing `xpathLiteral`, `classTokenPred`, `normalizeControlText`, `evalXpathAll`

- [ ] **Step 1: Extend `pageStateOf` after steps, before breadcrumb**

```js
function pageStateOf() {
  try {
    // existing el-steps block …
    const dlg = document.querySelector('.el-dialog__wrapper:not([style*="display: none"]) .el-dialog, .el-dialog:not([style*="display: none"])');
    // Prefer visible dialog: use isVisible helper if available
    const dialogs = document.querySelectorAll('.el-dialog');
    for (let i = 0; i < dialogs.length; i++) {
      if (!isVisible(dialogs[i])) continue;
      const titleEl = dialogs[i].querySelector('.el-dialog__title');
      const title = normalizeControlText((titleEl && titleEl.textContent) || '');
      if (title) return { kind: 'dialog', title: title.slice(0, 40) };
    }
    const drawers = document.querySelectorAll('.el-drawer');
    for (let j = 0; j < drawers.length; j++) {
      if (!isVisible(drawers[j])) continue;
      const titleEl = drawers[j].querySelector('.el-drawer__title, .el-drawer__header');
      const title = normalizeControlText((titleEl && titleEl.textContent) || '');
      if (title) return { kind: 'drawer', title: title.slice(0, 40) };
    }
    // existing breadcrumb …
  } catch (e) { /* ignore */ }
  return null;
}
```

- [ ] **Step 2: Extend xpath builder**

```js
function pageStateAnchorXPath(host, leafLocal, pageState) {
  const leaf = String(leafLocal || '').replace(/^\/+/, '');
  if (!host || !leaf || !pageState || !pageState.title) return '';
  const lit = xpathLiteral(pageState.title);
  if (pageState.kind === 'wizard_step') { /* keep existing */ }
  if (pageState.kind === 'dialog') {
    return "//*[" + classTokenPred('el-dialog') + "][.//*[" + classTokenPred('el-dialog__title')
      + " and contains(normalize-space(.)," + lit + ")]]/ancestor-or-self::*[.//" + leaf + "][1]//" + leaf;
  }
  if (pageState.kind === 'drawer') {
    return "//*[" + classTokenPred('el-drawer') + "][.//*[( " + classTokenPred('el-drawer__title')
      + " or " + classTokenPred('el-drawer__header') + ") and contains(normalize-space(.)," + lit + ")]]"
      + "/ancestor-or-self::*[.//" + leaf + "][1]//" + leaf;
  }
  if (pageState.kind === 'breadcrumb') { /* keep existing */ }
  return '';
}
function pageStateNavXPath(host, leafLocal, pageState) {
  return pageStateAnchorXPath(host, leafLocal, pageState);
}
```

Tune XPath so `eval` uniqueness holds on real Element UI; prefer shapes that mirror wizard_step (ancestor containing leaf).

- [ ] **Step 3: Marker comment** `/* PAGE_STATE_GEN */` near the generalized wrap call site (Task 3) or here for char.
- [ ] **Step 4: Regen Python helpers**
- [ ] **Step 5: Run wizard char**

```bash
python scripts/characterization/characterize-wizard-next-page-state.py
```

Expected: PASS (or fix until PASS)

- [ ] **Step 6: Commit** (if user asks)

---

### Task 3: Collision-only wrap in `buildLocatorSnap`

**Files:**
- Modify: `src/cdp/page-locator-helpers.js` `buildLocatorSnap` (~978–1050)
- Regen Python dual
- Test: `characterize-page-state-gen.mjs` + wizard char

**Interfaces:**
- After section + titlebox verified attempts, if `!verified` or current smart still multi-hit:
  - If kind is `form_*` → **skip** page-state wrap
  - Else compute `localLeaf` / `leafForAnchor`, `ps = pageStateOf()`, `xp = pageStateAnchorXPath(...)`, verify unique host → set smart
- Remove exclusive dependency on `isWizardNavLabel` for attempting wrap (may still prefer early path for 下一步 text)

- [ ] **Step 1: Refactor snap block**

Replace/extend the block that currently starts with `if (isWizardNavLabel(t)) { ... }` so that:

```js
/* PAGE_STATE_GEN — collision-only page-state wrap for clickables */
function tryPageStateAnchor(host, leaf, text) {
  const ps = pageStateOf();
  if (!ps) return null;
  const xp = pageStateAnchorXPath(host, leaf, ps);
  if (!xp) return null;
  const nodes = evalXpathAll(xp);
  if (nodes.length === 1 && nodes[0] === host) return xp;
  return null;
}
```

Call when:
1. Wizard nav labels (keep early attempt for 下一步 — OK), **and/or**
2. After section/titlebox: `needDisambiguate && kind not form_* && t` → `tryPageStateAnchor`

Do not call when smart already `verified && !nodesMulti`.

- [ ] **Step 2: Regen Python**
- [ ] **Step 3: Chars green**

```bash
node scripts/characterization/characterize-page-state-gen.mjs
python scripts/characterization/characterize-wizard-next-page-state.py
node scripts/characterization/characterize-resolve-collision-titlebox.mjs
node scripts/characterization/characterize-resolve-inventory.mjs
```

- [ ] **Step 4: Commit** (if user asks)

---

### Task 4: Resolve path confirmation + CHANGELOG + docs status

**Files:**
- Verify: resolve inventory/collision already uses `buildLocatorSnap` / `snap()` — if yes, no extra wire; if some path builds xpath without snap, add `tryPageStateAnchor` there
- Modify: `CHANGELOG.md`
- Modify: spec status → Implemented; backlog `page-state-gen` → 代码已实施

**Interfaces:**
- Consumes: Task 2–3 helpers via existing resolve expression injection

- [ ] **Step 1: Grep resolve for xpath construction bypassing snap; fix gaps only if found**
- [ ] **Step 2: CHANGELOG**

```markdown
### Changed
- 2026-08-11: **page-state-gen**：可点击 leaf 在相对 xpath 多命中时，用页态（步骤条→dialog/drawer→breadcrumb）锚定 `xpath_smart`；唯一控件不包。推广原 wizard 下一步逻辑。
  影响范围：CDP locator helpers / 录制 snap / resolve inventory。
  文件：src/cdp/page-locator-helpers.js, scripts/controller/actions/js_snippets/_locator_helpers_js.py
  Python 同步提示：无 API 变更；若 Python 侧自建 xpath enrich 可对齐碰撞才包 page-state。
```

- [ ] **Step 3: Spec + backlog status**
- [ ] **Step 4: Commit** (if user asks)

---

## Self-review (plan vs spec)

| Spec item | Task |
|-----------|------|
| pageStateOf order C (+ dialog/drawer) | 2 |
| Collision-only wrap | 3 |
| Priority titlebox/section > page-state > leaf | 3 (order after existing anchors) |
| No form_* force wrap | 3 |
| Record via buildLocatorSnap | 3 |
| Resolve via same snap | 4 verify |
| Wizard regression | 2–3 |
| Fail-soft / no `[n]` when anchor works | 3 |
| Char + CHANGELOG | 1, 4 |

No TBD. Offline enrich without DOM explicitly out of scope.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-11-page-state-gen-clickable-anchor.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)**  
2. **Inline Execution**  

Which approach?
