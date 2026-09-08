# 原子录制召回完整流程卡（起点指引注入）— 设计

> 日期：2026-09-08  
> 状态：待用户审阅 spec 后进入计划/实现  
> 决策来源：用户确认「原子 = 流程卡中的一段」；注入时机采用 **prepare/record 召回**（非 propose 写死正文）；落库采用 **方案 A：trajectory 独立列**  
> 相关：`specs/2026-09-07-req-to-draft-traj-design.md`；`src/services/kb-flow-cards.js`；`data/kb/flows/*.json`

## 1. 目标

原子化组件交易录制，是为了录制**完整流程卡中的某一段**操作。录制时应：

1. **召回完整流程卡**作为模板（菜单、前置条件、节点 enter）；
2. 根据本原子命中的卡内节点，拼出 **「如何站到本段起点」** 指引；
3. 将该指引注入 **prepare / record** 时的录制前言（首阶段 / agent preamble），不覆盖原子短任务本身。

成功终点（本版）：

- 带 `req_atom_key`（或显式 `kb_flow_ref`）的草稿交易，在 prepare/record 时能注入最新流程卡模板 + 起点指引；
- propose 的 `taskDraft` **不**膨胀为长前置文案；
- 无命中 / 无卡 → 行为与今相同（不挡录制）。

## 2. 范围

### In

- `trajectory` 新增可空列：`kb_flow_ref`、`kb_flow_node_id`（方案 A）。
- propose：轻量匹配，原子上返回可选 `suggestedFlowRef` / `suggestedNodeId`（不写长文进 `taskDraft`）。
- commit：把建议引用（或显式 override）写入上述两列。
- 扩展 `kb-flow-cards`：按 ref 读取**整卡**（现有 `listFlowCards` 仅摘要字段，不够）。
- prepare（及 record 前路径）：读最新卡 → 拼装 `flowTemplateHint` → 注入录制前言。
- 可选只读预览 API：与 prepare 同一拼装函数，供 SPA 向导展示（不落库、不开录）。
- api-docs + characterization（匹配、拼装、无命中降级、列读写）。

### Out

- 不自动 `prepare`/`record` 整张卡。
- 不在本版做 SPA 手改 flowRef UI（列可经 API/commit override；向导手改可后补）。
- 不强制补全所有 flows 卡的细粒度「转正」等 node 文案（卡内容由文档/KB 线并行；引擎有卡则用、无节点则退化为整卡 `preconditions` + `menu_path`）。
- 不改解析 `through-chains` 门控、不改 Vue 禁用逻辑。

## 3. 产品语义（对齐用户例子）

| 原子短任务（propose） | 召回后注入的起点指引（prepare/record） |
|----------------------|----------------------------------------|
| 「对公客户主页」点【客户转正】→ FS00004007 | 命中对公建档类流程卡；拼出：选信贷预客户 →【修改】→ 对公客户主页 →【客户转正】 |
| 进入创建潜在客户基础页面（概况） | 同卡分支：选草稿客户 →【修改】→ 创建潜在客户基础页面 |

短任务描述「本段做什么」；完整流程卡「如何站到起点」。

## 4. 架构与数据流

```
propose(through-chains)
  → atoms + 可选 suggestedFlowRef / suggestedNodeId
       │  （taskDraft 仍为短任务 + 出处）
commit
  → trajectory: req_* 出处 + kb_flow_ref + kb_flow_node_id
       │
prepare / record
  → loadFlowCard(kb_flow_ref)  // 始终读磁盘最新卡
  → buildFlowTemplateHint(card, nodeId, atomTask)
  → 注入录制前言（首阶段或 agent preamble）
```

**为何不在 propose 写长文**：卡会变、原子出处文案应稳定；录制机才需要最新模板。向导若要展示，走同一拼装函数的预览 API。

## 5. 数据模型（方案 A）

迁移扩展 `trajectory`（风格对齐 `20260907120000_trajectory_req_provenance.js`）：

| 列 | 类型 | 含义 |
|----|------|------|
| `kb_flow_ref` | string(191) nullable | 流程卡稳定引用：优先 **文件名 stem**（如 `customer_onboarding`），与 `data/kb/flows/<stem>.json` 对应 |
| `kb_flow_node_id` | string(128) nullable | 卡内 `nodes[].id`；可空表示仅挂整卡 |

- DAO / entity / API 详情与列表透出 camelCase：`kbFlowRef`、`kbFlowNodeId`。
- 索引：可选单列 `kb_flow_ref`（便于按卡反查原子草稿）；不必与 `req_atom_key` 复合。

