"""Pin fill_dispatch: shared fill attempt order for record + replay (unify spec A)."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]


def main() -> int:
    path = ROOT / "scripts/controller/actions/fill_dispatch.py"
    if not path.is_file():
        print("FAIL: missing fill_dispatch.py")
        return 1
    src = path.read_text(encoding="utf-8")
    for needle in (
        "class FillAttempt",
        "def resolve_fill_attempt_order",
        "xpath",
        "label",
        "placeholder",
        "xpath_full",
    ):
        if needle not in src:
            print(f"FAIL: fill_dispatch.py missing {needle!r}")
            return 1

    engines = ""
    for _fname in (
        "form_engine_base.py", "login_engine.py", "fill_engine.py",
        "select_engine.py", "radio_engine.py", "tree_engine.py",
        "form_action_engines.py",
    ):
        _fpath = ROOT / "scripts/controller/actions" / _fname
        if _fpath.exists():
            engines += _fpath.read_text(encoding="utf-8")
    replay = (ROOT / "scripts/controller/actions/replay_form_action.py").read_text(
        encoding="utf-8"
    )
    if "resolve_fill_attempt_order" not in engines:
        print("FAIL: form_action_engines.py must call resolve_fill_attempt_order")
        return 1

    # Phase B: replay routes through FillEngine; attempt order lives in engines.
    fill_body = replay.split("if action_name == 'fill_form_field':", 1)[1].split(
        "# Widget ops:", 1
    )[0]
    if "fill_form_field_for_replay" not in fill_body:
        print("FAIL: replay fill branch must call fill_form_field_for_replay")
        return 1

    sys.path.insert(0, str(ROOT))
    from scripts.controller.actions.fill_dispatch import resolve_fill_attempt_order

    attempts = resolve_fill_attempt_order(
        label="名称",
        placeholder="",
        xpath_smart="//div[@class='el-form-item'][1]//input",
        xpath_smart_src="element",
        xpath_full="/html/body/div[1]/input",
    )
    paths = [a.path for a in attempts]
    if paths[:2] != ["xpath", "label"]:
        print(f"FAIL: expected xpath then label first, got {paths!r}")
        return 1
    if "xpath_full" not in paths:
        print(f"FAIL: expected xpath_full in order, got {paths!r}")
        return 1

    print("ok: characterize-fill-dispatch")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
