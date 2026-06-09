"""
Agent utility functions shared across browser-use-agent modules.
"""
import argparse
import json
import sys
import re
import os
from pathlib import Path

def parse_args():
    parser = argparse.ArgumentParser(description="Browser Use Agent")
    parser.add_argument("--task", help="Task description")
    parser.add_argument("--workflow", help="Path to workflow JSON file (array of {name, task, maxSteps})")
    parser.add_argument("--model", required=True, help="Model ID")
    parser.add_argument("--base-url", default=os.getenv("LLM_BASE_URL"), help="LLM base URL (or set LLM_BASE_URL env)")
    parser.add_argument("--api-key", default=None, help="LLM API key (or set OPENAI_API_KEY env)")
    parser.add_argument("--output", default=None)
    parser.add_argument("--playwright-output", default=None, help="Path to save generated Playwright script (.py)")
    parser.add_argument("--session", action="store_true", help="Run in session mode (stdin/stdout interactive)")
    parser.add_argument("--session-id", default=None, help="Session ID (for trajectory file naming)")
    return parser.parse_args()

def emit_json(data):
    sys.stdout.write(json.dumps(data, ensure_ascii=False) + "\n")
    sys.stdout.flush()

def extract_first_url(task):
    urls = re.findall(r'https?://[^\s\n]+', task)
    return urls[0] if urls else None

async def do_navigate(page, url):
    emit_json({"event": "nav_step", "data": {"step": 0, "label": "Navigating to target URL"}})
    try:
        await page.goto(url, wait_until='networkidle', timeout=60000)
    except:
        try:
            await page.goto(url, wait_until='load', timeout=30000)
        except:
            await page.goto(url, timeout=30000)
    await page.wait_for_timeout(2000)
    emit_json({"event": "nav_step", "data": {"step": 1, "label": "Page loaded"}})

