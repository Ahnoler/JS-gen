# 流程卡指导 draft-traj propose 切分 — 设计

> 日期：2026-09-09  
> 状态：实现中  
> 计划：[`plans/2026-09-09-flow-card-guided-propose.md`](../plans/2026-09-09-flow-card-guided-propose.md)  
> 决策来源：用户确认「按流程卡切原子」；流程卡为需求+真页调研沉淀，作粒度主依据；无命中卡时降级写步骤原子并标记  
> 相关：`specs/2026-09-07-req-to-draft-traj-design.md` §3 粒度；`specs/2026-09-08-atom-record-flow-card-recall-design.md`（prepare 注入，本版改 propose 切分）；`scripts/prompts/req-draft-traj-atomize-prompt.md`；`src/services/req-draft-traj/propose.js`；`data/kb/flows/*.json`

## 1. 目标

`draft-traj/propose` 生成的候选原子粒度，应以 **真实流程卡**（`data/kb/flows/*.json`）为主依据，而不是「through-chains 上每一个命中写操作词的步骤各成一条」。

成功终点（本版）：

- 有匹配流程卡时：一条草稿 ≈ 卡上一段 **可录制闭环**（常见：进页 → 填/核 → 保存/提交）；同页「维护概况 + 联网核查 + 保存」若同属一闭环，稳定合成 **1** 条（或按卡 nodes 合理的 1～2 条），不再默认拆成 4 条写步骤原子。
- atom 上稳定带真实 `suggestedFlowRef`（stem）与可选 `suggestedNodeId`；并有可观测的「是否卡指导」标记。
- 无命中卡 / 映射失败：降级为现有写步骤原子切分，行为接近现状，且标记为非卡指导（不静默）。
- 出处仍来自作业区 `through-chains` + chapters；流程卡 **不** 替代出处字段。

## 2. 范围

### In

- Propose 流水线：**先召回相关流程卡 → 再 atomize**（卡摘要进 prompt / 映射输入）。
- 改写 `req-draft-traj-atomize-prompt.md`：以卡闭环为切分单元；允许同闭环内多步（含多个非独立「维护/校验」类步骤）进同一 atom。
- 调整 `propose.js` 守卫：`multi_write_atom` 在「单卡单闭环」下放宽；独立落库闭环仍拆开；入口-only 继续 fold。
- 确定性 fallback（LLM 失败）：优先按卡 nodes/闭环切；无卡时再走现有「一写一步一 atom」。
- API/缓存原子载荷：增加或明确 `flowGuided`（或等价布尔）+ 既有 `suggestedFlowRef` / `suggestedNodeId`。
- Characterization：有卡模块（如对公建档相关）粒度用例；无卡降级用例；出处仍齐全。
- 文档：本 spec + 实现计划；必要时一句更新 `req-to-draft-traj` 粒度原则交叉引用。

### Out

- 真 SSE propose、向导假流式/进度条修复（另单）。
- 自动撰写/补全缺失流程卡；湿测协议改写。
- 「一张卡强制一条草稿」（已否决）。
- 改变 prepare/record 整卡模板注入契约（可保留；本版只把切分提前到 propose）。
- Vue 向导大改（若仅展示 `flowGuided` 可后补；本版不强制 SPA）。

## 3. 原则

| 角色 | 依据 |
|------|------|
| **粒度** | 流程卡 nodes / 可录制闭环（真页调研沉淀） |
| **出处** | through-chains + chapters（不变） |
| **录制前言** | 仍可由 prepare 按 `kb_flow_ref` 注入最新卡文案（既有设计） |

禁止默认把整条业务主链打成一笔（多卡或多独立闭环 → 多 atom）。

## 4. Propose 流水线

```
through-chains.md
       │
       ├─► 召回相关流程卡（module / 菜单 / 关键词 / ZJJK；复用并收紧 match 面）
       │         │
       │         ▼
       │   卡摘要（stem、flow、nodes[].id|page|enter|buttons|fields、preconditions 短列表）
       │
       ▼
atomize（LLM）：chains + 卡摘要
       │
       ├─ 成功且挂上 flowRef → materialize（flowGuided=true）
       │
       └─ 无卡 / LLM 失败 / 映射失败 → fallback 写步骤原子（flowGuided=false）
       │
       ▼
atoms[] + rejected[] + propose cache
```

### 4.1 召回

