#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Dry-run CDP audit: xpath hit counts + read-back for trajectory steps (no click/fill).

Usage (from repo root):
  set PYTHONPATH=.
  python scripts/characterization/audit-traj-xpath-dry.py --traj 102 --phase 4 --cdp http://127.0.0.1:9242

Page must already be on the target UI (rating page for traj 102 phase 4).
Does NOT mutate the DOM — evaluates xpath visibility and reads current values only.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _load_env() -> None:
    env_path = ROOT / "config" / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


_JS_COUNT_VISIBLE_XPATH = r'''([xpath]) => {
  if (!xpath) return 0;
  const isVis = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.offsetParent === null && !el.closest('.el-table__fixed')) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  };
  const wrapVisible = (d) => {
    if (!d) return false;
    const wrap = d.closest && d.closest('.el-dialog__wrapper, .el-message-box__wrapper, .el-drawer__wrapper');
    if (wrap && getComputedStyle(wrap).display === 'none') return false;
    return isVis(d) || (wrap && isVis(wrap));
  };
  const lastVisibleHost = (drawer) => {
    const sel = drawer ? '.el-drawer' : '.el-dialog, .el-message-box';
    const all = [...document.querySelectorAll(sel)];
    for (let i = all.length - 1; i >= 0; i--) {
      if (wrapVisible(all[i])) return all[i];
    }
    return null;
  };
  const countInCtx = (xp, root) => {
    let s = String(xp || '');
    if (!s) return 0;
    try {
      const ctx = root || document;
      if (root && s.startsWith('//')) s = '.' + s;
      const snap = document.evaluate(s, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      let n = 0;
      for (let i = 0; i < snap.snapshotLength; i++) {
        const node = snap.snapshotItem(i);
        if (node && isVis(node)) n++;
      }
      return n;
    } catch (e) {
      return 0;
    }
  };
  let total = countInCtx(xpath, null);
  if (total === 0 && /el-dialog|el-message-box|el-drawer/.test(xpath) && /\[last\(\)\]/.test(xpath)) {
    const m = String(xpath).match(/\[last\(\)\](?:\/\/(.+))?$/);
    const local = m && m[1] ? m[1] : '';
    const dlg = /el-drawer/.test(xpath) ? lastVisibleHost(true) : lastVisibleHost(false);
    if (dlg && local) total = countInCtx('.//' + local, dlg);
  }
  return total;
}'''

FILL_SELECT = frozenset({"fill_form_field", "select_option"})
BAD_OPTION_TEXT = frozenset({"first", "any", "random"})


def _short_xpath(xp: str, limit: int = 72) -> str:
    s = str(xp or "").strip()
    if len(s) <= limit:
        return s
    return s[: limit - 3] + "..."


def _snapshot_fields(params: dict) -> list:
    for key in ("fields", "scan_fields", "snapshot_fields"):
        val = params.get(key)
        if isinstance(val, list):
            return val
    snap = params.get("snapshot")
    if isinstance(snap, dict) and isinstance(snap.get("fields"), list):
        return snap["fields"]
    return []


def _expected_value(action: str, params: dict) -> str:
    if action == "fill_form_field":
        return str(params.get("value") or "").strip()
    if action == "select_option":
        return str(params.get("option_text") or params.get("value") or "").strip()
    return ""


