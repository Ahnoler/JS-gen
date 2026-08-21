"""
Form-related actions: registration shell (scan, fill, select, save, task list).

动作实现已按 form-actions-split 拆出：login/fill/radio/tree/select 引擎在
`form_action_engines.py`、click_save 在 `form_save.py`、scan/task-list 动作在
`form_scan_actions.py`、auto-fill 在 `form_autofill.py`/`autofill_*.py`。
本文件只保留 `_register_form_actions` 注册胶水 + 薄委托（save_form_snapshot /
task_done 本就是 form_scan_utils 薄壳）。
"""

from ._helpers import _ok
from ._js_snippets import JS_IDENTIFY_CONTAINER
from ...models import TaskList
from .form_rules import get_has_button_keywords
from .form_scan_utils import _save_form_snapshot, _task_done_impl

# 兼容 re-export（form-actions-split）：外部/characterization 仍从 _form 导入这些
# form_scan_utils 符号；canonical 位置是 form_scan_utils，勿再新增。
from .form_scan_utils import (  # noqa: F401
    ResolvedControl,
    _build_section_summary,
    _dedupe_needs_agent,
    _is_query_mode,
    _is_search_dialog,
    _query_not_form_payload,
    _resolve_control,
    _skip_auto_fill,
    _submit_ready_hint,
    _with_submit_cue,
)

from .form_autofill import FormAutofillEngine
from .form_action_engines import (
    FillEngine, LoginEngine, RadioEngine, SelectEngine, TreeEngine,
)
from .form_save import SaveEngine
from .form_scan_actions import (
    scan_form_fields_impl, scan_editable_summary_impl, run_form_assistant_impl,
    scan_visible_fields_impl, init_task_list_impl, get_pending_tasks_impl,
    scroll_to_first_error_impl, sync_tasks_from_errors_impl,
)