- 输入：moduleKey、chains 标题/步骤文案、ZJJK。
- 输出：0～N 张相关卡（宜上限，避免整库塞进 prompt；建议按相关度取 Top-K，K 小例如 3～8）。
- 无卡：直接走 §5 降级，不调用「卡指导」atomize 路径（或调用但允许空卡摘要）。

### 4.2 Atomize 契约（LLM）

每个 atom 建议字段（在现有基础上强化）：

- `chainId`、`stepIndexes`、`title`、`taskDraft`、`phaseHints`、`pageCodes`、`suggestedFunctionId`
- **`flowRef`**：流程卡 stem（必填于卡指导路径；与文件名一致）
- **`nodeId`**：可选，卡内 `nodes[].id`
- 同闭环可含多个 stepIndexes；`taskDraft` 按卡 enter/fields/buttons 组织步骤，出处占位仍 `<sourceDoc>` / `<sourceChapter>`

### 4.3 物化与守卫

- 校验 `flowRef` 对应卡文件存在；无效 → rejected 或降级该条。
- **单卡单闭环**：允许多个写操作词步骤进入同一 atom（放宽 `multi_write_atom`），闭环边界以卡 node / 明确落库点（保存/提交且结束本段）为准。
- **跨闭环 / 跨卡**：仍禁止合并。
- 入口-only（开抽屉无保存）继续并入下一闭环（既有 `foldEntryOnlyLlmAtoms`）。
- 出处校验不变：缺出处不得进 `atoms`。

## 5. 无卡降级

- 触发：召回空、卡摘要不可用、LLM 未返回有效挂卡 atom、确定性卡映射失败。
- 行为：现有 `buildFallbackLlmAtoms` / 写步骤切分（含 entry fold）。
- 标记：产出 atom `flowGuided: false`（`suggestedFlowRef` 仍可事后轻量召回填充，但不改变已切粒度）。
- 可观测：propose 观察日志增加 `flowGuidedCount` / `fallbackCount`（或等价）。

## 6. 与既有「录制召回」设计的关系

| 阶段 | 2026-09-08 录制召回 | 本版 |
|------|---------------------|------|
| Propose 切分 | 写步骤为主，事后挂 ref | **卡指导切分**，ref 随切分写入 |
| taskDraft | 短任务，不写长前置 | 仍短任务；结构对齐卡闭环，不膨胀整卡 preconditions 长文 |
| Prepare/record | 注入【流程卡模板】 | **保持**；改卡文件无需重 propose 即可刷新注入文案 |

## 7. API / 载荷

- Propose 200 `atoms[]` 增量（建议）：
  - `flowGuided: boolean`
  - 既有 `suggestedFlowRef` / `suggestedNodeId`（卡路径下应尽量非空）
- 缓存 `draft-traj-propose-cache`：同字段一并写入，避免旧缓存无标记时误判；**bump `cacheVersion`**（若已有版本字段）或依赖 sourceHash+逻辑版本使旧缓存失效。
- Commit：继续把 flow ref 写入 trajectory 列（既有）；不因 `flowGuided` 改变 commit 门闩。

## 8. 测试与验收

- Characterization：构造「同页多写词步骤 + 命中建档类卡」→ 期望合并为 1（或 nodes 规定的条数），且 `flowGuided=true`、stem 真实。
- 无卡夹具 → `flowGuided=false`，粒度接近旧行为。
- 湿测（人工）：customer-corp / 对公客户建档作业区重新 propose（清缓存或重启后强制重算）→ 「草稿→信贷潜在客户」同页四步不再稳定拆成四条。

## 9. 风险

| 风险 | 缓解 |
|------|------|
| 卡 nodes 过粗/过细 | 闭环定义写进 prompt；湿测抽查后可调卡而非只调正则 |
| Prompt 塞太多卡 | Top-K + 摘要字段白名单 |
| 旧 propose cache 仍细拆 | 版本/哈希失效；文档要求重新生成 |
| 与「禁止多写合并」旧文案冲突 | 本 spec 显式废止该条在卡闭环内的效力；更新 atomize prompt |

## 10. 决策记录

- 方案 **A（卡优先映射）** + 无卡 **降级写步骤并标记**（用户 2026-09-09）。
- 否决：一卡一草稿；否决：仅事后折叠写步骤。
- 粒度口号：**按流程卡切原子**（可录制闭环 / node 段），出处仍 chains。
