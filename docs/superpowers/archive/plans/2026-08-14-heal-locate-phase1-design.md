# Heal-Locate Optimization Phase 1 Design

> **状态（2026-08-15）**：本文档已由 `2026-08-15-heal-locate-handoff-plan.md` 整理承接；设计决策以 handoff 计划 §3 为准，本文保留为设计底稿。


## Phase 0 Findings

### Current Flow

```text
Replay
 ↓
Action Execute
 ↓
Failure
 ↓
runHealStep()
 ↓
Temporary Instruction
 ↓
Agent
```

Current issues:

- Heal has no Runtime Mode.
- Failure has no semantic classification.
- Prompt cannot consume Recovery Context.

## Phase 1 Target Architecture

```text
Action Failure
 ↓
Missing Reason Analyzer
 ↓
Decision Policy
 ↓
Heal Context Builder
 ↓
Phase Contract
 ↓
Prompt Assembly
 ↓
Browser Use Agent
```

## P1.1 Heal Mode Contract

Goal: make Heal a formal Agent Mode.

```json
{
  "mode":"heal",
  "heal":{
    "scope":"step",
    "strategy":"visibility_recovery",
    "reason":{
      "category":"not_visible",
      "confidence":0.91,
      "evidence":[]
    },
    "target":{
      "action":"fill",
      "locator":"target"
    }
  }
}
```

## Runtime Separation

Prompt Context:

```json
{"mode":"heal","heal":{"strategy":"visibility_recovery"}}
```

Runtime Context:

```json
{"retry_count":1,"max_steps":3}
```

二者分离。

## P1.2 Missing Reason Analyzer

Input:

Action Result + Browser State + Trajectory History

Output:

```json
{"category":"not_visible","confidence":0.85,"evidence":[],"suggested_action":"heal"}
```

## Reason Categories

```text
conditional_absent
not_visible
not_loaded
changed_structure
permission_blocked
business_locked
unknown
```

Analyzer MVP:

```text
Rule Engine
+
Browser State
+
History
```

## P1.3 Decision Policy

| Reason | Action |
|---|---|
| conditional_absent | skip |
| business_locked | skip |
| not_loaded | retry |
| not_visible | heal |
| changed_structure | repair |
| unknown | fail |

## P1.4 Heal Context Builder

MissingReason -> Heal Contract

## P1.5 Prompt Assembly

Existing:

```python
build_agent_system_message(contract)
```

Add:

```python
if contract.mode=="heal":
    packs.append("agent-tools-heal.md")
```

New prompt pack:

```text
scripts/prompts/agent-tools-heal.md
```

Only defines Recovery Mode Rules.

# Next Execution

1. Locate runHealStep()
2. Confirm parameters and heal_type source
3. Locate apply_phase_contract()
4. Locate build_agent_system_message()
5. Build minimal loop:

Failure
 ↓
mode=heal Contract
 ↓
Agent
 ↓
Recovery Action

Status:

[x] Architecture design
[x] Schema design
[x] Migration plan
[x] File scope
[x] Design document written

Next:

[ ] Locate runHealStep
[ ] Implement Heal Contract MVP
[ ] Missing Reason Analyzer MVP