def _register_form_actions(controller, browser_context, case_data_store, llm=None):
    # Lazily read hasButton keywords — supports runtime override via case_data_store
    def _button_keywords():
        return get_has_button_keywords(case_data_store)

    engine = FormAutofillEngine(browser_context, case_data_store, llm, _button_keywords)
    _ensure_scanned = engine.ensure_scanned
    _login_engine = LoginEngine(browser_context, case_data_store, engine)
    _fill_engine = FillEngine(browser_context, case_data_store, engine, _button_keywords)
    _select_engine = SelectEngine(browser_context, case_data_store, engine)
    _radio_engine = RadioEngine(browser_context, case_data_store, engine)
    _tree_engine = TreeEngine(browser_context, case_data_store, engine)
    _save_engine = SaveEngine(browser_context, case_data_store, engine, _button_keywords)

    @controller.action('Expand ALL el-tree nodes recursively (up to 10 rounds).')
    async def expand_all_el_tree():
        return await _tree_engine.expand_all_el_tree()

    @controller.action('Login to the system. Fills username + password (+ optional captcha/sms), clicks login button, waits for navigation. Use this instead of manually filling login fields one by one.')
    async def login(username: str, password: str, captcha: str = '', sms_code: str = ''):
        return await _login_engine.login(username, password, captcha, sms_code)

    @controller.action('Get a value for a form field by its label using form rules. For 证件号码, reads 证件类型 from the page and generates the matching format (身份证 → ID card, 统一社会信用代码/营业执照 → credit code). Prefers case_data_store presets when present.')
    async def match_form_rule(label_text: str):
        return await _fill_engine.match_form_rule(label_text)

    @controller.action('Fill a form field using Element UI native DOM setter. Works for text inputs AND date pickers (commits Vue v-model, including TsscMultiDatePicker).')
    async def fill_form_field(label_text: str, value: str, xpath_smart: str = ""):
        return await _fill_engine.fill_form_field(label_text, value, xpath_smart)

    @controller.action('Check the current value of a single form field by its label. Returns JSON with label/kind/currentValue/placeholder/disabled/selected/required. Use this to verify a field was filled correctly by checking currentValue.')
    async def check_field_value(label_text: str):
        return await _fill_engine.check_field_value(label_text)

    @controller.action('Verify that a form field has an expected value. Calls check_field_value and compares currentValue with expected. Returns ok if match, err if mismatch. Use this to confirm a field was filled correctly.')
    async def verify_field_value(label_text: str, expected: str):
        return await _fill_engine.verify_field_value(label_text, expected)

    @controller.action('Full scan: ALL form fields in the current dialog/drawer regardless of visibility. Builds task list + form snapshot only — does NOT auto-fill (use run_form_assistant for batch auto-fill). Returns summary {total, filled, pending, ...}.')
    async def scan_form_fields():
        return await scan_form_fields_impl(browser_context, case_data_store, _button_keywords)

    @controller.action(
        'Read-only summary of visible classified operable controls (quick full-page scan). '
        'Returns {container, scope, total, filled, pending, pending_labels, pending_items'
        '[{label, xpath_smart, kind, section}], readonly_labels, readonly_items[…], '
        'sections, buttons[{text, region_label, section, xpath_smart}], regions?}. '
        'Use xpath_smart from pending_items/buttons on fill/select/click — do not re-scan for locator. '
        'readonly_items = disabled known-kind fields for reference (do not fill). '
        'Includes shell nav when present. Does NOT build task_list, auto-fill, or run form assistant.'
    )
    async def scan_editable_summary():
        return await scan_editable_summary_impl(browser_context, case_data_store, _button_keywords)

    @controller.action(
        'Batch-scan and auto-fill editable form fields in the current container. '
        'Call only when the phase contract allows form assistant (create / full modify). '
        'Do not use on navigate/query phases.'
    )
    async def run_form_assistant(section: str = '', region: str = ''):
        return await run_form_assistant_impl(browser_context, case_data_store, _ensure_scanned, section, region)

    @controller.action('Visible scan: only visible form fields (offsetParent !== null). Use this for ALL subsequent checks — much smaller output, saves context. Excludes fields already filled by auto-fill. Returns {fields: [...], notification: {visible, text}|null}.')
    async def scan_visible_fields():
        return await scan_visible_fields_impl(browser_context, case_data_store, _button_keywords)

    @controller.action('Rebuild the task list from scan results (utility — does not auto-fill).')
    async def init_task_list(fields_json: str):
        return init_task_list_impl(case_data_store, fields_json)

    @controller.action('Save form structure snapshot for replay validation. Call after init_task_list. Records per-field metadata (label + is_required) with separate required/optional counts so assembled scripts can grade changes by severity.')
    async def save_form_snapshot():
        page = await browser_context.get_current_page()
        container_id = await page.evaluate(JS_IDENTIFY_CONTAINER)
        from scripts.controller.actions.container_naming import resolve_display_container
        container_id = resolve_display_container(container_id, case_data_store)
        fields = case_data_store.get('_scan_fields', [])

        snap = _save_form_snapshot(container_id, fields, case_data_store)
        return _ok(f'form-snapshot | container:{container_id} | count:{snap.count}')

    @controller.action('Mark a form field as completed in the task list. Use this after successfully filling a field.')
    async def task_done(label_text: str):
        _task_done_impl(label_text, case_data_store)
        tl = TaskList.from_store(case_data_store.get('task_list'))
        return _ok(f'task-done:{label_text} | remaining:{len(tl.pending)}')

    @controller.action('Get the current pending task list. Returns {"pending": [...], NEXT_ACTION}. When pending is empty, NEXT_ACTION tells you to click 保存 — do not re-fill fields.')
    async def get_pending_tasks(section: str = '', region: str = ''):
        return get_pending_tasks_impl(case_data_store, section, region)

    @controller.action(
        'Find the 保存/提交/确认/确定 button, scroll it into view, click it, wait for loading, '
        'then scan the whole page for .el-form-item__error and success/error notifications. '
        'Prefer this over scroll_down + click_element_by_index for form submit (including '
        'maintain/edit dialog 确认). '
        'Optional region= scopes to a collapse/tab/card / L1 block when multiple同名按钮 exist '
        '(section= is a deprecated alias). '
        'Returns ok-save-success when 操作成功 toast appears, ok-save-navigation when URL changes, '
        'or ok-save-no-feedback when the click completes with no toast/error/navigation '
        '(silent save — still success). On validation errors returns err-save-validation.'
    )
    async def click_save(button_text: str = '保存', section: str = '', region: str = ''):
        return await _save_engine.click_save(button_text, section, region)

    @controller.action('Scroll to the first visible form validation error (.el-form-item.is-error or .el-form-item__error). Returns {label, error} so agent knows which field to fix next. Call after a failed submit or when form errors are visible.')
    async def scroll_to_first_error():
        return await scroll_to_first_error_impl(browser_context)

    @controller.action('Sync task list from current page validation errors. Reads .el-form-item__error text, extracts field labels (strips 请选择/请输入/请上传 prefix), re-adds them to pending. Also scrolls to first error. Call this after a failed submit attempt.')
    async def sync_tasks_from_errors():
        return await sync_tasks_from_errors_impl(browser_context, case_data_store)

    @controller.action('Select an option in an el-select dropdown by label and option text.')
    async def select_option(label_text: str, option_text: str, xpath_smart: str = ""):
        return await _select_engine.select_option(label_text, option_text, xpath_smart)

    @controller.action('Click an adjacent button (选择/引入/上传) to fill a field, but only if the field is empty. Returns "already-filled" (non-ok skip) if field has value.')
    async def click_adjacent_button(label_text: str):
        return await _fill_engine.click_adjacent_button(label_text)

    @controller.action('Click a radio option by label text and radio option text.')
    async def click_radio(label_text: str, option_text: str, xpath_smart: str = ""):
        return await _radio_engine.click_radio(label_text, option_text, xpath_smart)

    @controller.action('Select a tree-select option by label and option text. For custom TsscMultiTree components (e.g. 行业代码). Opens popover, searches tree data by label, selects matching node, closes popover. If result starts with no-tree-component, do NOT retry — use fill_form_field with a concrete value (not "first") or select_option.')
    async def select_tree_option(label_text: str, option_text: str, xpath_smart: str = ""):
        return await _tree_engine.select_tree_option(label_text, option_text, xpath_smart)
