# Collision-Driven Finer L1 (titlebox) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When ambiguous resolve matches share the same `region_id`, regenerate finer `region_*` from TSSC `titlebox` / `span.title` and try panel-anchored `xpath_smart`, so picker rows for「新增」are distinguishable.

**Architecture:** Keep P0 `assignRegion` as first pass. On the **page-side** resolve expression, collect DOM hosts before snapping; group by `(needle, region_id)`; colliding groups call `findTitleboxRegion` + optional `titleboxAnchorXPath`; then `snap` with region override. Algorithm B: failed refine never drops a host. Vue unchanged (already shows `region_label`).

**Tech Stack:** `src/cdp/page-locator-helpers.js` (PAGE_LOCATOR_HELPERS), `src/cdp/resolve-by-label.js`, sync `scripts/controller/actions/js_snippets/_locator_helpers_js.py`, characterization `.mjs`, optional headed CDP `:9242`.

**Spec:** `docs/superpowers/specs/2026-08-10-resolve-collision-finer-l1-titlebox-design.md`

## Global Constraints

- Algorithm **B**: finer L1 failure must not drop matches from `matches[]`.
- Playwright locate = relative `xpath_smart` only; never `(…)[n]` when a section/titlebox anchor exists but uniqueness failed.
- Collision key = `(needle, region_id)` with group size ≥ 2.
- P0 finer cue = `.titlebox` / `span.title` (nearest); reject action-only titles（新增/修改/查看/删除/保存）and title===needle.
- Prefer `region_role: 'section'`, `region_id: 'section:<title>'`, `region_label: <title>`.
- Scan fullpage refine is **out of P0** (resolve ambiguous path only).
- No L1c LLM in this cut.
- TDD: characterization fail → implement → green.
- Commit only if user asks.
- Executor must reload helpers for BiB wet verify (ops note).

## File map

| File | Role |
|------|------|
| `src/cdp/page-locator-helpers.js` | `findTitleboxRegion`, `titleboxAnchorXPath`, `refineCollidingRegions`; `buildLocatorSnap` region override + titlebox xpath try |
| `src/cdp/resolve-by-label.js` | Multi-host collect → refine → snap; marker `COLLISION_REFINE` |
| `scripts/controller/actions/js_snippets/_locator_helpers_js.py` | Regenerate/sync from helpers |
| `scripts/characterization/characterize-resolve-collision-titlebox.mjs` | New char |
| Spec status line | Approved → Implemented when green |

```text
hosts[] (same needle)
  → assignRegion each
  → group by region_id; size≥2 → findTitleboxRegion → new region_*
  → snap(host, regionOverride) + titleboxAnchorXPath if verifiable
  → ambiguous matches with distinct region_label
```

---

### Task 1: Characterization — collision refine cues

**Files:**
- Create: `scripts/characterization/characterize-resolve-collision-titlebox.mjs`
- Test: same

**Interfaces:**
- Consumes: source of `page-locator-helpers.js`, `resolve-by-label.js`, `buildResolveExpression`
- Produces: RED until Tasks 2–3 land

- [ ] **Step 1: Write failing characterization**

```js
/**
 * Characterize collision-driven titlebox L1 refine for ambiguous resolve.
 *   node scripts/characterization/characterize-resolve-collision-titlebox.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildResolveExpression } from '../../src/cdp/resolve-by-label.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const helpers = readFileSync(join(root, 'src/cdp/page-locator-helpers.js'), 'utf8');
const resolveSrc = readFileSync(join(root, 'src/cdp/resolve-by-label.js'), 'utf8');

function ok(n) { console.log(`ok: ${n}`); }

{
  assert.match(helpers, /COLLISION_REFINE|SHARED_COLLISION_REFINE/);
  assert.match(helpers, /function findTitleboxRegion\s*\(/);
  assert.match(helpers, /function titleboxAnchorXPath\s*\(/);
  assert.match(helpers, /function refineCollidingRegions\s*\(/);
  assert.match(helpers, /\.titlebox/);
  assert.match(helpers, /span\.title|querySelector\(['\"]span\.title/);
  ok('helpers: collision refine + titlebox APIs');
}

{
  assert.match(helpers, /regionOverride|region_override|opts\.region/);
  ok('helpers: buildLocatorSnap accepts region override');
}

{
  assert.match(resolveSrc, /COLLISION_REFINE|refineCollidingRegions/);
  assert.match(resolveSrc, /findTitleboxRegion|refineColliding/);
  ok('resolve: wires collision refine');
}

{
  const expr = buildResolveExpression({
    labelText: '新增',
    actionType: 'click_element_by_index',
    params: { text: '新增', index: -1 },
  });
  assert.match(expr, /refineCollidingRegions|findTitleboxRegion/);
  assert.match(expr, /titlebox/);
  ok('expression injects collision refine');
}

console.log('characterize-resolve-collision-titlebox: ok');
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node scripts/characterization/characterize-resolve-collision-titlebox.mjs
```

