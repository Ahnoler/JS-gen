# Agent Prompt Packs + Special-Element On-Demand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the monolithic `agent-prompt.md` into per-phase packs, delete the rigid `agent-special-prompt.md`, enrich special-element hints with descriptions, and sync planner save advice with the final-check contract.

**Architecture:** `agent_utils.build_agent_system_message(contract)` assembles `agent-core` + tool packs from `scripts/prompts/` based on `_phase_intent.mode`. `session_runner` passes the current phase contract at Agent creation. `agent-prompt.md` becomes a thin shim (full assembly) for backward compatibility. Special-element hints consume `phaseDescription`/`remark` from candidates (JS pass-through allowed).

**Tech Stack:** Python agent (`agent_utils.py`, `session_runner.py`, `_special_element.py`), markdown prompts, JS control-plane pass-through (`special-element-search-service.js`), characterization scripts.

**Spec:** `docs/superpowers/specs/2026-08-08-agent-prompt-packs-design.md`

## Global Constraints

- `agent-special-prompt.md` is **deleted**; its content is **not** migrated into any pack.
- `agent-prompt.md` remains as a **thin shim** equal to full assembly (backward compat for existing characterization and external readers).
- Fallback when `contract is None` / unknown mode / heal: **full** assembly (all packs).
- `introduce_pick` gets the **complete** form pack (no confirm-only slimming this round).
- `create`/`modify` always include **tree** pack.
- Planner prompt is synced in this delivery: remove "pending=[] → immediate click_save" style advice; require final check after assistant.
- JS pass-through change is allowed: `toDisplayCandidates` (or recording dispatch) may add `phaseDescription`/`remark` to candidates; CHANGELOG records it under `src/services`.
- All existing behavior contracts preserved: assistant draft → `needs_agent` → final check → `click_save`; section scope; xpath-primary; no hardcoded business mappings.
- TDD: characterization red → green per task.
- Commits only when asked / as task steps.

## File Map

| File | Action |
|------|--------|
| `scripts/prompts/agent-core.md` | Create — role, JSON response, CRITICAL checklist (click_save/xpath/final-check/phase-boundary/section/special-element priority), phase boundary, business-data vs case-data, completion rules, navigation/login |
| `scripts/prompts/agent-tools-common.md` | Create — generic action one-liners (click/nav/login/dialog/menu/page_state/case_data/extract/wait) |
| `scripts/prompts/agent-tools-form.md` | Create — fill/select/radio/date, assistant, `needs_agent`/final-check, section, pending, save error codes, short example |
| `scripts/prompts/agent-tools-table.md` | Create — table row buttons/radio, icon buttons |
| `scripts/prompts/agent-tools-tree.md` | Create — `select_tree_option` details |
| `scripts/prompts/agent-prompt.md` | Modify — thin shim (full assembly via `{{include}}` or equivalent) |
| `scripts/prompts/agent-special-prompt.md` | Delete |
| `scripts/agent_utils.py` | Modify — add `build_agent_system_message(contract=None)`; keep `OVERRIDE_SYSTEM_MESSAGE` as full default |
| `scripts/session_runner.py` | Modify — pass `get_phase_intent(...)` to `build_agent_system_message` at Agent creation |
| `scripts/actions/_special_element.py` | Modify — enrich `format_special_element_hint` with description fields |
| `src/services/special-element-search-service.js` | Modify — `toDisplayCandidates` includes `phaseDescription`/`remark` |
| `scripts/prompts/planner-prompt.md` | Modify — sync save advice with final-check contract |
| `AGENTS.md` / `CLAUDE.md` | Modify — prompt table updates |
| `CHANGELOG.md` | Modify — Unreleased Changed |
| `scripts/characterization/characterize-agent-prompt-packs.py` | Create — pack assembly, length gates, no special-prompt refs |
| `scripts/characterization/characterize-special-element-hint.py` | Create — hint enrichment |
| `scripts/characterization/characterize-assistant-mission-context.py` | Modify — read assembled prompt instead of raw file |
| `scripts/characterization/characterize-phase-section-scope.py` | Modify — same |
| `scripts/characterization/characterize-xpath-primary-ops.py` | Modify — same |

