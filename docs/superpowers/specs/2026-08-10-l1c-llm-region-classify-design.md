# L1c LLM region classify (+ L1d cache) — Design

**Date:** 2026-08-10  
**Status:** Approved 2026-08-11 — user chose implement first; plan `docs/superpowers/plans/2026-08-11-l1c-llm-region-classify.md`  
**Backlog ID:** **L1c-LLM** (+ **L1d-cache** in same cut)  
**Related:** [fullpage visible controls §Dynamic L1](2026-08-10-fullpage-visible-controls-scan-design.md); [resolve ambiguous L1 preview](2026-08-10-resolve-ambiguous-section-preview-design.md); [AG-fullpage inventory](2026-08-10-auto-grab-fullpage-inventory-design.md)

## Product decisions (locked)

| # | Decision |
|---|----------|
| 1 | **控制面**跑分类（非 Agent 工具、非 executor 内嵌 LLM） |
| 2 | 触发：**规则 confidence &lt; 0.7** **或** `role ∈ {other, custom:*}` |
| 3 | 消费者：**scan_editable_summary / fullpage** 与 **resolve-element**（inventory/歧义）共用同一服务 |
| 4 | **同步**等待分类结果写回后再返回；同刀含 **L1d** 缓存 |
| 5 | 路径 **甲**：共享 `classifyRegions(cards, { systemId })` |
| 6 | 算法 **B**：L1c 失败/超时/非法输出 **不得删 L2 / matches** |
| 7 | 灰度：`L1C_LLM`（默认关）→ 关则仅规则 + L1d 读 |

## Goals

1. 低置信 / 兜底区域用 **feature card → LLM JSON** 提升 `region_role` / `region_label`。  
2. **L1d**：`systemId` + `featureSignature` 缓存，避免同宿主逐步重问。  
3. 一处策略服务，scan 与 resolve 双接入。  
4. 不喂 raw HTML；不因分类失败丢控件。

## Non-goals

- Vision / 截图裁剪（P2+）  
- 每候选每步强制 LLM  
- 用 `region_*` 替代 `xpath_smart` 回放  
- Agent 侧独立分类工具作为主路径  

## §1 — Feature card / 触发 / L1d

### Feature card (L1b, CDP)

| Field | Notes |
|-------|--------|
| `signature` materials | Normalized inputs to hash (see L1d) |
| `tag` / `classTokens[]` | Truncated token list |
| `role` / `aria` / `title` | Truncated visible / a11y title |
| `band` | `top` \| `side` \| `center` \| `bottom` |
| `childCounts` | Counts by operable kind |
| `flags` | `scrollable` `overlay` `tableLike` `menuLike` `titledPanel` |
| `ruleRole` / `ruleConfidence` | Deterministic pre-classify |

**Never send:** raw HTML, full-page screenshots.

### Trigger (into LLM batch)

After rules (and cache miss): if `confidence < 0.7` **or** `role` is `other` or starts with `custom:` → enqueue for LLM.

### LLM output (strict JSON)

```json
{ "role": "section|main|overlay|…|custom:<slug>", "label": "…", "confidence": 0.0, "rationale": "…" }
```

Invalid → keep rule / `other`. Never drop L2.

### L1d cache key

`systemId` + `featureSignature` where signature hashes normalized  
`classTokens + title + band + flags + childCounts`  
→ stores `{ role, label, confidence }`. Hit skips LLM.

### Batching

Per request: merge eligible cards into **one** LLM call (cap **12**). Timeout → rule fallback per card.

### Flag

`L1C_LLM=true` enables model calls; default off → rules + L1d read only.

## §2 — Wire resolve / scan + failure

```text
CDP: L1a → L1b cards (+ ruleRole/confidence)
  → CP classifyRegions(cards, { systemId })
       → L1d lookup → rules → batch LLM if needed → L1d write
  → write region_role / region_id / region_label / confidence
  → assign / refresh L2→L1 metadata on matches or summary
```

| Consumer | Behavior |
|----------|----------|
| `resolve-element` | Classify before finalizing `matches[].preview` / element `region_*` |
| `scan_editable_summary` / fullpage | Classify before emitting section / region fields |

| Failure | Behavior |
|---------|----------|
| Flag off | Rules + L1d read |
| LLM timeout / error | Keep rule result; set fallback_reason |
| Bad JSON / role | Discard model; keep rule |
| Cache miss + flag off | Rule only |

## Seed roles

`shell-header` | `shell-aside` | `shell-tabs` | `main` | `section` | `table` | `overlay` | `menu` | `custom:*` | `page` | `other`

## Acceptance

1. Novel wrapper → `custom:*` or `other` with non-empty card; L2 retained.  
2. Same `systemId` + signature twice → second call no LLM (L1d).  
3. LLM down → resolve/scan still succeed; labels may be coarse.  
4. Characterization: card schema, trigger, cache key, no L2 drop.  
5. With `L1C_LLM=false`, no outbound classify chat.

## Implementation sketch (not a plan)

- CDP: emit feature cards alongside `assignRegion` (shared helpers).  
- `src/services/region-classify.js` (+ optional DAO/table for L1d).  
- Hook: resolve enrich path; scan summary assembly.  
- config / `.env.example`: `L1C_LLM`.  
- CHANGELOG + Python sync tip if API/env surface changes.

## Open points (non-blocking)

- L1d storage: in-memory TTL vs MySQL table — pick in plan.  
- Exact confidence calibration for Element/TSSC rules — tune in implementation.
