"""Cold pin Phase B: replay fill_form_field must route through FillEngine (not direct JS).

Not in verify-all until Task 9. Expected RED until Tasks 7–8 wire engine replay mode.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def phase_b_replay_uses_fill_engine() -> bool:
    replay = (ROOT / "scripts/controller/actions/replay_form_action.py").read_text(
        encoding="utf-8"
    )
    body = replay.split("if action_name == 'fill_form_field':", 1)[1].split(
        "# Widget ops:", 1
    )[0]
    if (
        "fill_form_field_for_replay" not in body
        and "mode='replay'" not in body
        and 'mode="replay"' not in body
    ):
        print("FAIL: fill_form_field replay must call FillEngine replay entry")
        return False
    if "page.evaluate(JS_FILL_FORM_FIELD" in body or "page.evaluate(JS_FILL_BY_XPATH" in body:
        print("FAIL: replay fill still evaluates JS_FILL_* directly")
        return False
    engines = ""
    for _fname in (
        "form_engine_base.py", "login_engine.py", "fill_engine.py",
        "select_engine.py", "radio_engine.py", "tree_engine.py",
        "form_action_engines.py",
    ):
        _fpath = ROOT / "scripts/controller/actions" / _fname
        if _fpath.exists():
            engines += _fpath.read_text(encoding="utf-8")
    if "fill_form_field_for_replay" not in engines and (
        "mode" not in engines or "replay" not in engines
    ):
        print("FAIL: FillEngine missing replay mode / for_replay")
        return False
    return True


def main() -> int:
    if not phase_b_replay_uses_fill_engine():
        print("FAILED: characterize-fill-replay-engine (Phase B red pin)")
        return 1
    print("ok: characterize-fill-replay-engine")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