---

### Task 1: `build_agent_system_message` assembler + pack skeletons

**Files:**
- Create: `scripts/prompts/agent-core.md`
- Create: `scripts/prompts/agent-tools-common.md`
- Create: `scripts/prompts/agent-tools-form.md`
- Create: `scripts/prompts/agent-tools-table.md`
- Create: `scripts/prompts/agent-tools-tree.md`
- Modify: `scripts/agent_utils.py`
- Test: `scripts/characterization/characterize-agent-prompt-packs.py`

**Interfaces:**
- Consumes: existing `agent-prompt.md` content (to be split)
- Produces: `build_agent_system_message(contract: dict | None) -> str`; pack files with content

- [ ] **Step 1: Write failing characterization**

```python
# scripts/characterization/characterize-agent-prompt-packs.py
def test_build_agent_system_message_assembles_by_mode():
    from scripts.agent_utils import build_agent_system_message
    nav = build_agent_system_message({"mode": "navigate"})
    assert "run_form_assistant" not in nav, "navigate should not include form assistant"
    assert "click_save" in nav, "core must keep click_save rule"
    form = build_agent_system_message({"mode": "create", "allow_form_assistant": True})
    assert "run_form_assistant" in form, "create must include form assistant"
    assert "needs_agent" in form, "create must include needs_agent"
    assert "select_tree_option" in form, "create must include tree"
    full = build_agent_system_message(None)
    assert "run_form_assistant" in full and "select_tree_option" in full, "full fallback"
```

Run: `python scripts/characterization/characterize-agent-prompt-packs.py`  
Expected: FAIL (`build_agent_system_message` not defined)

- [ ] **Step 2: Create pack files with content split from `agent-prompt.md`**

Split current `agent-prompt.md` (293 lines) into:

**`agent-core.md`** (~80 lines):
- Role + input + JSON response format (lines 1–15)
- CRITICAL checklist (new, ≤15 lines): click_save-only, xpath-primary, assistant-draft-final-check, phase-boundary, section-scope, special-element-priority
- 任务类型 table (lines 67–80)
- 阶段区块 section 收窄 (lines 114–120)
- 跨阶段数据流转 (lines 169–192)
- 业务场景与跨阶段上下文 (lines 226–255)
- 任务完成规则 (lines 257–267)
- CASE DATA 存储 (lines 268–281)
- 导航与登录 (lines 283–291)

**`agent-tools-common.md`** (~25 lines):
- 默认浏览器动作 (lines 18–24)
- Element UI 通用动作: close_dialog, close_notification, expand_all_el_tree, switch_tab, click_menu_item, wait_for_loading, get_page_state, save_case_data, read_case_data, use_special_element, check_field_value, verify_field_value, click_adjacent_button (lines 26–56, excluding form-specific)

**`agent-tools-form.md`** (~120 lines):
- 录制硬规则: click_save (lines 29–33)
- fill_form_field, select_option, click_radio, scroll_to_first_error, click_save (lines 35–40)
- 任务列表动作: run_form_assistant, scan_form_fields, scan_visible_fields, init_task_list, task_done, get_pending_tasks, sync_tasks_from_errors (lines 58–65)
- 表单填写助手 CRITICAL (lines 81–112)
- 表单字段规则 (lines 122–133)
- 任务列表规则 (lines 135–150)
- 主页面/抽屉示例 (lines 157–166)
- EL-NOTIFICATION 规则 (lines 194–197)
- EL-SELECT 规则 (lines 199–206)
- 校验与提交规则 (lines 208–224)

**`agent-tools-table.md`** (~15 lines):
- click_table_row_button, click_table_row_radio, click_icon_button (lines 46–48)

**`agent-tools-tree.md`** (~10 lines):
- select_tree_option (line 38)

- [ ] **Step 3: Implement `build_agent_system_message`**

