# Design: Strengthen assistant 3-round cascade fill

**Date:** 2026-08-12  
**Status:** Approved (user deferred to controller; approach B)

## Problem

`run_form_assistant` already has Round1 → rescan → Round2 → rescan → Round3, but logs (`Desktop/log.txt`) show:

1. Round2 only picks **brand-new labels** via `_scan_new_fields`.
2. Fields that were already pending but **left empty** in Round1 (dates, selects → `needs_agent`) are **not retried** in Round2/3.
3. Round3 often produces no log when `+0`, so failures look like “no third round”.
4. Cascade selects revealed in Round2 (e.g. 实际控制人*关系类型) were left for the agent; deeper fields never appear inside the assistant call.

Example from log: 法定代表人配偶证件* stayed in the post-assistant `fillable_pending=13` and were filled only later by the agent — they were not in Round2’s `+7` new list.

## Goal

Within a **single** `run_form_assistant` call, maximize fill of cascade/dependent fields in ≤3 rounds:

1. Round1: fill current pending (unchanged entry).
2. After each round: wait for Vue/loading, fullpage rescan.
3. Round2/3 worklist = **new empty fields** ∪ **still-empty fillable pending** (same region filter).
4. Always log Round2/3 scan sizes (including `+0`).
5. After LLM for a cascade round: if ordinary `select` still empty and has options, **code-fallback `first`** (aligns with maximize-assistant product direction). Do **not** auto-click introduce/disabled+button fields.

## Non-goals

- Fix 实际控制人「引入」magnifier / disabled identity fields (separate introduce path).
- Fix date display-vs-validation false failures (separate).
- Change agent step budget or require a second `run_form_assistant`.

## Success

- Characterization covers: empty pending retried on round2 worklist; always-log round3; select fallback when LLM skips.
- Re-test same form: fewer leftover ordinary selects/dates after assistant; Round2/3 logs visible even when empty.