Expected: FAIL missing `findTitleboxRegion` / `COLLISION_REFINE`.

- [ ] **Step 3: Do not commit** unless user asks.

---

### Task 2: Helpers — titlebox find + anchor + refineCollidingRegions

**Files:**
- Modify: `src/cdp/page-locator-helpers.js` (near `SHARED_ASSIGN_REGION` / `buildLocatorSnap`)
- Modify: `scripts/controller/actions/js_snippets/_locator_helpers_js.py` (sync via existing regen script if present, else copy)

**Interfaces:**
- Produces (page-side):
  - `findTitleboxRegion(host, needle) → { region_role, region_id, region_label, title } | null`
  - `titleboxAnchorXPath(host, title, leafLocal) → string`
  - `refineCollidingRegions(items, needle) → void`  
    where `items[i] = { el, region }` and `region` may be replaced in place
- Consumes: `assignRegion`, `evalXpathAll`, `xpathLiteral`, `normalizeControlText` / existing text helpers

- [ ] **Step 1: Add marker + title hygiene + findTitleboxRegion**

Place after `assignRegion`, before `sectionAnchorXPath`:

```js
    /* SHARED_COLLISION_REFINE — titlebox finer L1 on region_id collision */
    function isActionOnlyTitle(t) {
      const s = String(t || '').replace(/\\s+/g, ' ').trim();
      if (!s) return true;
      return /^(新增|修改|查看|删除|保存|\\+\\s*新增)$/.test(s);
    }
    function titleboxTitleText(box) {
      if (!box) return '';
      const span = box.querySelector && box.querySelector('span.title');
      let raw = '';
      if (span) raw = span.innerText || span.textContent || '';
      else raw = box.innerText || box.textContent || '';
      return String(raw).replace(/\\s+/g, ' ').trim().slice(0, 40);
    }
    function findTitleboxRegion(host, needle) {
      if (!host || !host.closest) return null;
      const want = String(needle || '').replace(/\\s+/g, ' ').trim();
      let n = host;
      for (let d = 0; d < 14 && n; d++) {
        const box = (n.classList && n.classList.contains('titlebox')) ? n
          : (n.querySelector && n.querySelector(':scope > .titlebox, :scope > * > .titlebox'));
        // Prefer closest ancestor titlebox
        const anc = n.closest && n.closest('.titlebox');
        const cand = anc || (n.classList && n.classList.contains('titlebox') ? n : null);
        if (cand) {
          const title = titleboxTitleText(cand);
          if (title && !isActionOnlyTitle(title) && title !== want) {
            return {
              region_role: 'section',
              region_id: 'section:' + title,
              region_label: title,
              title: title,
            };
          }
        }
        n = n.parentElement;
      }
      return null;
    }
    function titleboxAnchorXPath(host, title, leafLocal) {
      const leaf = String(leafLocal || '').replace(/^\\/+/, '');
      const t = String(title || '').replace(/\\s+/g, ' ').trim();
      if (!host || !leaf || !t) return '';
      const lit = xpathLiteral(t);
      // Panel: titlebox with title text, then leaf under an ancestor that contains both
      return "//div[contains(concat(' ',normalize-space(@class),' '),' titlebox ')]"
        + "[.//*[contains(concat(' ',normalize-space(@class),' '),' title ') and normalize-space()=" + lit + "]"
        + " or normalize-space()=" + lit + "]"
        + "/ancestor::*[.//" + leaf + "][1]//" + leaf;
    }
    function refineCollidingRegions(items, needle) {
      if (!items || items.length < 2) return;
      const byId = {};
      for (let i = 0; i < items.length; i++) {
        const id = String((items[i].region && items[i].region.region_id) || 'other');
        if (!byId[id]) byId[id] = [];
        byId[id].push(i);
      }
      const ids = Object.keys(byId);
      for (let k = 0; k < ids.length; k++) {
        const idxs = byId[ids[k]];
        if (idxs.length < 2) continue;
        for (let j = 0; j < idxs.length; j++) {
          const it = items[idxs[j]];
          const finer = findTitleboxRegion(it.el, needle);
          if (finer) it.region = finer;
          // else keep coarse — algorithm B
        }
      }
    }
```