```python
# scripts/agent_utils.py
_PACK_DIR = os.path.join(_SCRIPT_DIR, 'prompts')

def _read_pack(name: str) -> str:
    path = os.path.join(_PACK_DIR, name)
    with open(path, 'r', encoding='utf-8') as f:
        return f.read().strip()

def build_agent_system_message(contract: dict | None = None) -> str:
    """Assemble system prompt from packs based on phase intent contract."""
    mode = (contract or {}).get('mode') if contract else None
    allow_assistant = bool((contract or {}).get('allow_form_assistant')) if contract else False

    packs = ['agent-core.md', 'agent-tools-common.md']

    # Table tools for navigate/query/introduce (row selection, icon buttons)
    if mode in ('navigate', 'query', 'introduce_pick', 'login', None):
        packs.append('agent-tools-table.md')

    # Form pack for introduce_pick and create/modify
    if mode in ('introduce_pick', 'create', 'modify') or allow_assistant:
        packs.append('agent-tools-form.md')

    # Tree pack for create/modify (default)
    if mode in ('create', 'modify'):
        packs.append('agent-tools-tree.md')

    # Full fallback: unknown mode or None contract
    if mode not in ('login', 'navigate', 'query', 'introduce_pick', 'create', 'modify'):
        packs = ['agent-core.md', 'agent-tools-common.md', 'agent-tools-form.md',
                 'agent-tools-table.md', 'agent-tools-tree.md']

    parts = [_read_pack(p) for p in packs]
    return '\n\n'.join(parts)

# Keep backward-compatible default
OVERRIDE_SYSTEM_MESSAGE = build_agent_system_message(None)
```

- [ ] **Step 4: Run characterization — PASS**

Run: `python scripts/characterization/characterize-agent-prompt-packs.py`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/prompts/agent-core.md scripts/prompts/agent-tools-*.md scripts/agent_utils.py scripts/characterization/characterize-agent-prompt-packs.py
git commit -m "feat: agent prompt pack assembler + per-phase pack skeletons"
```

---

### Task 2: Wire `session_runner` to use contract-based assembly

**Files:**
- Modify: `scripts/session_runner.py:681-690`
- Test: `scripts/characterization/characterize-agent-prompt-packs.py`

**Interfaces:**
- Consumes: `build_agent_system_message` from Task 1; `get_phase_intent` from `scripts/actions/_phase_intent.py`
- Produces: Agent created with contract-specific system message

- [ ] **Step 1: Write failing characterization**

```python
def test_session_runner_uses_contract_assembly():
    src = (ROOT / "scripts/session_runner.py").read_text(encoding="utf-8")
    assert "build_agent_system_message" in src, "session_runner imports assembler"
    assert "get_phase_intent" in src, "session_runner reads phase intent"
    # Ensure OVERRIDE_SYSTEM_MESSAGE is not used directly in Agent creation
    agent_block = src.split("agent = Agent(", 1)[1][:500]
    assert "OVERRIDE_SYSTEM_MESSAGE" not in agent_block, "Agent uses contract assembly"
```

Run: `python scripts/characterization/characterize-agent-prompt-packs.py`  
Expected: FAIL

- [ ] **Step 2: Modify `session_runner.py`**

```python
# At top imports
from .agent_utils import (
    build_agent_system_message,  # add
    OVERRIDE_SYSTEM_MESSAGE,      # keep for fallback
    PLANNER_SYSTEM_PROMPT,
    # ...
)

# In Agent creation block (~line 681)
from .actions._phase_intent import get_phase_intent
contract = get_phase_intent(case_data_ref) if case_data_ref else None
system_msg = build_agent_system_message(contract)

