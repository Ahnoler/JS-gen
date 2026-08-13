#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Wet CDP E2E: replay fill/select for traj phase via _replay (mutates page).

Usage:
  set PYTHONPATH=.
  python scripts/characterization/wet-traj-xpath-replay.py --traj 102 --phase 4 --cdp http://127.0.0.1:9242
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import importlib.util


def _load_audit_mod():
    path = ROOT / "scripts" / "characterization" / "audit-traj-xpath-dry.py"
    spec = importlib.util.spec_from_file_location("audit_traj_xpath_dry", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


class _PageCtx:
    def __init__(self, page):
        self._page = page

    async def get_current_page(self):
        return self._page


async def run_probes(page, sample_fill: dict, sample_select: dict) -> list[dict]:
    """Regression probes for the original false-ok / params-miss bugs."""
    from scripts.controller.actions._js_snippets import JS_FILL_BY_XPATH
    from scripts.controller.actions._replay import (
        _element_xpath_smart,
        _read_value_by_xpath,
        _replay_form_action,
        _resolve_replay_xpath,
    )

    out: list[dict] = []

    # --- Probe A: dead element xpath + label as placeholderHint must NOT ok-placeholder ---
    fill_params = sample_fill.get("params") or {}
    fill_entry = {"element": sample_fill.get("element") or {}, "params": fill_params}
    el_xp = _element_xpath_smart(fill_entry)
    label = str(fill_params.get("label_text") or "")
    value = str(fill_params.get("value") or "wet-probe")
    if el_xp and label:
        before = await _read_value_by_xpath(page, el_xp) if el_xp else ""
        raw = await page.evaluate(JS_FILL_BY_XPATH, [el_xp, value, label])
        after = await _read_value_by_xpath(page, el_xp) if el_xp else ""
        ok_placeholder = isinstance(raw, str) and "ok-placeholder" in raw
        out.append(
            {
                "probe": "A_dead_element_label_as_hint",
                "label": label,
                "element_xp": el_xp[:80],
                "js_result": raw,
                "before": before,
                "after": after,
                "pass": not ok_placeholder,
                "note": "must NOT return ok-placeholder on dead element+label hint",
            }
        )

    # --- Probe B: replay fill uses element locate + read-back ---
    if sample_fill:
        res = await _replay_form_action(page, "fill_form_field", fill_params, fill_entry)
        xp, src = _resolve_replay_xpath(fill_entry, fill_params)
        out.append(
            {
                "probe": "B_replay_fill_element",
                "label": label,
                "resolve_src": src,
                "result": res,
                "pass": isinstance(res, str)
                and res.startswith("ok")
                and (src == "element" or "locate=element" in res),
                "note": "fill must succeed via element xpath",
            }
        )

    # --- Probe C: replay select uses element xpath trigger ---
    sel_params = sample_select.get("params") or {}
    sel_entry = {"element": sample_select.get("element") or {}, "params": sel_params}
    sel_label = str(sel_params.get("label_text") or "")
    if sample_select:
        res = await _replay_form_action(page, "select_option", sel_params, sel_entry)
        xp, src = _resolve_replay_xpath(sel_entry, sel_params)
        out.append(
            {
                "probe": "C_replay_select_element",
                "label": sel_label,
                "resolve_src": src,
                "result": res,
                "pass": isinstance(res, str)
                and res.startswith("ok")
                and (
                    src == "element"
                    or "locate=element" in res
                    or "ok-already" in res
                ),
                "note": "select must succeed via element xpath trigger (or already matched)",
            }
        )

    return out


async def main_async(traj: int, phase: int | None, cdp: str, limit: int | None) -> int:
    from playwright.async_api import async_playwright
    from scripts.controller.actions._replay import replay_action_entries

    audit = _load_audit_mod()
    audit._load_env()
    entries = audit.load_steps(traj, phase)
    fill_select = [
        e
        for e in entries
        if str(e.get("action") or "") in ("fill_form_field", "select_option")
    ]
    if limit is not None:
        fill_select = fill_select[:limit]

    print(
        f"[wet] traj={traj} phase={phase} fill/select steps={len(fill_select)} cdp={cdp}",
        flush=True,
    )
    if not fill_select:
        print("[wet] ERROR: no fill/select steps", flush=True)
        return 2

    sample_fill = next((e for e in fill_select if e["action"] == "fill_form_field"), fill_select[0])
    sample_select = next(
        (e for e in fill_select if e["action"] == "select_option"), fill_select[0]
    )

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(cdp)
        page = await audit.pick_page(browser)
        if not page:
            print("[wet] ERROR: no page", flush=True)
            return 2
        print(f"[wet] url={page.url}", flush=True)

        print("\n=== probes ===", flush=True)
        probes = await run_probes(page, sample_fill, sample_select)
        for pr in probes:
            flag = "PASS" if pr.get("pass") else "FAIL"
            print(
                f"  [{flag}] {pr['probe']} label={pr.get('label')} → {pr.get('result') or pr.get('js_result')}",
                flush=True,
            )
            print(f"         note={pr.get('note')} src={pr.get('resolve_src')}", flush=True)

        print("\n=== wet replay fill/select ===", flush=True)

        def emit(msg):
            ev = msg.get("event")
            data = msg.get("data") or {}
            if ev == "replay_step":
                flag = "OK" if data.get("ok") else "FAIL"
                # entry params are not always in emit payload — pull from results later
                print(
                    f"  [{data.get('index')}/{data.get('total')}] {flag} "
                    f"{data.get('action')} id={data.get('id')} → {data.get('result')}",
                    flush=True,
                )

        # Slim entries for replay
        replay_entries = []
        for e in fill_select:
            replay_entries.append(
                {
                    "id": e.get("id"),
                    "action": e.get("action"),
                    "params": e.get("params") or {},
                    "element": e.get("element") or {},
                }
            )

        summary = await replay_action_entries(
            _PageCtx(page),
            replay_entries,
            controller_actions=None,
            case_data_store={},
            emit=emit,
            stop_on_fail=False,
        )

        ok = int(summary.get("ok") or 0)
        failed = int(summary.get("failed") or 0)
        count = int(summary.get("count") or 0)
        print("\n=== summary ===", flush=True)
        print(f"count={count} ok={ok} failed={failed}", flush=True)

        probe_fail = sum(1 for pr in probes if not pr.get("pass"))
        results = summary.get("results") or []
        locate_params = sum(
            1
            for r in results
            if isinstance(r.get("result"), str) and "locate=params" in r.get("result", "")
        )
        false_ok = sum(
            1
            for r in results
            if isinstance(r.get("result"), str) and str(r.get("result")).startswith("false_ok")
        )
        print(f"locate=params successes: {locate_params}", flush=True)
        print(f"false_ok count: {false_ok}", flush=True)
        print(f"probe failures: {probe_fail}", flush=True)

        # Dump JSON for inspection
        out_path = ROOT / ".superpowers" / "sdd" / "wet-traj102-phase4-results.json"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(
            json.dumps(
                {
                    "url": page.url,
                    "probes": probes,
                    "summary": {"count": count, "ok": ok, "failed": failed},
                    "locate_params": locate_params,
                    "false_ok": false_ok,
                    "results": results,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"[wet] wrote {out_path}", flush=True)

        if probe_fail or failed:
            return 1
        return 0


def main() -> int:
    audit = _load_audit_mod()
    audit._load_env()
    ap = argparse.ArgumentParser(description="Wet CDP replay for fill/select (mutates page)")
    ap.add_argument("--traj", type=int, default=102)
    ap.add_argument("--phase", type=int, default=4)
    ap.add_argument("--cdp", default="http://127.0.0.1:9242")
    ap.add_argument("--limit", type=int, default=None, help="optional cap on fill/select steps")
    args = ap.parse_args()
    try:
        return asyncio.run(main_async(args.traj, args.phase, args.cdp, args.limit))
    except Exception as e:
        print(f"[wet] ERROR: {e}", flush=True)
        import traceback

        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
