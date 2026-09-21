# Resolve Placeholder-Only Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (or executing-plans). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `resolve-element` inventory + needle `fill_form_field` find bare placeholder inputs (e.g. sidebar「搜索关键字」) that are not inside `.el-form-item`.

**Architecture:** Extend `collectL2Hosts` in `src/cdp/page-locator-helpers.js` to admit visible standalone `input`/`textarea` with non-empty placeholder (excluding those already covered by form-item / select / date / pagination / popover). Extend needle `fill_form_field` in `src/cdp/resolve-by-label.js` to fall back to placeholder matching when no `.el-form-item` hit. Keep locator-builders placeholder xpath path unchanged. After helpers change, regenerate `scripts/controller/actions/js_snippets/_locator_helpers_js.py` via the existing gen script.

**Tech Stack:** Node CDP helpers, Playwright optional cold eval, characterization cold pins.

## Global Constraints

- Do **not** commit (repo AGENTS.md: subagents never commit; controller commits after review).
- Disjoint files from WIP: do not edit `classify.py`, unrelated plans, `.cursor/`.
- Do not hand-edit `_locator_helpers_js.py` — only via `node scripts/_gen_locator_helpers_py.mjs`.
- TDD: failing pin before production edits.
- Do not invent form-item+label xpath for placeholder-only controls (existing heal in locator-builders).
- Behavior when `USE_EXECUTOR=true` unchanged except matching more hosts.

---

### Task 1: Failing cold pin for placeholder-only resolve

**Files:**
- Create: `scripts/characterization/cold/characterize-resolve-placeholder-search.mjs`
- Modify (pin only): `scripts/refactor/verify-all.sh` — add one `run` line after `characterize-resolve-inventory` or `characterize-executor-only-bib`

- [ ] Pin asserts `page-locator-helpers.js` `collectL2Hosts` selector/list includes a path for non-`.el-form-item` inputs (marker comments or selector tokens such as bare `input:not([type="hidden"])` **outside** the form-item-only list — pin the intended post-fix shape so it fails today).
- [ ] Pin asserts `resolve-by-label.js` needle `fill_form_field` block contains a placeholder fallback after the `.el-form-item` loop (e.g. query inputs by placeholder / `placeholderLabel`) — must fail on current code.
- [ ] Optionally: if cheap, evaluate `buildResolveExpression` inventory+needle against a tiny HTML fixture via Playwright chromium (reuse patterns from other cold e2e); skip if env has no browser — source pins are sufficient DoD for Task 1.
- [ ] Run pin → confirm RED.
- [ ] Do not implement production fix in this task.
- [ ] Write report to workspace; **do not commit**.

### Task 2: Inventory — collect bare placeholder inputs

**Files:**
- Modify: `src/cdp/page-locator-helpers.js` (`collectL2Hosts` / related helpers only)
- Run: `node scripts/_gen_locator_helpers_py.mjs` (if helpers body is copied into generated py)
- Modify: Task 1 pin only if needed to stay green

- [ ] After existing form-item/menu/tree collection (or as additional selectors), collect visible `input:not([type="hidden"]), textarea` that:
  - have non-empty `placeholder`
  - are **not** inside `.el-form-item`
  - are **not** inside `.el-select`, `.el-date-editor`, `.el-pagination`, `.el-popover`, `.tree-popover`
  - classify as `form_input` via existing `classifyOperable` / `detectTargetKind` when possible
  - `inventoryTextOf` already falls back to placeholder for `form_*` — ensure bare hosts get `kind=form_input` and text=placeholder
- [ ] Dedup via existing `seen` WeakSet / abs xpath path.
- [ ] Re-run Task 1 pin → inventory assertions GREEN (needle may still RED until Task 3).
- [ ] If gen script touches py, include generated file in the working tree for controller commit.
- [ ] **Do not commit.**

### Task 3: Needle — placeholder fallback for fill_form_field

**Files:**
- Modify: `src/cdp/resolve-by-label.js` only (needle `fill_form_field` / `select_option` early return block)

- [ ] After `.el-form-item` label matching yields empty `out`, before `return out`, search visible inputs/textareas whose placeholder (strip `请输入` / trailing colon) exact/fuzzy matches `needle`.
- [ ] Push with `asForm=true`, kind `form_input` (or date/select if closest matches those — prefer input-only for this task).
- [ ] Do not change menu/click paths.
- [ ] Re-run Task 1 pin → all GREEN.
- [ ] Re-run `node scripts/characterization/cold/characterize-resolve-inventory.mjs` → still OK.
- [ ] **Do not commit.**

### Task 4: Closeout docs + controller commit prep

**Files:**
- Modify: `docs/superpowers/todo-list.md` — mark `resolve-placeholder-search` closed
- Modify: `docs/superpowers/agent-log.md` — 收工 entry (controller may refine)
- Confirm verify-all line present

- [ ] Docs only + verify pins listed in report.
- [ ] **Do not commit** — controller commits after final review.
