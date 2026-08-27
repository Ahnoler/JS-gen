#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Playwright script assembler.

DEPRECATED for product replay: prefer live scripts/controller/actions/_replay.py
(replay_actions). This assembler + CTRL injection remains an engineering
asset (test/assemble, legacy /replay/*) and must not be functionally removed
without an explicit migration.

Reads an action JSON file (with {action, params, element} entries) and generates
a Playwright JS script with proper CTRL helpers for Element UI components.

Features:
  - Multi-tier selector degradation (ID → class → XPath → text → fuzzy)
  - Identity field auto-generation (credit code, mobile, etc.)
  - Error collection + structured error report for self-healing
  - Per-tier error diagnostics (CTRL | Playwright | absolute XPath → English hint)

Verified (detection + self-healing):
  ✅ fill_form_field       — 2-tier: CTRL → Playwright hasText
  ✅ select_option         — 2-tier: CTRL → Playwright native
  ✅ click_element_by_index — button: role/text/xpath_smart; menu: xpath/text/menu-item/fuzzy

TODO — remaining operations lack multi-tier degradation + structured error reporting:
  ☐ click_menu_item        — single-tier CTRL, error: 'not-found'
  ☐ click_table_row_button — multi-tier
  ☐ click_table_row_radio  — single-tier CTRL, error: returns CTRL string
  ☐ click_radio            — single-tier CTRL, error: returns CTRL string
  ☐ click_adjacent_button  — no fallback, direct CTRL call
  ☐ switch_tab             — no fallback
  ☐ close_dialog           — no fallback

Usage:
    python script_assembler.py <action_file.json> [output_path.js]
    python script_assembler.py -  # read from stdin
"""
import json
import os
import sys
import re
from datetime import datetime

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(_THIS_DIR)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from scripts.models import ActionEntry, ActionFile, FormSnapshot, ElementInfo
from scripts.controller.actions.replay_names import normalize_action_name

from .codegen.actions import (  # noqa: F401  (re-exported for compat)
    FILL_RETRY_ACTIONS,
    _IDENTITY_EXCLUDE,
    _IDENTITY_KEYWORDS,
    _SKIP_ACTIONS,
    _click_kind,
    _generate_action_code,
    _is_identity_field,
)
from .codegen.js_escaping import (  # noqa: F401  (re-exported for compat)
    _escape,
    _escape_js_string,
    _xpath_literal_py,
)

# ========================== Script Bootstrap ==========================

SCRIPT_PREAMBLE = '''const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const _TMP = process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
const _CDP_PORT = 0;
const _errors = [];
function _recordError(step, action, label, value, error, details, severity) {
  _errors.push({ step, action, label, value, error, details, severity: severity || 'error' });
}

// Identity field generators
function genCreditCode() { const s='0123456789ABCDEFGHJKLMNPQRTUWXY'; let r=''; for(let i=0;i<18;i++) r+=s[Math.floor(Math.random()*s.length)]; return r; }
function genValidIdCard() { const a=[110101,110102,110105,120103,310101,320102,440103]; let r=String(a[Math.floor(Math.random()*a.length)]); for(let i=0;i<12;i++) r+=Math.floor(Math.random()*10); let w=[7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2], s=0; for(let i=0;i<17;i++) s+=parseInt(r[i])*w[i]; let c=['1','0','X','9','8','7','6','5','4','3','2']; r+=c[s%11]; return r; }
function genMobile() { const p=['138','139','150','151','152','157','158','159','186','187','188']; let r=p[Math.floor(Math.random()*p.length)]; for(let i=0;i<8;i++) r+=Math.floor(Math.random()*10); return r; }
function genEmail() { const n=['test','admin','user','demo','info']; const d=['example.com','test.com','demo.cn']; return n[Math.floor(Math.random()*n.length)]+Math.floor(Math.random()*1000)+'@'+d[Math.floor(Math.random()*d.length)]; }
function genBankCard() { let r='62'; for(let i=0;i<17;i++) r+=Math.floor(Math.random()*10); return r; }
function genName() { const s=['张','王','李','赵','陈','刘','杨','黄','周','吴']; const m=['伟','芳','娜','敏','静','强','磊','洋','勇','艳']; return s[Math.floor(Math.random()*s.length)]+m[Math.floor(Math.random()*m.length)]+m[Math.floor(Math.random()*m.length)]; }
function genAmount() { return String(Math.floor(Math.random()*9000000+1000000)); }
function genAddress() { const c=['北京市朝阳区','上海市浦东新区','广州市天河区','深圳市南山区','杭州市西湖区']; return c[Math.floor(Math.random()*c.length)]+'某某路'+Math.floor(Math.random()*200+1)+'号'; }

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  try {
'''

# ========================== CTRL Injection Template ==========================

_ctrl_injection_path = None

SCRIPT_POSTAMBLE = '''})().catch(err => { console.error(err); process.exit(1); });
'''

def _load_ctrl_injection():
    global _ctrl_injection_path
    if not _ctrl_injection_path or not os.path.exists(_ctrl_injection_path):
        sys.stderr.write("[assembler] WARNING: No CTRL injection file. Use --ctrl-injection.\n")
        sys.stderr.flush()
        return "// CTRL helpers not loaded — provide --ctrl-injection path\n"
    with open(_ctrl_injection_path, 'r', encoding='utf-8') as f:
        return f.read()

def _get_ctrl_header():
    injection = _load_ctrl_injection()
    return f"// CTRL helpers — loaded from src/ctrl-actions.js\n{injection}\n"


CTRL_FOOTER = '''  } catch (err) {
    console.error('FATAL:', err.message);
    _recordError(0, 'fatal', '', '', err.message, 'Script-level crash');
  } finally {
    // Write error report
    if (_errors.length > 0) {
      const reportPath = require('path').join(_TMP, 'script-errors.json');
      try { fs.writeFileSync(reportPath, JSON.stringify(_errors, null, 2)); } catch {}
      const errCount = _errors.filter(e => e.severity !== 'warning').length;
      const warnCount = _errors.filter(e => e.severity === 'warning').length;
      var summary = '=====';
      if (errCount > 0) summary += ' ' + errCount + ' ERROR(S)';
      if (warnCount > 0) summary += (errCount > 0 ? ', ' : ' ') + warnCount + ' WARNING(S)';
      summary += ' =====';
      console.error(summary);
      _errors.forEach((e, i) => {
        var tag = e.severity === 'warning' ? 'WARN' : 'ERROR';
        console.error('[' + (i+1) + '] ' + tag + ' Step ' + e.step + ': ' + e.action + ' - ' + e.error + (e.details ? ' | ' + e.details : ''));
      });
      process.exit(errCount > 0 ? 1 : 0);
    } else {
      console.log('===== SUCCESS =====');
    }
    console.log('Waiting 30s before closing browser...');
    await page.waitForTimeout(30000);
    await browser.close();
  }
'''

# Footer for partial replay: keeps browser open, prints CDP endpoint for agent hand-off
PARTIAL_CTRL_FOOTER = '''  } catch (err) {
    console.error('FATAL:', err.message);
    _recordError(0, 'fatal', '', '', err.message, 'Script-level crash');
  } finally {
    if (_errors.length > 0) {
      const reportPath = require('path').join(_TMP, 'script-errors.json');
      try { fs.writeFileSync(reportPath, JSON.stringify(_errors, null, 2)); } catch {}
      const errCount = _errors.filter(e => e.severity !== 'warning').length;
      const warnCount = _errors.filter(e => e.severity === 'warning').length;
      var summary = '=====';
      if (errCount > 0) summary += ' ' + errCount + ' ERROR(S)';
      if (warnCount > 0) summary += (errCount > 0 ? ', ' : ' ') + warnCount + ' WARNING(S)';
      summary += ' =====';
      console.error(summary);
      _errors.forEach((e, i) => {
        var tag = e.severity === 'warning' ? 'WARN' : 'ERROR';
        console.error('[' + (i+1) + '] ' + tag + ' Step ' + e.step + ': ' + e.action + ' - ' + e.error + (e.details ? ' | ' + e.details : ''));
      });
    } else {
      console.log('===== PARTIAL REPLAY OK =====');
    }
    console.log('CDP_PORT:' + _CDP_PORT);
    console.log('READY_FOR_AGENT: browser stays open');
  }
})().catch(err => { console.error(err); process.exit(1); });
'''


# ========================== Assembly ==========================

FILL_ACTIONS = {'fill_form_field', 'select_option', 'click_radio', 'select_tree_option'}
BOUNDARY_ACTIONS = {'click_element_by_index', 'click_menu_item', 'click_button', 'switch_tab', 'close_dialog', 'go_to_url'}

def assemble_script(action_entries, target_url=None, form_snapshots=None):
    """Assemble a complete Playwright script from recorded action entries.
    form_snapshots: list of {container, fields, action_index} — one per scanned container.
    """
    body = []
    step = 1
    in_block = False

    url = target_url or ''
    if not url or 'unknown' in url.lower():
        url = 'http://target-url-placeholder'
    goto_line = f'    await page.goto(\'{url}\', {{ waitUntil: \'networkidle\', timeout: 60000 }});'
    body.append("    const _RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;")
    body.append("    await page.evaluate(() => CTRL.waitForLoading());")

    # Sort snapshots by action_index so checks inject at the right points
    # Normalize to FormSnapshot if raw dicts
    _raw_checks = form_snapshots or []
    _norm_checks = [FormSnapshot(**s) if isinstance(s, dict) else s for s in _raw_checks]
    pending_checks = sorted(_norm_checks, key=lambda s: s.action_index)
    action_counter = 0  # counts through ALL entries to find injection point
    _check_idx = [0]  # mutable counter for unique variable names

    def _inject_form_check(fields, container, action_index):
        """Inject a verifyFormStructure call for one container."""
        nonlocal step
        idx = _check_idx[0]
        _check_idx[0] += 1
        fields_json = json.dumps(fields, ensure_ascii=False)
        container_label = container or 'main'
        v = f'__fc{idx}'  # unique variable name per check
        cont_json = json.dumps(container_label, ensure_ascii=False)
        body.append(f'    console.log("[FORM-CHECK] Verifying container: {container_label}");')
        body.append(
            f'    const {v} = await page.evaluate(([f, c]) => JSON.parse(CTRL.verifyFormStructure(f, c)), '
            f'[{fields_json}, {cont_json}]);'
        )
        # P2: required field change → error, stop script
        body.append(f'    if ({v}.hasRequiredChange) {{')
        body.append(f'      const _m = {v}.missing_required.join(",");')
        body.append(f'      const _a = {v}.added_required.join(",");')
        body.append(f'      _recordError({step}, "form_structure_changed", "", "", "missing=[" + _m + "] added=[" + _a + "]", JSON.stringify({{')
        body.append(f'        container: "{container_label}",')
        body.append(f'        missing_required: {v}.missing_required,')
        body.append(f'        added_required: {v}.added_required,')
        body.append(f'        missing_optional: {v}.missing_optional,')
        body.append(f'        added_optional: {v}.added_optional,')
        body.append(f'        expected_required: {v}.required_count,')
        body.append(f'        expected_optional: {v}.optional_count,')
        body.append(f'        action_index: {action_index or 0}')
        body.append(f'      }}));')
        body.append(f'      throw new Error("Form required fields changed: missing=[" + _m + "] added=[" + _a + "]");')
        body.append(f'    }}')
        # P3: optional field change → warning, continue
        body.append(f'    if ({v}.hasOptionalChange) {{')
        body.append(f'      _recordError({step}, "form_warning", "", "", "optional fields changed", JSON.stringify({{')
        body.append(f'        container: "{container_label}",')
        body.append(f'        missing_optional: {v}.missing_optional,')
        body.append(f'        added_optional: {v}.added_optional,')
        body.append(f'      }}), "warning");')
        body.append(f'      console.log("[FORM-CHECK P3] WARN: Optional fields changed | missing:", JSON.stringify({v}.missing_optional), "| added:", JSON.stringify({v}.added_optional));')
        body.append(f'    }}')
        # P4: field order change → warning, continue
        body.append(f'    if ({v}.reordered && !{v}.hasRequiredChange && !{v}.hasOptionalChange) {{')
        body.append(f'      _recordError({step}, "form_warning", "", "", "field order changed", JSON.stringify({{')
        body.append(f'        container: "{container_label}",')
        body.append(f'        reordered: true,')
        body.append(f'      }}), "warning");')
        body.append(f'      console.log("[FORM-CHECK P4] WARN: Field order changed, all fields present");')
        body.append(f'    }}')
        body.append(f'    console.log("[FORM-CHECK] Verification passed for container: {container_label}");')

    for entry in action_entries:
        # Normalize entry to dict
        _e = entry.model_dump() if isinstance(entry, ActionEntry) else (entry if isinstance(entry, dict) else {})
        action = normalize_action_name(_e.get('action', ''))
        action_counter += 1

        # Inject any pending form checks whose action_index has been passed.
        # Runs for EVERY entry (including SKIP_ACTIONS) so checks land at
        # the correct position regardless of fill-block boundaries.
        while pending_checks and action_counter > pending_checks[0].action_index:
            check = pending_checks.pop(0)
            if check.fields:  # skip empty snapshots (avoids false-positive "added" warnings)
                _inject_form_check(
                    [f.model_dump() for f in check.fields],
                    check.container,
                    check.action_index,
                )

        if action in _SKIP_ACTIONS:
            continue

        if action in BOUNDARY_ACTIONS:
            in_block = False

        is_first_fill = action in FILL_ACTIONS and not in_block
        if is_first_fill:
            in_block = True

        code = _generate_action_code(entry, step, url, is_first_fill)
        if code:
            body.append(f'    await page.screenshot({{ path: path.join(_TMP, `step-{step}-before-${{_RUN_ID}}.png`), fullPage: true }});')
            body.append(code)
            body.append(f'    await page.screenshot({{ path: path.join(_TMP, `step-{step}-after-${{_RUN_ID}}.png`), fullPage: true }});')
            # Machine-readable marker for trajectory replay WS (step id/phase from action JSON)
            _sid = _e.get('id') or _e.get('stepId') or ''
            _pid = _e.get('phaseId') or _e.get('trajectoryPhaseId') or ''
            _marker = json.dumps({'step': step, 'ok': True, 'id': _sid, 'phaseId': _pid}, ensure_ascii=False)
            body.append(f"    console.log('__REPLAY_STEP__' + {repr(_marker)});")
            step += 1

    return SCRIPT_PREAMBLE + '\n' + goto_line + '\n' + _get_ctrl_header() + '\n'.join(body) + '\n\n' + CTRL_FOOTER + '\n' + SCRIPT_POSTAMBLE


# ========================== Part 2: Partial assembly (for self-healing) ==========================

def assemble_partial_script(action_entries, target_url=None, stop_before_step=None):
    """Assemble script up to (but not including) the specified step number.
    Used to reproduce error state for self-healing diagnostics."""
    if stop_before_step is None:
        return assemble_script(action_entries, target_url)

    # Only include entries before the failing step
    partial_entries = action_entries[:stop_before_step - 1] if stop_before_step > 1 else []
    body = []
    step = 1
    in_block = False

    url = target_url or ''
    if not url or 'unknown' in url.lower():
        url = 'http://target-url-placeholder'
    goto_line = f'    await page.goto(\'{url}\', {{ waitUntil: \'networkidle\', timeout: 60000 }});'
    body.append("    const _RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;")
    body.append("    await page.evaluate(() => CTRL.waitForLoading());")

    for entry in partial_entries:
        _e = entry.model_dump() if isinstance(entry, ActionEntry) else (entry if isinstance(entry, dict) else {})
        action = normalize_action_name(_e.get('action', ''))
        if action in _SKIP_ACTIONS:
            continue

        if action in BOUNDARY_ACTIONS:
            in_block = False

        is_first_fill = action in FILL_ACTIONS and not in_block
        if is_first_fill:
            in_block = True

        code = _generate_action_code(entry, step, url, is_first_fill)
        if code:
            body.append(f'    await page.screenshot({{ path: path.join(_TMP, `step-{step}-before-${{_RUN_ID}}.png`), fullPage: true }});')
            body.append(code)
            body.append(f'    await page.screenshot({{ path: path.join(_TMP, `step-{step}-after-${{_RUN_ID}}.png`), fullPage: true }});')
            step += 1

    return SCRIPT_PREAMBLE + '\n' + goto_line + '\n' + _get_ctrl_header() + '\n'.join(body) + '\n\n' + CTRL_FOOTER + '\n' + SCRIPT_POSTAMBLE


def assemble_partial_for_cdp(action_entries, target_url=None, stop_before_step=None):
    """Like assemble_partial_script, but keeps browser open with CDP for agent hand-off."""
    if stop_before_step is None:
        return assemble_script(action_entries, target_url)
    partial_entries = action_entries[:stop_before_step - 1] if stop_before_step > 1 else []
    body = []
    step = 1
    in_block = False
    url = target_url or ''
    if not url or 'unknown' in url.lower():
        url = 'http://target-url-placeholder'
    goto_line = f'    await page.goto(\'{url}\', {{ waitUntil: \'networkidle\', timeout: 60000 }});'
    body.append("    const _RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;")
    body.append("    await page.evaluate(() => CTRL.waitForLoading());")
    for entry in partial_entries:
        _e = entry.model_dump() if isinstance(entry, ActionEntry) else (entry if isinstance(entry, dict) else {})
        action = normalize_action_name(_e.get('action', ''))
        if action in _SKIP_ACTIONS:
            continue
        if action in BOUNDARY_ACTIONS:
            in_block = False
        is_first_fill = action in FILL_ACTIONS and not in_block
        if is_first_fill:
            in_block = True
        code = _generate_action_code(entry, step, url, is_first_fill)
        if code:
            body.append(f'    await page.screenshot({{ path: path.join(_TMP, `step-{step}-before-${{_RUN_ID}}.png`), fullPage: true }});')
            body.append(code)
            body.append(f'    await page.screenshot({{ path: path.join(_TMP, `step-{step}-after-${{_RUN_ID}}.png`), fullPage: true }});')
            step += 1
    return SCRIPT_PREAMBLE + '\n' + goto_line + '\n' + _get_ctrl_header() + '\n'.join(body) + '\n\n' + PARTIAL_CTRL_FOOTER + '\n' + SCRIPT_POSTAMBLE


def apply_changes(commands, changes):
    """Apply LLM-recommended changes to the commands array.

    Args:
        commands: List of action entry dicts
        changes: List of {step: int, action: 'modify'|'delete'|'insert', entry: dict?}

    Returns:
        Modified commands list
    """
    cmds = list(commands)  # shallow copy
    # Sort in reverse step order so indices don't shift when applying
    for change in sorted(changes, key=lambda c: c['step'], reverse=True):
        step_num = change['step']
        action = change.get('action', 'modify')
        idx = step_num - 1  # convert to 0-based index

        if action == 'modify':
            if 0 <= idx < len(cmds):
                cmds[idx] = change.get('entry', cmds[idx])
        elif action == 'delete':
            if 0 <= idx < len(cmds):
                del cmds[idx]
        elif action == 'insert':
            entry = change.get('entry')
            if entry:
                cmds.insert(min(idx, len(cmds)), entry)
    return cmds
# ========================== Main ==========================

def main():
    global _ctrl_injection_path
    if len(sys.argv) < 2:
        print('Usage: python script_assembler.py <action_file.json> [output.js] [--partial-stop N] [--partial-cdp N]', file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = None
    stop_before_step = None
    cdp_mode = False
    form_snapshot_path = None

    # Parse remaining args
    remaining = sys.argv[2:]
    while remaining:
        arg = remaining.pop(0)
        if arg == '--partial-stop' and remaining:
            stop_before_step = int(remaining.pop(0))
        elif arg == '--partial-cdp' and remaining:
            stop_before_step = int(remaining.pop(0))
            cdp_mode = True
        elif arg == '--ctrl-injection' and remaining:
            _ctrl_injection_path = remaining.pop(0)
        elif arg == '--form-snapshot' and remaining:
            form_snapshot_path = remaining.pop(0)
        elif not output_path:
            output_path = arg

    if input_path == '-':
        data = json.load(sys.stdin)
    else:
        with open(input_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

    # Read commands from either format
    raw_cmds = data.get('actions', []) or (data.get('tests', [{}])[0].get('commands', []) if data.get('tests') else [])
    has_new = raw_cmds and any(c.get('action') for c in raw_cmds if isinstance(c, dict))
    if not has_new:
        actions = []
        for cmd in raw_cmds:
            c = cmd.get('command', '')
            if c == 'input':
                actions.append({'action': 'fill_form_field', 'params': {'label_text': cmd.get('propertiesName', ''), 'value': cmd.get('value', '')},
                    'target': cmd.get('target', ''), 'cssSelector': cmd.get('cssSelector', ''), 'tagName': cmd.get('tagName', ''), 'attributes': cmd.get('attributes', {})})
            elif c == 'select':
                actions.append({'action': 'select_option', 'params': {'label_text': cmd.get('propertiesName', ''), 'option_text': cmd.get('value', '')},
                    'target': cmd.get('target', ''), 'cssSelector': cmd.get('cssSelector', ''), 'tagName': cmd.get('tagName', ''), 'attributes': cmd.get('attributes', {})})
            elif c == 'click':
                actions.append({'action': 'click_element_by_index', 'params': {'index': cmd.get('value', '0'), 'tag_name': cmd.get('tagName', ''), 'text': cmd.get('propertiesName', '')},
                    'target': cmd.get('target', ''), 'cssSelector': cmd.get('cssSelector', ''), 'tagName': cmd.get('tagName', ''), 'attributes': cmd.get('attributes', {})})
    else:
        actions = raw_cmds

    # Normalize to ActionEntry model objects
    actions = [
        ActionEntry(**a) if isinstance(a, dict) else a
        for a in (actions if isinstance(actions, list) else [])
    ]

    url = data.get('url', '') or ''
    if not url or 'unknown' in url.lower():
        for entry in actions:
            ae = entry if isinstance(entry, ActionEntry) else ActionEntry(**entry) if isinstance(entry, dict) else None
            if ae and ae.action == 'go_to_url':
                url = ae.params.get('url', '') or ''
                if url:
                    break

    # Read form snapshots array (from --form-snapshot arg, or match by action filename)
    form_snapshots = None
    if form_snapshot_path:
        if os.path.exists(form_snapshot_path):
            with open(form_snapshot_path, 'r', encoding='utf-8') as _f:
                _fs = json.load(_f)
            if isinstance(_fs, list):
                form_snapshots = _fs
    else:
        import re as _re
        _m = _re.search(r'action_(\d{8}_\d{6})\.json', input_path)
        if _m:
            _ts = _m.group(1)
            _form_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'forms', f'form_{_ts}.json')
            if os.path.exists(_form_path):
                with open(_form_path, 'r', encoding='utf-8') as _f:
                    _fs = json.load(_f)
                if isinstance(_fs, list):
                    form_snapshots = _fs

    if stop_before_step is not None:
        if cdp_mode:
            script = assemble_partial_for_cdp(actions, url, stop_before_step)
        else:
            script = assemble_partial_script(actions, url, stop_before_step)
    else:
        script = assemble_script(actions, url, form_snapshots=form_snapshots)

    if output_path:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(script)
        print(f'Script written: {output_path}')
        visible_actions = [a for a in actions if (a.action if isinstance(a, ActionEntry) else a.get("action","")) not in _SKIP_ACTIONS]
        print(f'Steps: {len(visible_actions)}')
    else:
        print(script)


if __name__ == '__main__':
    main()
