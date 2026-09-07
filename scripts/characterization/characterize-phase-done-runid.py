#!/usr/bin/env python3
"""Characterization: phase_done runId echo + cancel suppression (spec 4.3, offline text pins).

Run: ./python/python.exe scripts/characterization/characterize-phase-done-runid.py
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
SR = ROOT / "scripts" / "session_runner.py"
SVC = ROOT / "scripts" / "agent" / "service.py"
STATE = ROOT / "scripts" / "state.py"

sr = SR.read_text(encoding="utf-8")
svc = SVC.read_text(encoding="utf-8")
state_src = STATE.read_text(encoding="utf-8")


def check(cond: bool, msg: str) -> None:
    if not cond:
        print(f"FAIL {msg}")
        sys.exit(1)


# 1. main loop saves runId from step data
check("data.get(\"runId\")" in sr or "data.get('runId')" in sr, "main loop reads data.runId")
check("set_current_run_id" in sr, "session_runner sets current run id")

# 2. phase_done echoes runId
check("phase_done_data[\"runId\"]" in sr or "phase_done_data['runId']" in sr,
      "phase_done echoes runId")

# 3. canceled step flags phase_done (spec 4.3.2)
check("'canceled'" in sr, "phase_done carries canceled flag when cancel flag set")

# 4. phase_state_key echoes runId
check("afterKey" in sr and sr.count("\"runId\"") + sr.count("'runId'") >= 3,
      "phase_state_key/runId echo wired (>=3 runId refs in session_runner)")

# 5. new step while agent busy → force stop (spec 4.3.3)
check("new_step_arrived" in sr, "_stdin_reader force-stops on new step while agent busy")

# 6. probe log carries runId (spec 验收 5)
check("runId=" in sr, "[probe] emit phase_done log includes runId")

# 7. state module exposes run id holder
check("_CURRENT_RUN_ID" in state_src and "def set_current_run_id" in state_src,
      "state exposes _CURRENT_RUN_ID + set_current_run_id")
check("get_current_run_id" in svc, "service phase_error reads current run id")

print("PASS characterize-phase-done-runid")
