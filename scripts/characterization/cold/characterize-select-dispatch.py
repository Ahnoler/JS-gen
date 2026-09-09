"""Pin select_dispatch: shared router for record + replay (unify spec A)."""
import asyncio
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]


def main() -> int:
    dispatch = ROOT / "scripts/controller/actions/select_dispatch.py"
    if not dispatch.is_file():
        print("FAIL: missing select_dispatch.py")
        return 1
    src = dispatch.read_text(encoding="utf-8")
    for needle in (
        "class SelectDispatch",
        "def resolve_select_dispatch",
        'path',
        "tssc",
        "el-select",
        "tree",
        "target_kind",
        "form_tssc_multi_select",
        "tssc-multi-select",
        "reason",
    ):
        if needle not in src:
            print(f"FAIL: select_dispatch.py missing {needle!r}")
            return 1

    engines = (ROOT / "scripts/controller/actions/form_action_engines.py").read_text(
        encoding="utf-8"
    )
    replay = (ROOT / "scripts/controller/actions/replay_form_action.py").read_text(
        encoding="utf-8"
    )
    if "resolve_select_dispatch" not in engines:
        print("FAIL: form_action_engines.py must call resolve_select_dispatch")
        return 1
    if "resolve_select_dispatch" not in replay:
        print("FAIL: replay_form_action.py must call resolve_select_dispatch")
        return 1
    # Hotfix inline probe must be absorbed (no third copy of live tssc detect).
    if "_is_live_tssc_field" in replay:
        print("FAIL: replay still has _is_live_tssc_field; use select_dispatch live probe")
        return 1
    if "querySelector('.tssc-multi-select')" in replay and "select_dispatch" not in replay:
        # allow import-only; fail if raw probe JS still embedded
        if "([lab]) =>" in replay and "tssc-multi-select" in replay:
            print("FAIL: replay still embeds inline tssc live-probe JS")
            return 1

    # Pure API smoke (import)
    sys.path.insert(0, str(ROOT))
    from scripts.controller.actions.select_dispatch import resolve_select_dispatch

    d = asyncio.run(resolve_select_dispatch(
        label="要素名称",
        element={"target_kind": "form_tssc_multi_select"},
        field_kind=None,
        page=None,
    ))
    if d.path != "tssc":
        print(f"FAIL: expected path=tssc got {d.path!r} reason={d.reason!r}")
        return 1
    d2 = asyncio.run(resolve_select_dispatch(
        label="x", element={"target_kind": "form_select"}, field_kind="select", page=None
    ))
    if d2.path != "el-select":
        print(f"FAIL: expected el-select got {d2.path!r}")
        return 1
    d3 = asyncio.run(resolve_select_dispatch(
        label="x", element=None, field_kind="tssc-multi-select", page=None
    ))
    if d3.path != "tssc":
        print(f"FAIL: field_kind tssc-multi-select → tssc, got {d3.path!r}")
        return 1
    print("ok: characterize-select-dispatch")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