agent = Agent(
    task=agent_task, llm=llm, controller=controller, browser_context=browser_context,
    override_system_message=system_msg,  # was OVERRIDE_SYSTEM_MESSAGE
    use_vision=False, enable_memory=False,
    max_failures=5, retry_delay=10,
    planner_llm=llm, planner_interval=3,
    extend_planner_system_message=PLANNER_SYSTEM_PROMPT,
    register_new_step_callback=make_step_callback(step_index * 100),
    register_done_callback=make_done_callback(output_path),
)
```

- [ ] **Step 3: Run characterization — PASS**

- [ ] **Step 4: Commit**

```bash
git add scripts/session_runner.py scripts/characterization/characterize-agent-prompt-packs.py
git commit -m "feat: session_runner assembles system prompt by phase contract"
```

---

### Task 3: Convert `agent-prompt.md` to thin shim; delete `agent-special-prompt.md`

**Files:**
- Modify: `scripts/prompts/agent-prompt.md`
- Delete: `scripts/prompts/agent-special-prompt.md`
- Modify: `scripts/characterization/characterize-assistant-mission-context.py`
- Modify: `scripts/characterization/characterize-phase-section-scope.py`
- Modify: `scripts/characterization/characterize-xpath-primary-ops.py`
- Test: `scripts/characterization/characterize-agent-prompt-packs.py`

**Interfaces:**
- Consumes: pack files from Task 1
- Produces: shim file; updated characterization reading assembled prompt

- [ ] **Step 1: Write failing characterization**

```python
def test_agent_prompt_shim_is_full_assembly():
    from scripts.agent_utils import build_agent_system_message
    shim = (ROOT / "scripts/prompts/agent-prompt.md").read_text(encoding="utf-8")
    full = build_agent_system_message(None)
    # Shim should contain all pack content (via includes or inline)
    assert "run_form_assistant" in shim, "shim must include form assistant"
    assert "select_tree_option" in shim, "shim must include tree"
    assert "agent-special-prompt" not in shim, "no special-prompt include"
    # Length should be close to full assembly
    assert len(shim) >= len(full) * 0.9, "shim approximates full assembly"

def test_special_prompt_deleted():
    assert not (ROOT / "scripts/prompts/agent-special-prompt.md").exists(), "special prompt deleted"
```

Run: `python scripts/characterization/characterize-agent-prompt-packs.py`  
Expected: FAIL

- [ ] **Step 2: Rewrite `agent-prompt.md` as shim**

Option A (include-based, preferred):
```markdown
{{prompts/agent-core.md}}

{{prompts/agent-tools-common.md}}

{{prompts/agent-tools-form.md}}

{{prompts/agent-tools-table.md}}

{{prompts/agent-tools-tree.md}}
```

Option B (generated): Run a small script to inline all packs into `agent-prompt.md`.

- [ ] **Step 3: Delete `agent-special-prompt.md`**

```bash
git rm scripts/prompts/agent-special-prompt.md
```

- [ ] **Step 4: Update existing characterization to read assembled prompt**

For `characterize-assistant-mission-context.py`, `characterize-phase-section-scope.py`, `characterize-xpath-primary-ops.py`:

```python
# Replace direct file read with assembled prompt
from scripts.agent_utils import build_agent_system_message
p = build_agent_system_message({"mode": "create", "allow_form_assistant": True})
# or for full: build_agent_system_message(None)
```

- [ ] **Step 5: Run all characterization — PASS**

```bash
python scripts/characterization/characterize-agent-prompt-packs.py
python scripts/characterization/characterize-assistant-mission-context.py
python scripts/characterization/characterize-phase-section-scope.py
python scripts/characterization/characterize-xpath-primary-ops.py
```

- [ ] **Step 6: Commit**

```bash
git add scripts/prompts/agent-prompt.md scripts/prompts/agent-special-prompt.md scripts/characterization/
git commit -m "refactor: agent-prompt.md as shim; delete agent-special-prompt.md"
```

---

### Task 4: Enrich special-element hint + JS pass-through

**Files:**
- Modify: `scripts/actions/_special_element.py:9-32`
- Modify: `src/services/special-element-search-service.js:194-207`
- Test: `scripts/characterization/characterize-special-element-hint.py`

**Interfaces:**
- Consumes: candidate dicts with optional `phaseDescription`/`remark`/`stepSummary`
- Produces: enriched hint text; JS pass-through includes new fields

- [ ] **Step 1: Write failing characterization**

```python
# scripts/characterization/characterize-special-element-hint.py
def test_hint_includes_description_when_present():
    from scripts.actions._special_element import format_special_element_hint
    store = {
        "se-1": {
            "name": "法人引入",
            "dictLabel": "引入",
            "stepCount": 5,
            "matchReasons": ["标签匹配: 引入"],
            "phaseDescription": "法定代表人引入弹窗",
            "remark": "需先搜索客户",
        }
    }
    hint = format_special_element_hint(store)
    assert "法人引入" in hint
    assert "法定代表人引入弹窗" in hint, "phaseDescription in hint"
    assert "需先搜索客户" in hint, "remark in hint"
    assert "use_special_element" in hint, "guidance present"

