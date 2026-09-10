"""Cold pin Phase B: replay select_option + legacy tssc_multi_select via SelectEngine.

Forbids direct JS_SELECT_OPTION / JS_TSSC_MULTI_SELECT evaluate on those branches.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def phase_b_select_option_uses_engine() -> bool:
    replay = (ROOT / "scripts/controller/actions/replay_form_action.py").read_text(
        encoding="utf-8"
    )
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


def phase_b_legacy_tssc_uses_engine() -> bool:
    replay = (ROOT / "scripts/controller/actions/replay_form_action.py").read_text(
        encoding="utf-8"
    )
    if "if action_name == 'tssc_multi_select':" not in replay:
        print("FAIL: missing legacy tssc_multi_select branch")
        return False
    body = replay.split("if action_name == 'tssc_multi_select':", 1)[1].split(
        "if action_name == 'click_radio':", 1
    )[0]
    if "select_option_for_replay" not in body and "SelectEngine" not in body:
        print("FAIL: legacy tssc_multi_select must call SelectEngine.select_option_for_replay")
        return False
    if "page.evaluate(JS_TSSC_MULTI_SELECT" in body:
        print("FAIL: legacy tssc_multi_select still evaluates JS_TSSC_MULTI_SELECT directly")
        return False
    return True


def main() -> int:
    ok = True
    if not phase_b_select_option_uses_engine():
        ok = False
    if not phase_b_legacy_tssc_uses_engine():
        ok = False
    if not ok:
        print("FAILED: characterize-select-replay-engine (Phase B red pin)")
        return 1
    print("ok: characterize-select-replay-engine")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
