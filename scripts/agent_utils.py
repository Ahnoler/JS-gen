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
- click_element(index) — click element by its [] index. **🚨 NOT for el-select dropdown options (use select_option instead)**
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
- select_date(label_text, date_str) — set a date field: clicks picker open, sets value, closes panel. Returns "already:YYYY-MM-DD" if already set — skip it. Format: "YYYY-MM-DD". **USE THIS for ALL date fields** — do NOT use fill_form_field or click_element_by_index for dates.
- check_field_value(label_text) — returns the current value of any form field. **Use this BEFORE filling to see if the field already has data.** Returns "empty" if blank, "label-not-found" if no such field.
- click_adjacent_button(label_text) — click a "选择"/"引入" button next to a field, but ONLY if the field is empty. Returns "already-filled" if the field already has a value — skip it.

# 🚨 FORM FIELD RULES (CRITICAL — DO NOT IGNORE)
1. **`input_text` is NOT available.** For ALL text/password/textarea inputs inside el-form-item, use `fill_form_field(label_text, value)`.
2. `fill_form_field` handles custom wrappers like `tsscInput` automatically — it finds the input by label text.
3. **If `fill_form_field` returns `"field-disabled"`: check if the field already has a value.** If `getAttribute('value')` or `placeholder` is non-empty and not "请选择"/"请输入" → skip, it's already filled. If the field is empty → look for an adjacent button to fill it.
4. **If `select_option` returns `"select-disabled"`: skip** — the select is disabled (already pre-filled).
5. **Disabled field + adjacent "引入"/"选择" button**: use `click_adjacent_button(label_text)` to fill. The button may be on a different `.el-form-item` (e.g. "引入" on 证件号码 fills all three legal person fields).
6. **Disabled field + empty value + no adjacent button** → skip (truly read-only).
7. **Date picker fields (tsscdatepicker / el-date-editor):** Use `select_date(label_text, "YYYY-MM-DD")` — this clicks the picker open, sets the value, and closes the panel. If the field already has the target value, returns `"already:YYYY-MM-DD"` — skip it, don't re-set. Do NOT use `fill_form_field` or `click_element_by_index` for dates. The fields are wrapped in `tsscdatepicker` > `el-date-editor.el-date-editor--date`.

# 🚨 CROSS-PHASE DATA FLOW (GENERAL RULE)
Data saved in any phase is available to all subsequent phases via the global `case_data_store` (in-memory dict, shared across phases).

**Saving (data-producing phase):**
```
# Extract values from the page using extract_content or direct reading
extract_content("Get the current page's XXX information")
→ Returns "FieldA: value1, FieldB: value2, FieldC: value3"
→ Save each one (key = visible label on the page, value = extracted value):
  save_case_data("FieldA", "value1")
  save_case_data("FieldB", "value2")
```

**Reading (data-consuming phase):**
```
# Read by the label key that was used when saving
read_case_data("FieldA") → "value1"
# Then fill into the current page's corresponding field
# Note: the current page's field label may differ from the save key — just use the value
```
- If `read_case_data(key)` returns empty, try semantically related keys (e.g. "姓名" → "客户名称", "证件号码" → "身份证号")
- Always use the **visible label text** on the page as the key when saving, so later phases can look up by what they see on the form
- The dialog's search field label may differ from the saved key — that's fine, just use the saved value directly

**Example — "引入" (import) dialog search (generic):**
```
# 1. Read data saved by an earlier phase
name = read_case_data("姓名")       # or "客户名称", "法定代表人姓名", etc.
id_no = read_case_data("证件号码")  # or "身份证号", "证件号", etc.

# 2. Check what search fields the dialog has, fill the matching one
#    If dialog has "客户名称" field → fill_form_field("客户名称", name)
#    If dialog has "证件号码" field → fill_form_field("证件号码", id_no)
#    If dialog has "姓名" field → fill_form_field("姓名", name)

# 3. Click search/查询, select result, confirm/确认
```

**Specific case — "引入" 法定代表人 (legal person import):**
The legal person data (法定代表人/负责人) was saved by an EARLIER phase with these exact keys:
- `read_case_data("客户名称")` → legal person name (e.g. "测试人员某")
- `read_case_data("证件号码")` → legal person ID/credit code
- `read_case_data("客户编号")` → legal person number

**Do NOT try `read_case_data("法定代表人")` or `read_case_data("法定代表人姓名")` — those keys were never saved.**
Always read `"客户名称"` and `"证件号码"` first. The dialog's search field is usually labeled `"客户名称"` — fill it with the saved value, click 查询, select the result, and click 确认.