def test_hint_empty_store():
    from scripts.actions._special_element import format_special_element_hint
    assert format_special_element_hint({}) == ""
    assert format_special_element_hint(None) == ""
```

Run: `python scripts/characterization/characterize-special-element-hint.py`  
Expected: FAIL

- [ ] **Step 2: Enrich `format_special_element_hint`**

```python
# scripts/actions/_special_element.py
def format_special_element_hint(candidates_store: dict | None) -> str:
    """Enriched prompt hint listing current-phase special-element candidates."""
    if not candidates_store:
        return ''
    lines = []
    for cid, c in candidates_store.items():
        name = c.get('name') or cid
        label = c.get('dictLabel') or c.get('dict_label') or ''
        reasons = c.get('matchReasons') or c.get('match_reasons') or []
        step_count = c.get('stepCount') or c.get('step_count') or len(c.get('steps') or [])
        reason_txt = '；'.join(str(r) for r in reasons[:5]) if reasons else ''
        desc = c.get('phaseDescription') or c.get('phase_description') or ''
        remark = c.get('remark') or ''
        step_summary = c.get('stepSummary') or c.get('step_summary') or ''
        parts = [f"- id={cid} name={name}"]
        if label:
            parts.append(f" tag={label}")
        parts.append(f" steps={step_count}")
        if reason_txt:
            parts.append(f" reasons={reason_txt}")
        if desc:
            parts.append(f" desc={desc}")
        if remark:
            parts.append(f" remark={remark}")
        if step_summary:
            parts.append(f" summary={step_summary}")
        lines.append(''.join(parts))
    if not lines:
        return ''
    return (
        '\n\n【特殊元素库候选 — 仅可对下列 id 调用 use_special_element；'
        '不要编造未列出的 id；页面状态匹配时优先复用，不要手写逐步引入】\n'
        + '\n'.join(lines)
    )
```

- [ ] **Step 3: JS pass-through — add `phaseDescription`/`remark`**

```javascript
// src/services/special-element-search-service.js
export function toDisplayCandidates(candidates = []) {
  return candidates.map((c) => ({
    id: c.id,
    name: c.name,
    dictLabel: c.dictLabel,
    dictValue: c.dictValue,
    tagDictCode: c.tagDictCode,
    stepCount: c.stepCount,
    score: c.score,
    matchReasons: c.matchReasons,
    stepSummary: c.stepSummary,
    phaseDescription: c.phaseDescription,  // add
    remark: c.remark,                      // add
  }));
}
```

- [ ] **Step 4: Run characterization — PASS**

```bash
python scripts/characterization/characterize-special-element-hint.py
```

- [ ] **Step 5: Commit**

```bash
git add scripts/actions/_special_element.py src/services/special-element-search-service.js scripts/characterization/characterize-special-element-hint.py
git commit -m "feat: enrich special-element hint with phaseDescription/remark"
```

---

### Task 5: Sync planner-prompt with final-check contract

**Files:**
- Modify: `scripts/prompts/planner-prompt.md`
- Test: `scripts/characterization/characterize-agent-prompt-packs.py`

**Interfaces:**
- Consumes: existing planner prompt
- Produces: updated save advice aligned with final-check

- [ ] **Step 1: Write failing characterization**

```python
def test_planner_synced_with_final_check():
    p = (ROOT / "scripts/prompts/planner-prompt.md").read_text(encoding="utf-8")
    assert "终检" in p or "最终检查" in p or "final check" in p.lower(), "planner mentions final check"
    assert "pending=[]" not in p or "click_save" not in p.split("pending=[]")[0], "no bare pending-empty-save"
