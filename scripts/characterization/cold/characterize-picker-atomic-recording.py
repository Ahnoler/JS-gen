"""Pin picker helpers to persist the concrete operations they perform."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
WORKSPACE = (ROOT / "scripts/controller/actions/_workspace.py").read_text(encoding="utf-8")
SNIPPET = (ROOT / "scripts/controller/actions/js_snippets/picker_confirm.py").read_text(encoding="utf-8")
COMMON_PROMPT = (ROOT / "scripts/prompts/agent-tools-common.md").read_text(encoding="utf-8")
FORM_PROMPT = (ROOT / "scripts/prompts/agent-tools-form.md").read_text(encoding="utf-8")


def main() -> None:
    assert "const recorded_actions = [];" in SNIPPET
    assert "action: 'fill_form_field'" in SNIPPET
    assert "action: 'click_table_row_radio'" in SNIPPET
    assert "recorded_actions: recorded_actions" in SNIPPET
    assert "def _record_picker_atomic_actions" in WORKSPACE
    assert "_record_picker_atomic_actions(atomic)" in WORKSPACE
    assert "_record_picker_atomic_actions(payload_dict.get('recorded_actions'))" in WORKSPACE
    assert "if not payload_dict.get('recorded_actions')" in WORKSPACE
    assert "LEGACY specialized picker helper" in WORKSPACE
    assert "按当前场景实际发生的有效操作逐步执行并记录" in COMMON_PROMPT
    assert "不要求固定四步" in FORM_PROMPT
    print("characterize-picker-atomic-recording: OK")


if __name__ == "__main__":
    main()
