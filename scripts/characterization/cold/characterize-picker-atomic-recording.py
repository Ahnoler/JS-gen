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
    assert "不要调用 `picker_dialog_query` / `picker_dialog_select`" in COMMON_PROMPT
    assert '`fill_form_field`、`click_button("查询")`、`click_table_row_radio`、`click_button("确认")`' in FORM_PROMPT
    print("characterize-picker-atomic-recording: OK")


if __name__ == "__main__":
    main()
