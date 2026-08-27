#!/usr/bin/env python3
"""Characterize 阶段内状态组截图 + 步骤绑定（跳转前采集保 elements/regionTree 同源）.

Source-assertion style (mirrors characterize-before-close-screenshots.py): pins the
phase-group shot wiring across migration, DAO/service, step DAO, Python state/controller/
session_runner and the recording runner. No browser / DB required.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def index_of(src: str, needle: str) -> int:
    idx = src.find(needle)
    assert_true(idx >= 0, f"missing: {needle!r}")
    return idx


def test_migration() -> None:
    src = read("migrations/20260828090000_phase_group_shot.js")
    for cue in ("phase_group", "state_group", "group_shot_id", "uk_ss_phase_group"):
        assert_true(cue in src, f"migration missing cue: {cue!r}")
    assert_true("export async function down" in src, "migration has down()")
    assert_true(
        "state_group" in src and "'done'" in src,
        "migration backfills phase_highlight rows to state_group='done'",
    )


def test_done_row_dedupe_key() -> None:
    # phase_highlight 的 done 行必须写入 state_group='done'，否则
    # uk_ss_phase_group (trajectory_phase_id, state_group) 对 NULL 不生效，
    # replaceForPhase 的 ON DUPLICATE KEY UPDATE 失去唯一键 → 每阶段累积多张。
    dao = read("src/dao/screenshot-dao.js")
    ph = dao.split("export async function replaceForPhase", 1)[1]
    assert_true(
        "'done'" in ph and "state_group" in ph,
        "replaceForPhase writes state_group='done'",
    )


def test_screenshot_dao() -> None:
    src = read("src/dao/screenshot-dao.js")
    for cue in ("replaceForPhaseGroup(", "findByPhaseAndStateGroup(", "listPhaseGroupsByTrajectory("):
        assert_true(cue in src, f"screenshot-dao missing: {cue!r}")


def test_screenshot_service() -> None:
    src = read("src/services/screenshot-service.js")
    for cue in ("replacePhaseGroupScreenshot", "findPhaseGroupByStateGroup", "listPhaseGroupsByTrajectory"):
        assert_true(cue in src, f"screenshot-service missing: {cue!r}")


def test_step_dao() -> None:
    src = read("src/dao/trajectory-step-dao.js")
    assert_true("updateGroupShotId" in src, "step dao missing updateGroupShotId")
    assert_true("whereNull('group_shot_id')" in src, "step dao guards no-overwrite (WHERE group_shot_id IS NULL)")


def test_state_py() -> None:
    src = read("scripts/state.py")
    for cue in ("phase_shot_candidate_request", "def resolve_phase_shot_result", "def request_phase_shot_candidate"):
        assert_true(cue in src, f"state.py missing: {cue!r}")


def test_controller_service() -> None:
    src = read("scripts/controller/service.py")
    for cue in ("phase_shot_candidate_request", "phase_state_key"):
        assert_true(cue in src, f"controller/service.py missing: {cue!r}")
    assert_true(
        index_of(src, "if action_name == 'click_save'")
        < index_of(src, "result = await func(*args, **kwargs)"),
        "click_save candidate branch must sit before func call",
    )


def test_session_runner() -> None:
    src = read("scripts/session_runner.py")
    for cue in ("phase_state_key", "phase_shot_candidate_result", "resolve_phase_shot_result"):
        assert_true(cue in src, f"session_runner.py missing: {cue!r}")


def test_recording_runner() -> None:
    src = read("src/services/trajectory/trajectory-recording-runner.js")
    for cue in (
        "phase_state_key", "phase_shot_candidate_request", "phase_shot_candidate_result",
        "capturePhaseBuffer", "updateGroupShotId", "pendingStepGroup",
    ):
        assert_true(cue in src, f"trajectory-recording-runner.js missing: {cue!r}")


def test_api_serializer() -> None:
    src = read("src/services/trajectory/trajectory-query-service.js")
    assert_true("groupShots" in src, "serializer missing groupShots")
    assert_true("groupShotId" in src, "serializer missing groupShotId")


def test_verify_all_registration() -> None:
    src = read("scripts/refactor/verify-all.sh")
    assert_true(
        "characterize-phase-group-shot" in src,
        "verify-all.sh registers characterize-phase-group-shot",
    )


def main() -> int:
    test_migration()
    test_done_row_dedupe_key()
    test_screenshot_dao()
    test_screenshot_service()
    test_step_dao()
    test_state_py()
    test_controller_service()
    test_session_runner()
    test_recording_runner()
    test_api_serializer()
    test_verify_all_registration()
    print("ok: characterization phase-group-shot")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