## 6. 匹配规则（propose / commit）

输入：原子 `title`、`taskDraft`、可选 ZJJK/FS 片段；候选：`data/kb/flows/*.json`。

1. 对每张卡，用 `flow`、`aliases`、`keywords`、`hash_markers`、各 `nodes[].page|enter|id` 做子串/关键词打分。
2. 取最高分卡 → `suggestedFlowRef = stem`；若某 node 分数明显高于其它 → `suggestedNodeId`。
3. 低于阈值 → 两字段均省略（null）。
4. commit：默认写入 suggest；body 可带 `flowRefOverrides: { [atomKey]: { kbFlowRef?, kbFlowNodeId? } }`（本版可实现最小 override，UI 后补）。

**不**用 LLM 做本版匹配（确定性、可测）；后续可加 LLM 重排但不阻塞 v1。

## 7. 拼装 `flowTemplateHint`

纯函数（便于 characterize）：

```
【流程卡模板】{flow}
菜单：{menu_path}
前置条件：
- {preconditions[]}
【本段起点】（node={id} {page}）
到达：{node.enter 及可追溯的上游 list→… 简述}
【本原子任务】
{原 phase/task 短文，原样保留}
```

- 有 `kb_flow_node_id` 但卡上无该 id → 打 warn，退化为整卡模板（仍注入 preconditions + menu_path）。
- 无 `kb_flow_ref` → 返回 null，调用方不注入。

## 8. 注入点

**主路径**：`prepareTrajectoryRecording`（或 unlocked runner）在挂会话、下发首阶段任务前：

- 若轨迹存在 `kb_flow_ref`（或仅有 `req_atom_key` 时可二次匹配一次并回写——**本版建议：仅信任已落库列，不在 prepare 静默写库**；缺列则跳过注入）。
- 将 `flowTemplateHint` 前缀到首个待录 phase 的 description / 下发给 agent 的 task 包装层（与现有 open-page / phase hint 并存：模板在前，短任务在后）。

**record 再入**：若 prepare 已注入且 phase description 已含标记块，避免重复叠加（用固定标记如 `【流程卡模板】` 幂等）。

## 9. API 契约增量

### Propose 响应原子字段（可选）

`suggestedFlowRef?: string` · `suggestedNodeId?: string`

### Commit

写入 `kb_flow_ref` / `kb_flow_node_id`；可选 overrides（见 §6）。

### 轨迹详情

回传 `kbFlowRef` · `kbFlowNodeId`。

### 预览（可选本版）

`GET /api/v2/trajectories/:id/flow-template-hint`  
或 `POST .../preview-flow-template-hint`（body: ref + nodeId + task）  
→ `{ hint: string | null }`  
与 prepare 共用拼装函数。

## 10. 与既有设计的关系

- 落实 `2026-09-07-req-to-draft-traj-design.md` 中「可选召回 flows 作前置护栏」——从「未实现」落到 **record 时注入**。
- 不替代 `req_*` 出处字段；flow ref 是**运行时模板引用**，出处仍以需求章节为准。

## 11. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 卡文案缺少「转正」细 node | 退化整卡 preconditions；并行文档补卡 |
| 错匹配挂错卡 | 阈值 + characterize 金样例（对公转正→customer_onboarding）；允许 commit override |
| 前言过长挤占上下文 | 拼装截断 preconditions（如最多 N 条）+ nodes 只保留命中链 |
| 与轨迹查询 WIP 冲突 | 只加列与 prepare/kb-flow-cards/req-draft-traj；不动 listByFunction 查询重构面 |

## 12. 验收清单

- [ ] migrate 后两列可空读写
- [ ] propose 金样例原子带出正确 suggestedFlowRef（或明确无命中）
- [ ] commit 后 trajectory 可见 kbFlowRef / kbFlowNodeId
- [ ] prepare 注入含 `【流程卡模板】`；改卡文件后再次 prepare 反映新文案（无需重 propose）
- [ ] 无 ref：prepare 与基线一致
- [ ] characterize 覆盖匹配 / 拼装 / 降级 / 幂等不重复注入

## 13. 实现分期（供计划拆 Task）

1. migrate + DAO/entity/API 透出  
2. `getFlowCard` + `matchFlowForAtom` + `buildFlowTemplateHint` + characterize  
3. propose suggest 字段；commit 写列  
4. prepare 注入 + 幂等标记  
5. （可选）预览 API + 向导只读展示  

---

**审阅请确认**：§5 列名/stem 约定、§8「prepare 不静默回写」、§9 预览 API 是否本版必做。确认后进入 `writing-plans`。
