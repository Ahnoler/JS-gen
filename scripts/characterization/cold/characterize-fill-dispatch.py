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

    # Placeholder-only search: label_text == placeholder — must still expose a
    # by_xpath placeholder attempt (empty xpath) so replay can fill without a
    # real el-form-item label after a bad invented xpath miss.
    search_atts = resolve_fill_attempt_order(
        label="搜索关键字",
        placeholder="搜索关键字",
        xpath_smart=(
            "//div[contains(@class,'el-form-item')]"
            "[.//label[normalize-space(.)='搜索关键字']]//input"
        ),
        xpath_smart_src="element",
        xpath_full="",
    )
    search_paths = [a.path for a in search_atts]
    if "xpath" not in search_paths or "label" not in search_paths:
        print(f"FAIL: search attempts need xpath+label, got {search_paths!r}")
        return 1
    ph_by_xpath = [
        a for a in search_atts
        if a.path == "placeholder" and a.js_kind == "by_xpath" and not (a.xpath or "").strip()
    ]
    if not ph_by_xpath:
        print(
            "FAIL: when label==placeholder must include empty-xpath placeholder by_xpath attempt, "
            f"got {[(a.path, a.js_kind, a.xpath) for a in search_atts]!r}"
        )
        return 1

    fill_src = (ROOT / "scripts/controller/actions/fill_engine.py").read_text(encoding="utf-8")
    replay_impl = fill_src.split("async def _fill_form_field_replay_impl", 1)[1].split(
        "async def check_field_value", 1
    )[0]
    try_chunk = replay_impl.split("async def _try_xpath_fill", 1)[1].split(
        "result = 'label-not-found'", 1
    )[0]
    # Soft miss: strict-locator-not-found must return None (fall through), not return guard_err.
    guard_block = try_chunk.split("if guard_err", 1)
    if len(guard_block) < 2:
        print("FAIL: _try_xpath_fill missing guard_err branch")
        return 1
    guard_body = guard_block[1].split("result = await page.evaluate", 1)[0]
    if "strict-locator-not-found" not in guard_body or "return None" not in guard_body:
        print(
            "FAIL: _try_xpath_fill must soft-continue on strict-locator-not-found "
            "(check prefix → return None), not hard-return guard_err"
        )
        return 1

    print("ok: characterize-fill-dispatch")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
