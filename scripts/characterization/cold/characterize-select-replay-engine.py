"""Cold pin Phase B: replay select_option must route through SelectEngine (not direct JS).

Not in verify-all until Task 9. Expected RED until Tasks 7–8 wire engine replay mode.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def phase_b_replay_uses_engine() -> bool:
    replay = (ROOT / "scripts/controller/actions/replay_form_action.py").read_text(
        encoding="utf-8"
    )
    # Inside select_option branch (split like other pins)
    body = replay.split("if action_name == 'select_option':", 1)[1].split(
        "return f'unknown-form-action", 1
    )[0]
    if (
        "select_option_for_replay" not in body
        and "mode='replay'" not in body
        and 'mode="replay"' not in body
    ):
        print("FAIL: select_option replay must call SelectEngine replay entry")
        return False
    # Main path must not evaluate JS_SELECT_OPTION / JS_TSSC directly
    if "page.evaluate(JS_SELECT_OPTION" in body or "page.evaluate(JS_TSSC_MULTI_SELECT" in body:
        print("FAIL: replay select_option still evaluates JS_* directly")
        return False
    engines = (ROOT / "scripts/controller/actions/form_action_engines.py").read_text(
        encoding="utf-8"
    )
    if "mode" not in engines or "replay" not in engines:
        print("FAIL: SelectEngine missing replay mode")
        return False
    return True


def main() -> int:
    if not phase_b_replay_uses_engine():
        print("FAILED: characterize-select-replay-engine (Phase B red pin)")
        return 1
    print("ok: characterize-select-replay-engine")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