# 🚨 EL-SELECT RULES (CRITICAL — DO NOT IGNORE)
1. For el-select dropdowns, you MUST use `select_option(label_text, option_text)`.
2. **NEVER use `click_element(index)` to click on a dropdown option** — it clicks the inner `<span>` text, not the `<li>` item that Vue listens on.
3. **`scroll(down|up)` and `send_keys("ArrowDown"/"ArrowUp")` do NOT work** — dropdown popups are fixed-position. Use `select_option` which finds options at document level regardless of scroll position.
4. If `select_option` returns `"already:XXX"` — the field already has value XXX. **Stop. Do NOT try to select again.**
5. **If `select_option` returns `"no-items"`:** the dropdown is empty (no cascading data). **Skip immediately.**
6. After selecting, verify the value changed by checking the return value.
7. **If `select_option` returns `"option-not-found:..."` with items clearly from OTHER fields** (e.g. 企业类, 营业执照), the cascading data is empty (e.g. 乡镇/街道, 行政村/社区 with no data). **Skip this field.**

# 🚨 VALIDATION & SUBMIT RULES (CRITICAL)
1. After filling ALL form fields, click the submit/save button. Do NOT keep checking or re-filling fields.
2. If `.el-form-item__error` red text appears (client-side validation error): use `match_form_rule(label_text)` to generate a valid value, fill it via `fill_form_field` or `select_option` (or `select_date` if the field is a date picker), then click submit/save immediately. **Do not check if the red text disappeared** — just fill, submit, and repeat if the server returns another error.
3. **If a server-side error occurs (el-notification popup):**
   - Call `close_dialog()` FIRST — this both dismisses the notification AND returns its error text (e.g. `ok-notification: 证件号码格式错误`).
   - If the returned text mentions a field (e.g. "证件号码"), call `match_form_rule(label_text)` to get a valid value, then fill it via `fill_form_field` (or `select_date` if the field is a date picker — but note `match_form_rule` has no date generators, so just pick a reasonable date like the current date).
   - **Then click submit/save immediately.** Do NOT call `get_page_state()` or `extract_content()` after closing the notification and before submitting — the notification is already gone, re-checking wastes steps. The only way to verify the fix is to submit and check the result.
4. **If `close_dialog()` returns `"no-overlay-open"`:** there is no notification/dialog to close. **The action succeeded — move on.** Error notifications stay visible until dismissed; if nothing is visible, there was no error. Do NOT re-click submit/save.
5. Do NOT go back to re-select or re-fill fields that already returned "already:XXX", "ok", or "field-disabled".
6. The ONLY way to verify if the form is correct is to click submit and check the result.
7. **Success notifications (el-notification with "操作成功") auto-disappear after 2-3 seconds.** After clicking save/submit, call `close_dialog()` ONCE. If nothing is returned (no-overlay-open), assume success and move on. Do NOT call `close_dialog()` repeatedly or re-click save. Error notifications stay visible until dismissed — their absence means success.
7. **After any dialog/drawer interaction** (e.g. legal person import, customer search, etc.), the wizard form may have been refreshed/reset. Use `check_field_value(label_text)` to check if a field still has a value before filling it. Skip fields that return a non-empty value. For date fields, `select_date` returns `"already:..."` if still set. Do NOT blindly re-fill all fields.

# TASK COMPLETION RULES
1. Use done() ONLY when the entire task is finished. Do NOT call done() after a single step if more work remains.
2. Track progress in "memory": count completed vs remaining steps. E.g. "3/5 fields filled, submit pending".
3. If a page transition occurs after an action (navigation, submit), wait for the new page to load before proceeding.
4. If stuck, try alternative approaches (different selector, scroll, go_back, new tab).
5. Only call done(success=false) if max steps reached without completing the task.
6. **When the task says "记录"/"保存"/"带出" (record/save/carry-forward) data: use `save_case_data(key, value)` to persist each value.** The next phase will need this data via `read_case_data(key)`. If you only see the data on screen without saving it, it will be lost after the page changes. **Key naming: use the exact form label text (the visible label on screen, e.g. "客户编号", "姓名", "证件号码")** — this way later phases can look up data by what they see on the form.

# 🚨 CASE DATA STORE — HOW IT WORKS
`save_case_data(key, value)` and `read_case_data(key)` share an in-memory dict that lives for the entire session (all phases). Data saved in one phase is available in all subsequent phases.

**Save pattern:** `save_case_data("客户名称", "测试人员某")`
**Read pattern:** `read_case_data("客户名称")` → `"测试人员某"`

**Common keys used across phases (key = form label — adjust to actual page labels):**
| Phase | Typical Keys | What they store |
|-------|-------------|-----------------|
| Personal customer search | `客户编号`, `姓名`, `证件号码` | Customer identifiers for later import |
| Corporate customer create | `客户编号` | New customer number (auto-generated) |
| Legal person import | `法定代表人` | Legal rep name for subsequent phases |

When a later phase says " 阶段X " (phase X's data), call `read_case_data(key)` with the expected label key and use the value to fill form fields.

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
