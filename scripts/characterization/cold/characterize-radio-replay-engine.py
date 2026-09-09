"""Cold pin Phase B: replay click_radio must route through RadioEngine (not direct JS).

Not in verify-all until Task 4. Expected RED until Tasks 2–3 wire engine replay mode.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def phase_b_replay_uses_radio_engine() -> bool:
    replay = (ROOT / "scripts/controller/actions/replay_form_action.py").read_text(
        encoding="utf-8"
    )
    if "if action_name == 'click_radio':" not in replay:
        print("FAIL: missing click_radio branch")
        return False
    body = replay.split("if action_name == 'click_radio':", 1)[1].split(
        "if action_name == 'select_option':", 1
    )[0]
    if (
        "click_radio_for_replay" not in body
        and "mode='replay'" not in body
        and 'mode="replay"' not in body
    ):
        print("FAIL: click_radio replay must call RadioEngine replay entry")
        return False
    if "page.evaluate(JS_CLICK_RADIO" in body:
        print("FAIL: replay click_radio still evaluates JS_CLICK_RADIO* directly")
        return False
    engines = (ROOT / "scripts/controller/actions/form_action_engines.py").read_text(
        encoding="utf-8"
    )
    if "click_radio_for_replay" not in engines:
        print("FAIL: RadioEngine missing click_radio_for_replay")
        return False
    if "class RadioEngine" not in engines:
        print("FAIL: missing RadioEngine")
        return False
    # mode=replay must appear in RadioEngine.click_radio signature or body
    radio_src = engines.split("class RadioEngine", 1)[1].split("class TreeEngine", 1)[0]
    if 'mode="replay"' not in radio_src and "mode='replay'" not in radio_src and "mode == \"replay\"" not in radio_src and "mode == 'replay'" not in radio_src:
        if "mode: str" not in radio_src and 'mode="' not in radio_src and "mode='" not in radio_src:
            print("FAIL: RadioEngine.click_radio missing mode parameter")
            return False
    if "JS_CLICK_RADIO_BY_XPATH" not in radio_src:
        print("FAIL: RadioEngine must use JS_CLICK_RADIO_BY_XPATH")
        return False
    # Label fallback: bare JS_CLICK_RADIO evaluate (not only BY_XPATH)
    if "page.evaluate(JS_CLICK_RADIO," not in radio_src.replace("JS_CLICK_RADIO_BY_XPATH", "X"):
        # After stripping BY_XPATH name, still need evaluate(JS_CLICK_RADIO,
        stripped = radio_src.replace("JS_CLICK_RADIO_BY_XPATH", "XPATH_CONST")
        if "page.evaluate(JS_CLICK_RADIO," not in stripped:
            print("FAIL: RadioEngine must fall back to label JS_CLICK_RADIO")
            return False
    return True


def main() -> int:
    if not phase_b_replay_uses_radio_engine():
        print("FAILED: characterize-radio-replay-engine (Phase B red pin)")
        return 1
    print("ok: characterize-radio-replay-engine")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
