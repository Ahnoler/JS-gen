#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P1 wet-run: fullpage scan + fillable filter on live CDP page.

Usage:
  set PYTHONPATH=.
  python scripts/characterization/wet-fullpage-p1-scan.py --cdp http://127.0.0.1:9242
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.controller.actions._js_snippets import JS_SCAN_FORM_FIELDS  # noqa: E402
from scripts.controller.actions.form_scan_utils import (  # noqa: E402
    build_editable_summary,
    filter_fillable_scan_fields,
    prepare_scan_fields_for_tasklist,
)
from scripts.controller.actions.form_rules import get_has_button_keywords  # noqa: E402


SHELL = frozenset({"shell-header", "shell-aside"})
NON_FILL = frozenset({"menu_item", "icon"})
TABLE_HINTS = ("评级等级测算", "业务往来及使用", "自主收入占比", "此次评级建议等级", "资产负债率")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cdp", default="http://127.0.0.1:9242")
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(args.cdp)
        pages = [pg for ctx in browser.contexts for pg in ctx.pages]
        if not pages:
            print("FAIL: no pages on CDP", file=sys.stderr)
            return 2
        page = pages[0]
        for pg in pages:
            if "cstmgrIttCpctRtg" in (pg.url or "") or "rtgMgt" in (pg.url or ""):
                page = pg
                break
        url = page.url
        title = page.title()
        print(f"URL={url}")
        print(f"TITLE={title}")

        raw = page.evaluate(
            JS_SCAN_FORM_FIELDS,
            [False, get_has_button_keywords(), {"mode": "fullpage"}],
        )
        result = json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(result, dict):
            print("FAIL: unexpected scan result type", type(result), file=sys.stderr)
            return 1

        fields = result.get("fields") or []
        buttons = result.get("buttons") or []
        regions = result.get("regions") or []
        fillable = filter_fillable_scan_fields(fields)
        prepared = prepare_scan_fields_for_tasklist(fields)
        summary = build_editable_summary(
            [result],
            primary_container=str(result.get("container") or "main"),
        )

        role_counts = Counter((f.get("region_role") or "?") for f in fields if isinstance(f, dict))
        kind_counts = Counter((f.get("kind") or "?") for f in fields if isinstance(f, dict))
        shell_fields = [
            f for f in fields
            if isinstance(f, dict)
            and ((f.get("region_role") or "") in SHELL or (f.get("kind") or "") in NON_FILL)
        ]
        shell_in_fillable = [
            f for f in fillable
            if isinstance(f, dict)
            and ((f.get("region_role") or "") in SHELL or (f.get("kind") or "") in NON_FILL)
        ]

        table_hits = []
        for hint in TABLE_HINTS:
            matches = [
                f for f in fields
                if isinstance(f, dict) and hint in (f.get("label") or "")
            ]
            table_hits.append({
                "hint": hint,
                "count": len(matches),
                "sample": [
                    {
                        "label": m.get("label"),
                        "kind": m.get("kind"),
                        "region_role": m.get("region_role"),
                        "xpath_smart": (m.get("xpath_smart") or "")[:120],
                        "in_fillable": m in fillable or any(
                            (x.get("label") == m.get("label") and x.get("xpath_smart") == m.get("xpath_smart"))
                            for x in fillable
                        ),
                    }
                    for m in matches[:3]
                ],
            })

        pending_items = summary.get("pending_items") or []
        pending_with_xp = sum(1 for i in pending_items if (i.get("xpath_smart") or "").strip())
        fillable_shell_labels = [
            f.get("label") for f in fillable
            if isinstance(f, dict) and (f.get("region_role") or "") in SHELL
        ]

        checks = {
            "not_login_page": "#/login" not in url,
            "has_fields": len(fields) > 0,
            "has_shell_in_inventory": len(shell_fields) > 0,
            "shell_excluded_from_fillable": len(shell_in_fillable) == 0 and len(fillable_shell_labels) == 0,
            "table_hint_present": any(h["count"] > 0 for h in table_hits),
            "items_with_xpath": (
                (pending_with_xp == len(pending_items) and len(pending_items) > 0)
                or any((f.get("xpath_smart") or "").strip() for f in fillable[:20])
            ),
            "prepared_len_le_raw": len(prepared) <= len(fields),
        }

        report = {
            "url": url,
            "title": title,
            "field_count": len(fields),
            "button_count": len(buttons),
            "region_count": len(regions),
            "fillable_count": len(fillable),
            "prepared_count": len(prepared),
            "role_counts": dict(role_counts),
            "kind_counts": dict(kind_counts),
            "shell_inventory_count": len(shell_fields),
            "shell_in_fillable_count": len(shell_in_fillable),
            "summary_pending": summary.get("pending"),
            "summary_pending_items": len(pending_items),
            "summary_pending_with_xpath": pending_with_xp,
            "summary_readonly_items": len(summary.get("readonly_items") or []),
            "summary_buttons": len(summary.get("buttons") or []),
            "table_hits": table_hits,
            "sample_shell": [
                {"label": f.get("label"), "kind": f.get("kind"), "region_role": f.get("region_role")}
                for f in shell_fields[:8]
            ],
            "sample_fillable": [
                {
                    "label": f.get("label"),
                    "kind": f.get("kind"),
                    "region_role": f.get("region_role"),
                    "xpath_smart": (f.get("xpath_smart") or "")[:100],
                }
                for f in fillable[:12]
            ],
            "checks": checks,
        }

        print(json.dumps(report, ensure_ascii=False, indent=2))
        ok = all(checks.values())
        print("RESULT:", "PASS" if ok else "FAIL")
        if not ok:
            bad = [k for k, v in checks.items() if not v]
            print("failed checks:", bad, file=sys.stderr)

        if args.out:
            Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
