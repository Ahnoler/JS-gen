#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Strip leftover params.xpath_smart keys from trajectory steps (element is sole locator).

Historical steps may still carry a stale params.xpath_smart copy; replay and ops
tooling now ignore it. This script removes the key without copying element xpath
into params.

Usage (from repo root):
  set PYTHONPATH=.
  python scripts/characterization/repair-traj-params-xpath.py --traj 130
  python scripts/characterization/repair-traj-params-xpath.py --traj 130 --apply
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

FORM_ACTIONS = frozenset({
    "fill_form_field",
    "fill_date_field",
    "select_option",
    "click_radio",
})


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


def _parse_json(raw: Any) -> dict:
    if isinstance(raw, dict):
        return raw
    if not raw:
        return {}
    try:
        obj = json.loads(raw) if isinstance(raw, str) else raw
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}


def load_form_steps(traj_id: int, phase: int | None) -> list[dict[str, Any]]:
    import pymysql

    host = os.environ.get("DB_HOST", "127.0.0.1")
    port = int(os.environ.get("DB_PORT", "3306"))
    user = os.environ.get("DB_USER", "root")
    password = os.environ.get("DB_PASS", "")
    database = os.environ.get("DB_NAME", "js_gen")

    conn = pymysql.connect(
        host=host, port=port, user=user, password=password, database=database,
        charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor,
    )
    try:
        with conn.cursor() as cur:
            if phase is None:
                cur.execute(
                    """
                    SELECT id, step_number, action_type, params_json, element_json,
                           trajectory_phase_id
                    FROM trajectory_step
                    WHERE trajectory_id = %s
                    ORDER BY step_number ASC
                    """,
                    (traj_id,),
                )
            else:
                cur.execute(
                    """
                    SELECT s.id, s.step_number, s.action_type, s.params_json, s.element_json,
                           s.trajectory_phase_id
                    FROM trajectory_step s
                    JOIN trajectory_phase p ON p.id = s.trajectory_phase_id
                    WHERE s.trajectory_id = %s AND p.phase_number = %s
                    ORDER BY s.step_number ASC
                    """,
                    (traj_id, phase),
                )
            return list(cur.fetchall() or [])
    finally:
        conn.close()


def plan_repairs(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows:
        action = (row.get("action_type") or "").strip()
        if action not in FORM_ACTIONS:
            continue
        params = _parse_json(row.get("params_json"))
        if "xpath_smart" not in params:
            continue
        old_xp = str(params.get("xpath_smart") or "").strip()
        new_params = {k: v for k, v in params.items() if k != "xpath_smart"}
        out.append({
            "id": row["id"],
            "step_number": row.get("step_number"),
            "action": action,
            "label": params.get("label_text") or _parse_json(row.get("element_json")).get("formLabel") or "",
            "old": old_xp or "(empty)",
            "new": "(stripped)",
            "params": new_params,
        })
    return out


def apply_repairs(plans: list[dict[str, Any]]) -> int:
    import pymysql

    host = os.environ.get("DB_HOST", "127.0.0.1")
    port = int(os.environ.get("DB_PORT", "3306"))
    user = os.environ.get("DB_USER", "root")
    password = os.environ.get("DB_PASS", "")
    database = os.environ.get("DB_NAME", "js_gen")

    conn = pymysql.connect(
        host=host, port=port, user=user, password=password, database=database,
        charset="utf8mb4",
    )
    n = 0
    try:
        with conn.cursor() as cur:
            for p in plans:
                cur.execute(
                    "UPDATE trajectory_step SET params_json = %s WHERE id = %s",
                    (json.dumps(p["params"], ensure_ascii=False), p["id"]),
                )
                n += 1
        conn.commit()
    finally:
        conn.close()
    return n


def main() -> int:
    _load_env()
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--traj", type=int, required=True)
    ap.add_argument("--phase", type=int, default=None)
    ap.add_argument("--apply", action="store_true", help="Write updates (default dry-run)")
    args = ap.parse_args()

    rows = load_form_steps(args.traj, args.phase)
    plans = plan_repairs(rows)
    print(f"traj={args.traj} phase={args.phase} form_steps={len(rows)} repairs={len(plans)}")
    for p in plans:
        print(
            f"  step#{p['step_number']} id={p['id']} {p['action']} "
            f"label={p['label']!r}\n"
            f"    old: {p['old'][:120]}\n"
            f"    new: {p['new']}"
        )
    if not plans:
        print("nothing to repair")
        return 0
    if not args.apply:
        print("dry-run only — re-run with --apply to write")
        return 0
    n = apply_repairs(plans)
    print(f"applied={n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