**Note:** Keep `findTitleboxRegion` walk simple and correct: use `host.closest('.titlebox')` first; if null, walk parents and look for previous-sibling `.titlebox` in the same `el-row` / column (live page: titlebox is sibling structure inside `el-row`). Adjust implementation to match live DOM from debug:

- Button is under `el-row` that **contains** `.titlebox` as a descendant (often earlier sibling subtree). Prefer: from host, `closest('.el-row, .el-col')` then `querySelector('.titlebox')` walking upward until a container’s titlebox title is found and the container also contains host.

Replace the walk body with this proven shape if `closest('.titlebox')` is null:

```js
      let n = host;
      for (let d = 0; d < 14 && n; d++) {
        if (n.querySelector) {
          const boxes = n.querySelectorAll('.titlebox');
          for (let bi = 0; bi < boxes.length; bi++) {
            const box = boxes[bi];
            if (!n.contains(host)) continue;
            // titlebox should be "above" host in tree sense: host not inside titlebox
            if (box.contains(host)) continue;
            const title = titleboxTitleText(box);
            if (title && !isActionOnlyTitle(title) && title !== want) {
              return {
                region_role: 'section',
                region_id: 'section:' + title,
                region_label: title,
                title: title,
              };
            }
          }
        }
        n = n.parentElement;
      }
```

Pick the **nearest** container (smallest depth) that yields a title — stop at first successful level when walking from host upward.

- [ ] **Step 2: `buildLocatorSnap` region override + titlebox xpath**

At start of snap body (after host resolved):

```js
      const region = (opts && opts.region && opts.region.region_id)
        ? opts.region
        : assignRegion(host);
```

When computing smart xpath, **after** existing section-anchor attempt (or when `opts.region && opts.region.title` / region came from titlebox), also try:

```js
      if ((!verified || (nodesMulti)) && region && region.title) {
        const tbXp = titleboxAnchorXPath(host, region.title, leafForAnchor || localLeaf);
        if (tbXp) {
          const tnodes = evalXpathAll(tbXp);
          let tidx = -1;
          for (let i = 0; i < tnodes.length; i++) {
            if (tnodes[i] === host) { tidx = i; break; }
          }
          if (tnodes.length === 1 && tidx === 0) {
            smart = tbXp;
            occurrence = 0;
            verified = true;
          }
        }
      }
```

Ensure return still uses `region.region_role/id/label`. Pass `title` on region object from `findTitleboxRegion`.

Also: do not clear smart with global `[n]` when titlebox region exists but anchor failed (extend the existing “no `[n]` when sectionAnchorOf” guard to also apply when `opts.region && opts.region.title`).

- [ ] **Step 3: Sync `_locator_helpers_js.py`**

Run existing generator if available:

```bash
node scripts/controller/actions/js_snippets/_gen_locator_helpers_py.mjs
```

(or whatever path the repo uses — search for `_gen_locator_helpers`). Else manually ensure Python mirror contains the new functions.

- [ ] **Step 4: Re-run Task 1 char — helpers asserts should pass; resolve wire may still fail**

```bash
node scripts/characterization/characterize-resolve-collision-titlebox.mjs
```

- [ ] **Step 5: Do not commit** unless user asks.

---

### Task 3: Wire resolve-by-label — collect → refine → snap

**Files:**
- Modify: `src/cdp/resolve-by-label.js` (`buildResolveExpression` string: `snap` signature + multi-host click/generic paths)

**Interfaces:**
- Consumes: `refineCollidingRegions`, `assignRegion`, `buildLocatorSnap(..., { region })`
- Produces: ambiguous snaps with refined `region_label` when titlebox exists

