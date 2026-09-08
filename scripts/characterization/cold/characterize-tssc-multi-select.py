"""Pin tssc_multi_select contract: snippet markers, classify-before-el-select,
registration, prompt pack, action registries."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def needle(path, *texts):
    full = ROOT / path
    if not full.is_file():
        print("MISSING %s :: %r" % (path, texts[0]))
        return False
    src = full.read_text(encoding="utf-8")
    for t in texts:
        if t not in src:
            print("MISSING %s :: %r" % (path, t))
            return False
    return True


def classify_before_el_select():
    src = (ROOT / "scripts/controller/actions/js_snippets/scan_utils.py").read_text(
        encoding="utf-8"
    )
    marker = "tssc-multi-select"
    el = "if (item.querySelector('.el-select')) return 'select'"
    i_m = src.find("tssc-multi-select")
    i_e = src.find(el)
    if i_m < 0 or i_e < 0 or i_m > i_e:
        print("FAIL: tssc-multi-select classify must appear before .el-select → select")
        return False
    return True


checks = [
    ("scripts/controller/actions/js_snippets/tssc_multi_select.py", (
        "JS_TSSC_MULTI_SELECT",
        "no-tssc-multi-select",
        "err-no-echo",
        "ok-already",
        "TsscMultiSelect",
        ".tssc-multi-select",
        ".select-table",
        "el-table__row",
    )),
    ("scripts/controller/actions/_js_snippets.py", ("tssc_multi_select", "JS_TSSC_MULTI_SELECT")),
    ("scripts/controller/actions/_form.py", (
        "tssc_multi_select(label_text, option_text",
        "tssc_multi_select",
    )),
    ("scripts/controller/actions/form_action_engines.py", (
        "async def tssc_multi_select",
        "form_tssc_multi_select",
        "JS_TSSC_MULTI_SELECT",
    )),
    ("scripts/prompts/agent-tools-tssc-multi-select.md", (
        "tssc_multi_select(label_text, option_text)",
        "no-tssc-multi-select",
        "err-no-echo",
        "TsscMultiSelect",
    )),
    ("scripts/prompts/agent-prompt.md", ("agent-tools-tssc-multi-select.md",)),
    ("scripts/agent_utils.py", ("agent-tools-tssc-multi-select.md",)),
    ("scripts/models/action.py", ("tssc_multi_select",)),
    ("scripts/event_dispatch.py", ("tssc_multi_select",)),
    ("scripts/state.py", ("tssc_multi_select",)),
    ("src/models/action-name.js", ("tssc_multi_select",)),
    ("src/cdp/page-locator-helpers.js", ("form_tssc_multi_select", ".tssc-multi-select")),
]

ok = all(needle(path, *texts) for path, texts in checks) and classify_before_el_select()
# form.md must NOT still tell agents to use select_option for TsscMultiSelect table rows
form = (ROOT / "scripts/prompts/agent-tools-form.md").read_text(encoding="utf-8")
if "必须用 select_option" in form and "TsscMultiSelect" in form:
    print("FAIL: form prompt still steers TsscMultiSelect to select_option")
    ok = False
pack = ROOT / "scripts/prompts/agent-tools-tssc-multi-select.md"
if "tssc_multi_select" not in form and pack.is_file() and "TsscMultiSelect" in pack.read_text(
    encoding="utf-8"
):
    pass  # dedicated pack is enough; form must not contradict
bad = "远程表格型下拉（弹层内 `el-table` 行" in form and "只能用 `select_option`" in form
if bad:
    print("FAIL: stale select_option table-row guidance in form.md")
    ok = False
if not ok:
    print("FAILED: characterize-tssc-multi-select")
    sys.exit(1)
print("ok: characterize-tssc-multi-select")