def classify_dry(
    action: str,
    params: dict,
    element_xp: str,
    chosen_hit: int,
    expected: str,
    actual: str,
    norm_fn,
) -> tuple[str, str]:
    """Return (class, note) for dry-run matrix."""
    if action == "save_form_snapshot":
        if not _snapshot_fields(params):
            return "skip", "no fields in snapshot"
        return "report-only", "snapshot with fields"

    if action == "select_option":
        pick = str(params.get("option_text") or params.get("value") or "").strip()
        if pick.lower() in BAD_OPTION_TEXT:
            return "bad_option_text", f"option_text={pick}"

    if action not in FILL_SELECT:
        return "report-only", action

    if not element_xp:
        note = "no element.xpath_smart"
        if chosen_hit == 0:
            return "xpath_miss", note
        if expected:
            exp = norm_fn(expected)
            act = norm_fn(actual)
            if exp != act:
                return "value_mismatch", f"expected={expected},actual={actual}; {note}"
            return "element_absent", f"read-back ok; {note}"
        return "element_absent", note

    if chosen_hit == 0:
        return "xpath_miss", "chosen xpath visible hits = 0"

    if not expected:
        return "pass", "no expected value"

    exp = norm_fn(expected)
    act = norm_fn(actual)
    if exp == act:
        return "pass", f"read-back={actual}"
    return "value_mismatch", f"expected={expected},actual={actual}"


def load_steps(traj_id: int, phase: int | None) -> list[dict[str, Any]]:
    import pymysql

    host = os.environ.get("DB_HOST", "127.0.0.1")
    port = int(os.environ.get("DB_PORT", "3306"))
    user = os.environ.get("DB_USER", "root")
    password = os.environ.get("DB_PASS", "")
    database = os.environ.get("DB_NAME", "js_gen")

    conn = pymysql.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        database=database,
        charset="utf8mb4",
    )
    try:
        with conn.cursor() as cur:
            if phase is not None:
                cur.execute(
                    """
                    SELECT id, step_number, action_type, params_json, element_json
                    FROM trajectory_step
                    WHERE trajectory_id=%s AND phase_number=%s
                    ORDER BY step_number, action_index
                    """,
                    (traj_id, phase),
                )
            else:
                cur.execute(
                    """
                    SELECT id, step_number, action_type, params_json, element_json
                    FROM trajectory_step
                    WHERE trajectory_id=%s
                    ORDER BY step_number, action_index
                    """,
                    (traj_id,),
                )
            rows = cur.fetchall()
    finally:
        conn.close()

    entries: list[dict[str, Any]] = []
    for sid, step_number, action_type, params_json, element_json in rows:
        params = params_json if isinstance(params_json, dict) else json.loads(params_json or "{}")
        element = element_json if isinstance(element_json, dict) else json.loads(element_json or "{}")
        entries.append(
            {
                "id": sid,
                "step_number": step_number,
                "action": action_type,
                "params": params or {},
                "element": element or {},
            }
        )
    return entries


async def count_xpath_hits(page, xpath: str) -> int:
    if not xpath:
        return 0
    result = await page.evaluate(_JS_COUNT_VISIBLE_XPATH, [xpath])
    try:
        return int(result)
    except (TypeError, ValueError):
        return 0


async def pick_page(browser):
    for ctx in browser.contexts:
        for pg in ctx.pages:
            url = pg.url or ""
            if url.startswith("http") and "devtools" not in url:
                return pg
    if browser.contexts and browser.contexts[0].pages:
        return browser.contexts[0].pages[0]
    return None