- [ ] **Step 1: Extend `snap` to accept optional region**

```js
    function snap(el, matchedLabel, asFormField, kindHint, regionOverride) {
      const abs = xpathOf(el);
      const rawText = cleanVisibleText(el);
      const formLabel = asFormField ? matchedLabel : '';
      const loc = buildLocatorSnap(el, rawText, abs, formLabel, {
        targetKind: kindHint || undefined,
        region: regionOverride || undefined,
      });
      // ... same return including region_* from loc
    }
```

- [ ] **Step 2: Add helper inside expression**

```js
    /* COLLISION_REFINE */
    function pushHostsRefined(hostList, matchedLabel, asForm, kind) {
      const items = [];
      const seenAbs = {};
      for (let i = 0; i < hostList.length; i++) {
        const host = hostList[i];
        if (!host || !isVisible(host)) continue;
        const root = normalizeTargetRoot(host) || host;
        const abs = absXPath(root);
        if (seenAbs[abs]) continue;
        seenAbs[abs] = true;
        items.push({ el: root, region: assignRegion(root) });
      }
      refineCollidingRegions(items, matchedLabel || needle);
      for (let j = 0; j < items.length; j++) {
        const it = items[j];
        if (out.some((x) => x.xpath_abs === absXPath(it.el))) continue;
        out.push(snap(it.el, matchedLabel || needle, asForm, kind, it.region));
      }
    }
```

- [ ] **Step 3: Use on multi-match click paths**

For `click_element_by_index` / menu / generic clickables branches that currently loop `pushUnique`:

1. First push matching elements into a local `hostList` (exact preferred over fuzzy, same as today).  
2. Call `pushHostsRefined(hostList, name, false, kind)` instead of per-el `pushUnique` when `hostList.length >= 1`.  
3. Keep force-snap invisible exact path: either include those els in hostList without `isVisible` gate inside refine list, or call refine only on visible list then force-snap leftovers — preserve existing collapsed-menu behavior.

Minimal change: only switch to `pushHostsRefined` when `hostList.length >= 2`; single host keeps `pushUnique` (no refine needed).

- [ ] **Step 4: Run chars — expect full PASS**

```bash
node scripts/characterization/characterize-resolve-collision-titlebox.mjs
node scripts/characterization/characterize-resolve-ambiguous-region.mjs
node scripts/characterization/characterize-resolve-element-auto-grab.mjs
```

Expected: all exit 0.

- [ ] **Step 5: Optional wet CDP** (if `:9242` on crtCpctInf-like page)

```bash
node -e "/* or small script */ resolve 新增; print region_labels; expect ≥2 distinct titlebox titles"
```

Do not navigate; reuse browser. If page wrong, note SKIP in report.

- [ ] **Step 6: Do not commit** unless user asks.

---

### Task 4: Spec status

**Files:**
- Modify: `docs/superpowers/specs/2026-08-10-resolve-collision-finer-l1-titlebox-design.md`

- [ ] **Step 1:** Set status to `Approved + Implemented YYYY-MM-DD` with verification table (chars / CDP wet / BiB deferred).  
- [ ] **Step 2:** Do not claim BiB PASS without executor restart evidence.  
- [ ] **Step 3:** Do not commit unless user asks.

---

## Spec coverage (self-review)

| Spec | Task |
|------|------|
| Collision key `(N, region_id)` size≥2 | 2 `refineCollidingRegions` |
| titlebox / span.title finer L1 | 2 `findTitleboxRegion` |
| Title hygiene action words | 2 `isActionOnlyTitle` |
| Panel-anchored xpath + verify | 2–3 `titleboxAnchorXPath` + snap |
| No drop on failed refine | 2–3 |
| Resolve ambiguous path only (scan later) | 3 |
| Vue unchanged | — |
| Characterization markers | 1 |
| Algorithm B / no global `[n]` | 2 guard |

## Placeholder scan

No TBD. Live DOM walk note included for implementer. Commit deferred to user ask.

## Type consistency

- Region fields: `region_role`, `region_id`, `region_label`, optional `title` on override object.  
- Markers: `SHARED_COLLISION_REFINE`, `COLLISION_REFINE`.