```

Run: `python scripts/characterization/characterize-agent-prompt-packs.py`  
Expected: FAIL

- [ ] **Step 2: Update planner-prompt.md**

Key changes:
- Signal 3 (`get_pending_tasks returns pending=[]`): add "If the Agent used `run_form_assistant`, verify it handled `needs_agent` and performed final check before advising `click_save()`."
- Signal 4: keep special-element advice, add final-check reminder
- Domain vocabulary: add `needs_agent` entry

- [ ] **Step 3: Run characterization — PASS**

- [ ] **Step 4: Commit**

```bash
git add scripts/prompts/planner-prompt.md scripts/characterization/characterize-agent-prompt-packs.py
git commit -m "docs: sync planner-prompt with final-check contract"
```

---

### Task 6: Update AGENTS.md / CLAUDE.md prompt tables

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update prompt tables**

Replace `agent-special-prompt.md` row with pack files:

```markdown
| `scripts/prompts/agent-core.md` | Core role, JSON, CRITICAL checklist, phase boundary, case-data |
| `scripts/prompts/agent-tools-common.md` | Generic browser/Element UI actions |
| `scripts/prompts/agent-tools-form.md` | Form fill/select/assistant/needs_agent/final-check/section |
| `scripts/prompts/agent-tools-table.md` | Table row buttons, icon buttons |
| `scripts/prompts/agent-tools-tree.md` | Tree selector details |
| `scripts/prompts/agent-prompt.md` | Shim: full assembly (backward compat) |
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md CLAUDE.md
git commit -m "docs: update prompt tables for pack structure"
```

---

### Task 7: CHANGELOG + full regression

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: CHANGELOG entry**

```markdown
- 2026-08-08: **Agent prompt 分册装配 + 特殊元素按需 hint：** `agent-prompt.md` 拆为 core + tools-common/form/table/tree；`build_agent_system_message(contract)` 按 `_phase_intent.mode` 装配；`session_runner` 创建 Agent 时传入合约。删除 `agent-special-prompt.md`（内容不迁移）；`format_special_element_hint` 加厚 `phaseDescription`/`remark`/`stepSummary`；`toDisplayCandidates` 透传新字段。Planner 同步终检后保存口径。
  影响范围：Agent system prompt 装配、特殊元素 hint、planner-prompt、表征。
  文件：scripts/prompts/agent-*.md, scripts/agent_utils.py, scripts/session_runner.py, scripts/actions/_special_element.py, src/services/special-element-search-service.js, scripts/prompts/planner-prompt.md, scripts/characterization/characterize-agent-prompt-packs.py, scripts/characterization/characterize-special-element-hint.py, AGENTS.md, CLAUDE.md
  Python 同步提示：无（scripts 子进程）；若 Python 控制面复述 Agent 工具 schema 需对齐分册结构。
```

- [ ] **Step 2: Full regression**

```bash
python scripts/characterization/characterize-agent-prompt-packs.py
python scripts/characterization/characterize-special-element-hint.py
python scripts/characterization/characterize-assistant-mission-context.py
python scripts/characterization/characterize-form-assistant.py
python scripts/characterization/characterize-phase-section-scope.py
python scripts/characterization/characterize-xpath-primary-ops.py
```

Expected: all OK

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG agent prompt packs + special-element hint"
```

---

## Spec Coverage Checklist

| Spec requirement | Task |
|------------------|------|
| Pack layout (core/common/form/table/tree) | 1 |
| Assembly matrix by mode | 1, 2 |
| `agent-prompt.md` shim | 3 |
| Delete `agent-special-prompt.md` | 3 |
| Hint enrichment + JS pass-through | 4 |
| Planner sync | 5 |
| AGENTS/CLAUDE update | 6 |
| CHANGELOG + regression | 7 |
| Fallback = full | 1 (assembler logic) |
| introduce_pick = full form pack | 1 (assembler logic) |
| create/modify default tree | 1 (assembler logic) |

## Rollout Checklist (from spec)

- [ ] Diff review: compare assembled full prompt vs original `agent-prompt.md` for missing behavioral contracts
- [ ] Log pack names + char lengths per phase for real-run comparison