async def audit_entries(page, entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    from scripts.controller.actions._replay import (
        _element_xpath_full,
        _element_xpath_smart,
        _norm_replay_value,
        _read_value_by_xpath,
        _resolve_replay_xpath,
    )

    rows: list[dict[str, Any]] = []
    for entry in entries:
        action = str(entry.get("action") or "")
        params = entry.get("params") if isinstance(entry.get("params"), dict) else {}
        element = entry.get("element") if isinstance(entry.get("element"), dict) else {}
        wrapped = {"element": element, "params": params}

        # Diagnostic only — params xpath not used for locate/readback.
        params_xp = str(params.get("xpath_smart") or "").strip()
        element_xp = _element_xpath_smart(wrapped)
        element_full_xp = _element_xpath_full(wrapped)
        chosen_xp, chosen_src = _resolve_replay_xpath(wrapped, params)

        params_hit = await count_xpath_hits(page, params_xp)
        element_hit = await count_xpath_hits(page, element_xp)
        element_full_hit = await count_xpath_hits(page, element_full_xp)
        chosen_hit = await count_xpath_hits(page, chosen_xp)

        read_xp = element_xp or chosen_xp
        actual = await _read_value_by_xpath(page, read_xp) if read_xp else ""
        expected = _expected_value(action, params)

        cls, note = classify_dry(
            action,
            params,
            element_xp,
            chosen_hit,
            expected,
            actual,
            _norm_replay_value,
        )

        row = {
            "id": entry.get("id"),
            "step": entry.get("step_number"),
            "action": action,
            "params_xs": _short_xpath(params_xp),
            "element_xs": _short_xpath(element_xp),
            "params_hit": params_hit,
            "element_hit": element_hit,
            "element_full_hit": element_full_hit,
            "chosen_source": chosen_src or "",
            "chosen_hit": chosen_hit,
            "expected": expected,
            "actual": actual,
            "class": cls,
            "note": note,
        }
        rows.append(row)
    return rows


def print_rows(rows: list[dict[str, Any]], jsonl: bool) -> None:
    if jsonl:
        for row in rows:
            print(json.dumps(row, ensure_ascii=False), flush=True)
        return

    header = (
        f"{'id':>6} {'step':>4} {'action':<22} "
        f"{'phit':>4} {'ehit':>4} {'src':<7} {'class':<16} note"
    )
    print(header, flush=True)
    print("-" * len(header), flush=True)
    for row in rows:
        print(
            f"{row['id']:>6} {row['step']:>4} {row['action']:<22} "
            f"{row['params_hit']:>4} {row['element_hit']:>4} "
            f"{row['chosen_source']:<7} {row['class']:<16} {row['note']}",
            flush=True,
        )


def print_summary(rows: list[dict[str, Any]], traj: int, phase: int | None, url: str) -> None:
    counts = Counter(row["class"] for row in rows)
    bad_first = [row["id"] for row in rows if row["class"] == "bad_option_text"]

    print("", flush=True)
    print(f"=== summary traj={traj} phase={phase or 'all'} url={url[:100]} ===", flush=True)
    print(f"total_steps={len(rows)}", flush=True)
    for cls in sorted(counts.keys()):
        print(f"  {cls}: {counts[cls]}", flush=True)
    if bad_first:
        print(f"bad_option_text ids: {bad_first}", flush=True)

    params_hit_element_miss = sum(
        1 for r in rows if r["params_hit"] > 0 and r["element_hit"] == 0
    )
    print(f"params_hit & element_miss rows: {params_hit_element_miss}", flush=True)


async def run_audit(traj: int, phase: int | None, cdp_url: str, jsonl: bool) -> int:
    from playwright.async_api import async_playwright

    entries = load_steps(traj, phase)
    print(f"[audit] loaded {len(entries)} steps for trajectory {traj}" + (
        f" phase {phase}" if phase is not None else ""
    ), flush=True)

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(cdp_url)
        page = await pick_page(browser)
        if not page:
            print("[audit] ERROR: no page found on CDP browser", flush=True)
            return 2

        url = page.url or ""
        print(f"[audit] connected CDP={cdp_url} url={url}", flush=True)

        rows = await audit_entries(page, entries)
        print_rows(rows, jsonl)
        print_summary(rows, traj, phase, url)
        return 0


def main() -> int:
    _load_env()
    ap = argparse.ArgumentParser(
        description="Dry-run xpath audit matrix via CDP (no click/fill/select)",
    )
    ap.add_argument("--traj", type=int, default=102, help="trajectory_id (default 102)")
    ap.add_argument("--phase", type=int, default=None, help="phase_number filter (e.g. 4)")
    ap.add_argument(
        "--cdp",
        default="http://127.0.0.1:9242",
        help="CDP endpoint (default http://127.0.0.1:9242)",
    )
    ap.add_argument("--jsonl", action="store_true", help="print one JSON object per step")
    args = ap.parse_args()

    try:
        return asyncio.run(run_audit(args.traj, args.phase, args.cdp, args.jsonl))
    except Exception as e:
        print(f"[audit] ERROR: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