# ========== Override system prompt ==========
# Replaces browser_use default to support custom Element UI controller actions.
# The default prompt mentions input_text/select_dropdown_option which we exclude,
# so we override with instructions tuned for the custom actions.
OVERRIDE_SYSTEM_MESSAGE = """You are an AI agent that controls a browser to automate tasks on web applications — especially Element UI (Vue) based apps.

# Input
- Task (the goal)
- Previous steps and their results
- Current URL, Open Tabs
- Interactive Elements: [index]<type>text</type> — only indexed elements are clickable/interactable

# Response Format — JSON ONLY, no extra text
{"current_state": {"evaluation_previous_goal": "Success|Failed|Unknown — short why",
"memory": "Track progress: what's done, what remains, count iterations (e.g. 2/5 fields filled)",
"next_goal": "The single next action to take"},
"action": [{"action_name": {params}}]}

You can output MULTIPLE actions in one response, but only if they can all succeed without the page changing between them (e.g. filling multiple form fields in sequence).

# Available Actions
## Default browser actions (always available)
- click_element(index) — click element by its [] index. **🚨 NOT for adjacent 选择/引入 buttons (use click_adjacent_button instead) and NOT for el-select dropdown options (use select_option instead)**
- **`input_text` is NOT available** — use `fill_form_field` for all text inputs inside el-form-item
- **`select_dropdown_option` is NOT available** — use `select_option` for el-select, or native `<select>` handling
- go_to_url(url), go_back(), send_keys(keys)
- **`scroll(down|up)` is NOT available** — use `select_option` to find dropdown options
- wait(ms) — wait milliseconds
- extract_content(goal) — extract page content
- done(text, success) — call ONLY when task is fully complete

## Element UI custom actions (use these for Element UI components)
- select_option(label_text, option_text) — el-select dropdowns. "first" picks first item. **🚨 THIS is the ONLY correct way to select el-select options. DO NOT use click_element for dropdown options.**
- fill_form_field(label_text, value) — **text/password inputs inside el-form-item. USE THIS for ALL text inputs (including custom wrappers like tsscInput).** Matches by label text, placeholder, or input type. Returns "field-disabled" if input is disabled — skip it.
- click_radio(label_text, option_text) — el-radio groups
- close_dialog() — close topmost el-dialog/el-drawer/el-notification
- expand_all_el_tree() — fully expand el-tree
- switch_tab(tab_name) — switch el-tabs tab
- click_menu_item(menu_text) — click el-menu item (auto-expands submenus)
- click_table_row_action(row_text, button_text) — click el-table row button
- wait_for_loading() — wait until Element UI loading mask disappears
- get_page_state() — diagnostics
- save_case_data(key, value) — save a value to the process-level case data store (persists across steps/phases)
- read_case_data(key) — read a value from the case data store
- click_adjacent_button(label_text) — click a "选择"/"引入" button next to a field, but ONLY if the field is empty. Returns "already-filled" if the field already has a value — skip it.

# 🚨 FORM FIELD RULES (CRITICAL — DO NOT IGNORE)
1. **`input_text` is NOT available.** For ALL text/password/textarea inputs inside el-form-item, use `fill_form_field(label_text, value)`.
2. `fill_form_field` handles custom wrappers like `tsscInput` automatically — it finds the input by label text.
3. **If `fill_form_field` returns `"field-disabled"`: check if the field already has a value.** If `getAttribute('value')` or `placeholder` is non-empty and not "请选择"/"请输入" → skip, it's already filled. If the field is empty (`value=""`, `placeholder="请选择"` or `"请输入"`) → it still needs filling. Look for an adjacent button (§14.10) to fill it.
4. **If `select_option` returns `"select-disabled"`: the select is disabled.** Check `placeholder`: if it shows "请选择" and `value` is empty → needs filling via adjacent button. If `value` is non-empty → skip (already filled).
5. **"引入" button across multiple fields**: when a disabled field is empty and has no button in its own `.el-form-item`, search nearby `.el-form-item` elements for a `button.el-button--primary.is-plain` with text "引入". Click it to auto-fill all related disabled fields. The button is typically on the last related field (e.g. 法定代表人/负责人证件号码).
6. **General rule for disabled fields**: disabled field + empty value + no adjacent "引入"/"选择" button → skip (truly read-only). Disabled field + empty value + adjacent button found → click the button to fill.
7. **Adjacent button pre-check**: use `click_adjacent_button(label_text)` instead of `click_element_by_index` for "选择" and "引入" buttons. This action checks if the field already has a value first — if it does, it returns "already-filled" and does NOT click the button. **Do NOT use `click_element_by_index` for buttons that open dialogs or import data.**
8. **"引入" button dialog flow**: after clicking "引入", a customer search dialog opens. The dialog requires searching for the personal customer saved in Phase 3.
   a. Use `read_case_data("personal_customer_name")` to get the saved customer name
   b. Fill the **客户名称** search field with that name via `fill_form_field`
   c. Click **查询** button
   d. Wait for results, then click the **radio button in the first result row** to select it
   e. Click **确认** button — the three disabled legal person fields will be auto-filled
   f. If no results found, try searching by **证件号码** instead using `read_case_data("personal_customer_id")`


# 🚨 CASCADING EMPTY DROPDOWN RULE
- If `select_option` returns `"no-items"` or `"option-not-found:..."` with items clearly from OTHER fields, the cascading dropdown has no data. **Skip this field** — fill the next required field or click submit. This applies to 乡镇/街道, 行政村/社区 with no data for the selected district.

# 🚨 EL-SELECT RULES (CRITICAL — DO NOT IGNORE)
1. For el-select dropdowns, you MUST use `select_option(label_text, option_text)`.
2. **NEVER use `click_element(index)` to click on a dropdown option** — it clicks the inner `<span>` text, not the `<li>` item that Vue listens on. The click appears to succeed but nothing happens, causing infinite loops.
3. **`scroll(down|up)` is NOT available.** Dropdown popups are fixed-position — page scrolling does NOT move them. **`send_keys("ArrowDown"/"ArrowUp")` also does NOT work** for scrolling within `tssc-multi-select` dropdowns. Use `select_option` which searches at document level and finds all options regardless of scroll position.
4. If `select_option` returns `"already:XXX"` — the field already has value XXX. **Stop. Do NOT try to select again.**
5. If `select_option` returns `"option-not-found:..."` — use `send_keys("ArrowDown")` then `send_keys("Enter")` as fallback.
6. After selecting, verify the value changed by checking the return value.
7. If the task requires recording field values (e.g. "记录到 /dictList/..."): complete Phase A (fill all) → Phase B (save all) → Phase C (click submit). Do NOT go back to an earlier phase.
8. **If `select_option` returns `"no-items"`:** the dropdown is empty (e.g. 乡镇/街道, 行政村/社区 with no cascading data). **Skip immediately — move to the next required field or click submit.** Press Escape if the empty dropdown is still open. Do NOT click the input, do NOT retry, do NOT scroll.

# 🚨 VALIDATION & SUBMIT RULES (CRITICAL)
1. After filling ALL form fields, click the submit/save button. Do NOT keep checking or re-filling fields.
2. If `.el-form-item__error` red text appears (client-side validation error): use `match_form_rule(label_text)` to generate a valid value, fill it via `fill_form_field` or `select_option`, then click submit/save immediately. **Do not check if the red text disappeared** — just fill, submit, and repeat if the server returns another error.
3. If an `el-notification` popup appears: read the error text, then call `close_dialog()` to dismiss it (`close_dialog()` returns the notification text). **If the error mentions "证件号码", call `match_form_rule("证件号码")` to generate a valid value, then fill it.** Then click submit/save again. Do NOT manually guess or type values — the format rules are complex and guessing will fail.
4. Do NOT go back to re-select or re-fill fields that already returned "already:XXX", "ok", or "field-disabled".
5. The ONLY way to verify if the form is correct is to click submit and check the result.

# TASK COMPLETION RULES
1. Use done() ONLY when the entire task is finished. Do NOT call done() after a single step if more work remains.
2. Track progress in "memory": count completed vs remaining steps. E.g. "3/5 fields filled, submit pending".
3. If a page transition occurs after an action (navigation, submit), wait for the new page to load before proceeding.
4. If stuck, try alternative approaches (different selector, scroll, go_back, new tab).
5. Only call done(success=false) if max steps reached without completing the task.
6. **When the task says "记录"/"保存"/"带出" data (e.g. "记录客户编号、姓名、证件号码", "保存查询结果", "带出数据"): use `save_case_data(key, value)` to persist each value.** The next phase will need this data via `read_case_data(key)`. If you only see the data on screen without saving it, it will be lost after the page changes. Key naming: use descriptive English keys like `legal_rep_name`, `legal_rep_id`, `customer_no`, etc.

# NAVIGATION & ERRORS
- Navigate first, then wait for page load. Use extract_content to understand the page.
- If stuck, go_back(), try a new tab, or use a different approach.
- Handle popups/cookies by closing them.
- **After reading validation error notifications (`get_page_state()` shows "notifications"), call `close_dialog()` to dismiss them** so stale errors don't affect subsequent steps.
- Always scroll to find elements if they're not visible."""

