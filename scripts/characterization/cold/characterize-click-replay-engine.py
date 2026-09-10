"""Cold pin Phase B: replay click_element_by_index + click_button via ClickEngine.

Not in verify-all until Task 5. Expected RED until Tasks 2–3 wire engine replay.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def _replay_src() -> str:
    return (ROOT / "scripts/controller/actions/_replay.py").read_text(encoding="utf-8")


def _engine_src() -> str:
    path = ROOT / "scripts/controller/actions/click_action_engine.py"
    if not path.is_file():
        return ""
    return path.read_text(encoding="utf-8")


def phase_b_index_uses_engine() -> bool:
    replay = _replay_src()
    # Index branch near _CLICK_BY_INDEX / click_element_by_index
    if "click_element_by_index_for_replay" not in replay and "ClickEngine" not in replay:
        print("FAIL: _replay.py must reference ClickEngine / for_replay for index")
        return False
    # Heuristic: the dedicated index arm must not be the only call site pattern
    # `result = await _replay_click_by_index(page, entry, params)` without engine.
    # Allow _replay_click_by_index elsewhere (menu/close Out).
    marker = "elif action_name == _CLICK_BY_INDEX:"
    if marker not in replay:
        # alternate spelling
        marker = "action_name == _CLICK_BY_INDEX"
    if marker in replay:
        arm = replay.split(marker, 1)[1].split("elif action_name", 1)[0].split("else:", 1)[0]
        if "click_element_by_index_for_replay" not in arm and "ClickEngine" not in arm:
            print("FAIL: click_element_by_index branch must call ClickEngine for_replay")
            return False
        if "await _replay_click_by_index(page, entry, params)" in arm:
            print("FAIL: index branch still calls _replay_click_by_index directly")
            return False
    return True


def phase_b_button_uses_engine() -> bool:
    replay = _replay_src()
    # Inside close-group helper: click_button kernel
    if "click_button_for_replay" not in replay and (
        "ClickEngine" not in replay or "click_button" not in replay
    ):
        # Require explicit for_replay symbol for button
        if "click_button_for_replay" not in replay:
            print("FAIL: _replay.py must call click_button_for_replay for click_button")
            return False
    # When mapping click_button text, subsequent durable call must be engine
    close_fn = ""
    if "async def _replay_close_dialog_idempotent" in replay:
        close_fn = replay.split("async def _replay_close_dialog_idempotent", 1)[1]
        close_fn = close_fn.split("\nasync def ", 1)[0]
    else:
        print("FAIL: missing _replay_close_dialog_idempotent")
        return False
    if "click_button_for_replay" not in close_fn:
        print("FAIL: close-group must call click_button_for_replay")
        return False
    eng = _engine_src()
    if not eng:
        print("FAIL: missing click_action_engine.py")
        return False
    if "class ClickEngine" not in eng:
        print("FAIL: missing ClickEngine")
        return False
    if "click_element_by_index_for_replay" not in eng or "click_button_for_replay" not in eng:
        print("FAIL: ClickEngine missing for_replay entrypoints")
        return False
    if "_JS_CLICK_DURABLE" not in eng and "_replay_click_by_index" not in eng:
        print("FAIL: ClickEngine must own durable path (direct or via _replay_click_by_index)")
        return False
    return True


def main() -> int:
    ok = True
    if not phase_b_index_uses_engine():
        ok = False
    if not phase_b_button_uses_engine():
        ok = False
    if not ok:
        print("FAILED: characterize-click-replay-engine (Phase B red pin)")
        return 1
    print("ok: characterize-click-replay-engine")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
