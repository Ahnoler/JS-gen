# T5 前刀 — 信贷页漏扫差分 + 按差分修缺陷 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a信贷业务页, enumerate visible editable controls with Playwright MCP (or approved browser MCP stand-in), diff against project `scan_editable_summary` / Source A–C, then fix only the defects the diff proves.

**Architecture:** Two phases in one plan, hard gate between them. Phase 1 is evidence-only (MCP page inventory vs in-repo scan JS/behavior). Phase 2 implements the smallest scan/locate fix justified by `gap_class` (e.g. T5 custom-grid Source B **only if** `scan_miss` + non-`el-table`). No auto-fill; shell chrome stays out of inventory.

**Tech Stack:** Playwright MCP (preferred) or Cursor `cursor-ide-browser`; control plane + executor optional for live `scan_editable_summary`; `scripts/controller/actions/js_snippets/scan_form.py`; characterization scripts; spec Results table.

**Spec:** `docs/superpowers/specs/2026-08-10-t5-credit-scan-gap-design.md`

## Global Constraints

- Tooling: **Playwright MCP first**; if not connected in-session, stop and ask — or use `cursor-ide-browser` only after explicit user OK (already OK’d as fallback in brainstorm).
- Scope page: **one** 信贷业务页 (default 对公客户评级); shell 顶栏/侧栏 **不进**「应扫」集合.
- Taxonomy only: input / select / date / radio / checkbox / button / icon / tree.
- Phase 2 **must not start** until Results + Conclusion filled in the spec.
- TDD for any code change: characterization fail → fix → green.
- scripts-only changes: CHANGELOG optional; if touching `src/ctrl-actions/` write Unreleased + Python sync note.
- Do not commit unless user asks.

## File map

| File | Role |
|------|------|
| `docs/superpowers/specs/2026-08-10-t5-credit-scan-gap-design.md` | Method + Results + Conclusion |
| `tmp/t5-scan-baseline.json` (gitignored) | Raw `scan_editable_summary` / scan dump |
| `tmp/t5-mcp-inventory.json` (gitignored) | MCP-side inventory extract |
| `scripts/controller/actions/js_snippets/scan_form.py` | Phase 2 only — Source B / helpers if diff says so |
| `scripts/characterization/characterize-form-scan-control-first.py` | Phase 2 fail-first cues |
| `docs/superpowers/backlog-visible-editable-controls.md` | Update 推荐下一刀 after Conclusion |

---

### Task 1: Open 信贷页 + MCP inventory

**Files:**
- Create: `tmp/t5-mcp-inventory.json`
- Modify: `docs/superpowers/specs/2026-08-10-t5-credit-scan-gap-design.md` (Open before run checkboxes)

**Interfaces:**
- Consumes: user login / URL (default 对公评级业务页)
- Produces: MCP inventory list `{kind, name, container_hint, notes}[]`

- [ ] **Step 1: Confirm Playwright MCP**

If `GetMcpTools` / catalog has no Playwright MCP server: ask user to enable it **or** proceed with `cursor-ide-browser` (approved fallback). Do not use chrome-devtools.

- [ ] **Step 2: Navigate to 信贷页**

Open/reuse tab on the target credit URL. Confirm body shows business surface (forms / tables), not login-only.

- [ ] **Step 3: Enumerate visible editable controls**

Via MCP snapshot + evaluate/query as needed, collect taxonomy-matched visible controls. Exclude shell nav. Tag `container_hint`: `el-table` | `el-form` | `custom-grid?` | `other`.

- [ ] **Step 4: Persist inventory**

Write `tmp/t5-mcp-inventory.json`. Mark spec「Open before run」MCP checkbox done.

**Done when:** inventory file exists and has ≥1 business control (or blocked with written reason).

---

### Task 2: Project scan baseline + code对照

**Files:**
- Create: `tmp/t5-scan-baseline.json`
- Modify: spec Results (partial)
- Read: `scripts/controller/actions/js_snippets/scan_form.py` (`SCAN_SOURCE_B_EL_TABLE`, Source A/C markers)

**Interfaces:**
- Consumes: same page as Task 1; in-repo scan snippets
- Produces: baseline JSON + notes what code **can** see today

- [ ] **Step 1: Run project scan on same page**

Preferred: executor/session → `scan_editable_summary`. Fallback: `page.evaluate` of `JS_SCAN_FORM_FIELDS` / summary helper from repo. Save to `tmp/t5-scan-baseline.json`.

- [ ] **Step 2: Code对照 (static)**

From `scan_form.py`, list what Source B binds to (`.el-table` only today). Note absence of custom-grid selectors. Short bullet list in Results preamble.

- [ ] **Step 3: Build diff rows**

Join MCP inventory vs baseline labels/buttons. Fill Results table columns: `label/name | kind | in_scan | in_mcp | container_hint | gap_class`.

- [ ] **Step 4: Write Conclusion**

In spec: `Conclusion: open T5 impl | defer T5 | other (T1r/no_label/…)` with one-sentence why.

**Done when:** Results table + Conclusion non-TBD; backlog 推荐下一刀 sentence drafted (apply in Task 3 or 4).

**Gate:** If Conclusion = defer / no code → skip Task 3 code; only update backlog + stop.

---

### Task 3: Fix proven scan defects (conditional)

**Files:** (only paths justified by Conclusion — examples)
- Modify: `scripts/controller/actions/js_snippets/scan_form.py`
- Modify: `scripts/characterization/characterize-form-scan-control-first.py`
- Possibly: `scripts/controller/actions/js_snippets/misc.py` (verify Source B) if verify must match scan
- Modify: `docs/superpowers/backlog-visible-editable-controls.md`

**Interfaces:**
- Consumes: Conclusion + at least one concrete `scan_miss` example
- Produces: characterization green + same-page re-scan shows fewer `scan_miss` for that class

- [ ] **Step 1: Characterization fail-first**

Add cues for the **exact** defect class (e.g. new `SCAN_SOURCE_B_*` marker / selector family). Run → expect FAIL.

- [ ] **Step 2: Minimal implementation**

Smallest change so scan picks up the missed container/control kind. No auto-fill. No shell inclusion.

- [ ] **Step 3: Characterization PASS + page re-check**

Re-run char; re-run scan on same 信贷页; update Results with after counts.

- [ ] **Step 4: Backlog**

Mark T5 progress (P0 research done / impl started / deferred) and refresh 推荐下一刀.

**Done when:** Either code fixed + re-diff improved, or Task 3 skipped with Conclusion documented.

---

### Task 4: Spec close-out

**Files:**
- Modify: `docs/superpowers/specs/2026-08-10-t5-credit-scan-gap-design.md` (success criteria checkboxes)

- [ ] **Step 1: Tick success criteria** in spec  
- [ ] **Step 2: Summarize for user** — gap classes found, what was fixed, what remains  
- [ ] **Step 3: Commit only if user asks**

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-08-10-t5-credit-scan-gap.md`.

**After approval of this plan**, run with `superpowers:executing-plans` or `superpowers:subagent-driven-development`, starting at Task 1 (user must have 信贷页 reachable + Playwright MCP or browser MCP fallback).
