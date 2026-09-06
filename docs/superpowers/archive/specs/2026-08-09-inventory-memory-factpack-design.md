# Design: T4-P2 inventory summary → memory Fact Pack (bypass)

**Date:** 2026-08-09  
**Status:** Implemented — plan at `docs/superpowers/plans/2026-08-09-inventory-memory-factpack.md`  
**Backlog:** T4-P2  
**Related:** `scan_editable_summary` (T4-P0/P1)；`docs/AI记忆系统初始化进度.md`；三大问题（禁放大写入）

## Problem

Agent 已有只读 `scan_editable_summary`，但摘要不进入记忆事件流 / `memory_fact`，Fact Pack 无法利用「当前可见可编辑」短事实。需要在**不阻塞录制**的前提下旁路摄取。

## Goals

1. 每次 `scan_editable_summary` **成功**时，旁路上报一条记忆事件 + **少量聚合 facts**。
2. 失败 / writer 关闭时**不影响** action 返回值与主链路耗时（try/except + 现有队列）。
3. 写开关 = `AI_MEMORY_EVENTS`；读/注入仍只看 `AI_MEMORY_FACT_PACK`（本切片不改读默认）。
4. 造型与上报抽到 **小 helper**，`_form.py` 只调一行。

## Non-goals

- 阶段开始自动 inventory
- 每字段一条 fact
- 修改 `retrieveFactPack` 算法或默认打开 Fact Pack 注入
- 阻塞 HTTP / 同步等待 ingest ACK
- DB schema 变更

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Trigger | A — only on successful `scan_editable_summary` |
| Fact granularity | A — aggregate facts under `entity=form_inventory` |
| Flags | C — write via `AI_MEMORY_EVENTS`; read still `AI_MEMORY_FACT_PACK` |
| Implementation | 1 — emit inside action path via small helper |
| Helper location | `scripts/memory/inventory_emit.py` |

## Architecture

```
scan_editable_summary()
  → multi-root scan → build_editable_summary → summary dict
  → emit_editable_summary_memory(summary, phase_number=…)  # best-effort
  → return json.dumps(summary)
```

### Event

- `event_type`: `form_state` (already in `KNOWN_EVENT_TYPES`)
- `payload`: truncated summary fields — `container`, `scope`, `total`, `filled`, `pending`, `pending_labels` (≤20 / ≤500 chars joined), `buttons` as list of `{text,section}` capped to 15 (or compact string ≤400 chars — prefer list in payload, compact string in fact value)

### Facts (`entity=form_inventory`)

| attribute | value | source | stance | factType |
|-----------|-------|--------|--------|----------|
| `container` | container id string | `page` | `inferred` | `page_state` |
| `pending_count` | decimal string | `page` | `inferred` | `page_state` |
| `pending_labels` | comma-joined truncated labels | `page` | `inferred` | `page_state` |
| `buttons` | `text@section` comma-joined truncated | `page` | `inferred` | `page_state` |

### Helper API

```python
def emit_editable_summary_memory(summary: dict, *, phase_number=None) -> None:
    """Best-effort; never raises to caller."""
```

Uses `emit_memory_event` from `scripts.memory.writer`.

### Truncation constants

- `PENDING_LABEL_MAX_ITEMS = 20`
- `PENDING_LABEL_MAX_CHARS = 500`
- `BUTTON_MAX_ITEMS = 15`
- `BUTTON_MAX_CHARS = 400`

### Phase

Pass `phase_number` from case_data_store / recorder current phase when available; else omit/`None`.

## Verification

- Characterization: helper transforms fake summary → expected fact attributes; `_form.py` calls helper; helper body uses `emit_memory_event`
- No autofill / no task_list writes (regression on existing scan_editable tests)
- Optional: unit-level mock that emit is invoked (source assert sufficient for P2)

## Phasing note

After P2, Fact Pack **injection** still requires `AI_MEMORY_FACT_PACK=true` to surface inventory facts to the model — writing alone enables audit/retrieve APIs.
