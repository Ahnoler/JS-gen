"""Pin tssc_multi_select contract: v2 table markers, D6 select_option-only agent surface,
internal handoff + replay registries."""
import re
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
    el = "if (item.querySelector('.el-select')) return 'select'"
    i_m = src.find("tssc-multi-select")
    i_e = src.find(el)
    if i_m < 0 or i_e < 0 or i_m > i_e:
        print("FAIL: tssc-multi-select classify must appear before .el-select → select")
        return False
    return True


def no_agent_tssc_action():
    src = (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    if "async def tssc_multi_select" in src and "@controller.action" in src:
        if re.search(
            r"@controller\.action\([^)]*\)\s*\n\s*async def tssc_multi_select\b",
            src,
        ):
            print("FAIL: tssc_multi_select still registered as @controller.action")
            return False
    return True


def tssc_records_select_option():
    src = (ROOT / "scripts/controller/actions/form_action_engines.py").read_text(
        encoding="utf-8"
    )
    m = re.search(
        r"async def tssc_multi_select\b.*?(?=\n    async def |\nclass |\Z)",
        src,
        re.DOTALL,
    )
    if not m:
        print("FAIL: tssc_multi_select method not found in form_action_engines.py")
        return False
    body = m.group(0)
    if re.search(r"_record_action\s*\(\s*['\"]tssc_multi_select['\"]", body):
        print("FAIL: tssc_multi_select still records action name tssc_multi_select")
        return False
    if not re.search(r"_record_action\s*\(\s*['\"]select_option['\"]", body):
        print("FAIL: tssc_multi_select must _record_action('select_option', ...)")
        return False
    return True


def prompt_d6_form():
    form = (ROOT / "scripts/prompts/agent-tools-form.md").read_text(encoding="utf-8")
    if "select_option" not in form:
        print("FAIL: form prompt must teach select_option for tssc (D6)")
        return False
    if "tssc-multi-select" not in form and ".tssc-multi-select" not in form:
        print("FAIL: form prompt must mention tssc-multi-select / .tssc-multi-select (D6)")
        return False
    if "tssc_multi_select(label_text" in form or "须用 **`tssc_multi_select`**" in form:
        print("FAIL: form prompt still steers agents to call tssc_multi_select (D6)")
        return False
    return True


def prompt_d6_pack():
    pack = ROOT / "scripts/prompts/agent-tools-tssc-multi-select.md"
    agent_utils = (ROOT / "scripts/agent_utils.py").read_text(encoding="utf-8")
    if "agent-tools-tssc-multi-select.md" in agent_utils:
        print("FAIL: agent_utils still injects agent-tools-tssc-multi-select.md (D6)")
        return False
    if pack.is_file():
        pack_src = pack.read_text(encoding="utf-8")
        if "tssc_multi_select(label_text" in pack_src:
            print(
                "FAIL: agent-tools-tssc-multi-select.md still teaches "
                "tssc_multi_select(label_text call shape (D6)"
            )
            return False
    agent_prompt = (ROOT / "scripts/prompts/agent-prompt.md").read_text(encoding="utf-8")
    if "agent-tools-tssc-multi-select.md" in agent_prompt:
        print("FAIL: agent-prompt.md still includes dedicated tssc pack (D6)")
        return False
    return True


checks = [
    ("scripts/controller/actions/js_snippets/tssc_multi_select.py", (
        "JS_TSSC_MULTI_SELECT",
        "ok-p1:",
        "ok-p2:",
        "err-no-options",
        "精确",
        "select-table",
        "el-select-dropdown__item",
    )),
    ("scripts/controller/actions/_js_snippets.py", ("tssc_multi_select", "JS_TSSC_MULTI_SELECT")),
    ("scripts/models/field.py", (
        '"tssc-multi-select"',
        "FieldKind",
        "ScannedField",
    )),
    ("scripts/controller/actions/form_action_engines.py", (
        "async def tssc_multi_select",
        "form_tssc_multi_select",
        "JS_TSSC_MULTI_SELECT",
        "lookup_field_kind(self.business_data_store, label_text) == 'tssc-multi-select'",
        "return await self.tssc_multi_select(",
        "lookup_field_kind",
        "tssc-multi-select",
        "err-use-tssc-multi-select",
        "Do NOT fill_form_field",
        "resolve_recorded_option_text",
    )),
    ("scripts/models/action.py", ("tssc_multi_select",)),
    ("scripts/event_dispatch.py", ("tssc_multi_select",)),
    ("scripts/state.py", ("tssc_multi_select",)),
    ("src/models/action-name.js", ("tssc_multi_select",)),
    ("src/cdp/page-locator-helpers.js", ("form_tssc_multi_select", ".tssc-multi-select")),
    ("src/services/legacy-engine-export.js", (
        "tssc_multi_select: 'select:click'",
    )),
    ("scripts/controller/actions/result_protocol.py", (
        '"tssc-multi-select"',
        "tssc_multi_select(label_text",
        "fi.querySelector('.tssc-multi-select')",
    )),
    ("scripts/controller/actions/_llm_values.py", (
        "kind == 'tssc-multi-select'",
        "'action': 'tssc_multi_select'",
    )),
    ("scripts/controller/actions/autofill_round.py", (
        "elif is_tssc:",
        "field_kind not in (",
        "'tssc-multi-select'",
    )),
]

ok = all(needle(path, *texts) for path, texts in checks)
ok = ok and classify_before_el_select()
ok = ok and no_agent_tssc_action()
ok = ok and tssc_records_select_option()
ok = ok and prompt_d6_form()
ok = ok and prompt_d6_pack()

# Runtime pin: ScannedField must accept DOM kind tssc-multi-select (traj 696 crash).
try:
    sys.path.insert(0, str(ROOT))
    from scripts.models.field import ScannedField

    ScannedField(label="要素名称", kind="tssc-multi-select", currentValue="")
except Exception as e:
    print("FAIL: ScannedField rejects kind=tssc-multi-select: %s" % e)
    ok = False

if not ok:
    print("FAILED: characterize-tssc-multi-select")
    sys.exit(1)
print("ok: characterize-tssc-multi-select")