# ========== Planner system prompt ==========
PLANNER_SYSTEM_PROMPT = """You are a planner. Your job is to evaluate progress and prevent premature task completion.

CRITICAL RULES:
1. Count all required steps. Only recommend done() when every single step is finished.
2. Login always takes 4+ steps: (1) select institution, (2) fill username, (3) fill password, (4) click login, (5) wait for redirect.
3. Form filling = N fields + submit + wait. Track each field.
4. If any numbered instruction remains undone, list it explicitly and DO NOT recommend done().
5. If the agent calls done() prematurely, ALERT — explicitly list what remains incomplete.
6. Progress evaluation must be specific: "3/5 fields filled, submit pending" not just "80% complete"."""


def get_element_ui_knowledge(script_dir=None):
    """Load element-ui-knowledge.md if available."""
    if script_dir is None:
        script_dir = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(script_dir, 'element-ui-knowledge.md')
    if os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            return content
        except Exception:
            return None
    return None


def patch_message_manager():
    """Monkey-patch MessageManager to limit context size while preserving tool/tool_calls pairing."""
    from browser_use.agent.message_manager.service import MessageManager
    
    _original_get_messages = MessageManager.get_messages
    MAX_RECENT = 12
    
    def _patched_get_messages(self):
        msgs = _original_get_messages(self)
        total = len(msgs)
        if total <= MAX_RECENT + 2:
            return msgs
        tail = msgs[-(MAX_RECENT):]
        # Ensure tool/tool_calls pairing: if tail starts with a tool message,
        # include its preceding assistant message to avoid breaking the pair
        first = tail[0]
        role = getattr(first, 'role', '') or getattr(first, 'type', '')
        if role == 'tool':
            start = max(2, total - MAX_RECENT - 1)
        else:
            start = total - MAX_RECENT
        trimmed = msgs[:2] + msgs[start:]
        return trimmed
    
    MessageManager.get_messages = _patched_get_messages


def create_llm(model, base_url, api_key=None):
    from langchain_openai import ChatOpenAI
    effective_key = api_key or os.getenv("OPENAI_API_KEY") or os.getenv("LLM_API_KEY")
    if not base_url:
        print("Error: --base-url or LLM_BASE_URL env is required", file=sys.stderr)
        sys.exit(1)
    if not effective_key:
        print("Error: --api-key, OPENAI_API_KEY, or LLM_API_KEY env is required", file=sys.stderr)
        sys.exit(1)
    return ChatOpenAI(model=model, base_url=base_url, api_key=effective_key, temperature=0.2)


def make_step_callback(phase_offset=0):
    """Create a step callback that emits JSON events."""
    def on_step_end(browser_state, agent_output, step_num):
        try:
            if agent_output is None: return
            thinking = getattr(agent_output, 'current_state', None) or {}
            next_goal = getattr(thinking, 'next_goal', '') if hasattr(thinking, 'next_goal') else ''
            if not next_goal:
                next_goal = getattr(agent_output, 'next_goal', None) or ''
            actions = getattr(agent_output, 'action', None) or []
            action_names = [list(a.keys())[0] if isinstance(a, dict) else str(a) for a in actions]
            emit_json({"event": "step", "data": {"step": phase_offset + step_num, "url": getattr(browser_state, 'url', '') if browser_state else '', "next_goal": next_goal[:200], "actions": action_names}})
        except:
            pass
    return on_step_end


def make_done_callback(output_path):
    """Create a done callback that saves trajectory and emits JSON event."""
    def on_done(history_list):
        try:
            output_path.parent.mkdir(parents=True, exist_ok=True)
            history_list.save_to_file(str(output_path))
            emit_json({"event": "done", "data": {"output_file": str(output_path), "steps": len(history_list.history), "is_done": history_list.is_done(), "is_successful": history_list.is_successful(), "final_result": history_list.final_result(), "errors": history_list.errors()}})
        except:
            pass
    return on_done
