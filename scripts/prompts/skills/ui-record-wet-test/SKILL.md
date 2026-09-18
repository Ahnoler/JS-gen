---
name: ui-record-wet-test
description: >-
  Runs JS-gen UI-record wet tests via control-plane APIs: restart local
  services if needed, clone a reference trajectory, analyze/create/prepare/
  start/detach, and judge PASS by persisted step fields (not recordStatus).
  Includes a copy-paste handoff prompt for other agents/testers. Use when the
  user asks for 湿测, 真机录制验收, UI录制贯通, STC/落库验收, or to hand a
  recording workflow to another agent.
---

# UI 录制湿测（减轻手工回归）

用控制面 API 代替测试人员手工点「分析→准备→录制」，验收引擎行为是否写进落库步骤。

控制面默认 `http://localhost:4097`；Python `D:/anaconda3/python.exe`。
长文 API/坑位见 `docs/superpowers/guides/ui-record-through-line-agent-prompt.md`。

## 何时用

- 新合入录制/回放行为要真机验（如 STC 首行、查询门闩）
- 测试/同事要一段可复用「新建交易并录一遍」流程
- 用户说：湿测、真机录制、按某 traj 再录、验收落库字段
- 需要把提示词交给别的 Agent 时 → 用文末「可复制提示词模板」

## 实际流程（心智模型）

```
重启服务 → 找参考交易 → 写带门闩的任务 → analyze/create
  → prepare →（必要时 CDP 关遮挡弹窗）→ record/start → detach
  → 按落库字段验收（不只看 recorded）→ 失败则改任务/修代码再重录
```

相对产品 UI：「选叶子 → 添加交易 → AI 分析 → 准备环境 → 按阶段录制 → 结束」——本 skill 全程走 `/api/v2/trajectories/*`，不依赖前端点击。

## 开场必填（缺一不问齐勿开录）

| 字段 | 说明 |
|------|------|
| 验收目标 | 一句话 + **落库级**判据（动作名 + params/element 字段） |
| 参考 traj | 成功样例 id（抄 functionId / systemAccountId / stamp） |
| functionId / systemAccountId | 勿猜；挂对叶子 |
| 关键 stamp | SUT 可查的客户号/名称等 |
| 禁入 | 新增提交删除、OCR 等 |
| 可否改引擎 | 默认否；仅 Lead 明示才修代码再重录 |

证据目录：`tmp/<证据目录>/`（如 `tmp/stc-first-row-wet/`）。

## 流程清单

```
- [ ] 0 执行机空闲：GET /api/v2/executors（connected + inUse）
- [ ] 1 需新代码/离线时：config/restart-local.cmd → 4097 + executor online
- [ ] 2 拉参考 traj → 写 reference.md
- [ ] 3 任务文案含【硬性成功门闩】+ 编号步骤 + 关键数据
- [ ] 4 analyze → create → prepare →（CDP 关遮挡弹窗）→ start → detach
- [ ] 5 按落库验收 → through-report.md
- [ ] 6 失败：改任务新建重录；落库错且允许改代码 → 最小修 + pin + 重录
```

### 管线 API（勿跳步）

1. `POST /api/v2/trajectories/analyze` `{description, functionId}` → phases 取自 `data`
2. `POST /api/v2/trajectories` `name/task/requirement/phases/functionId/systemAccountId`
3. `POST .../record/prepare`（timeout≥600s）
4. 可选：CDP `19242+slotIndex` 关掉残留弹窗（如「维度参数配置」）
5. `POST .../record/start` `{phaseIds}`（timeout≥1200s）
6. `POST .../detach`

### 任务文案骨架

```
【硬性成功门闩——未满足不得 done】
- {落库/业务判据，具体到动作与字段}
- 禁止：{禁入}

关键数据：{stamp}

1. …
2. …
```

查询类：先填条件再点**一次**查询；勿空查；本相勿反复点同一查询按钮。

## 验收口径（铁律）

| 看 | 不看 |
|----|------|
| `stepCount`、真实 `steps[]` | 仅 `recordStatus=recorded` |
| 目标 `actionType` + `paramsJson` / `elementJson` | 仅 `isSuccessful=1` |
| executor-main.log（query_clicked、index 归一等） | 阶段全部 completed 就当 PASS |

**假成功**：约 1 分钟内全 `phase_done` 且 0 步 → BLOCKED/重录，勿报 DONE。

Agent 常走 `click_element_by_index` 再归一成表行/树动作；验收时看**最终落库动作名与字段**，不要假设一定调了专用 action。

## 失败再试

1. 遮挡弹窗 / 空查校验 / `already-operated-this-phase` → 改任务后**新建** traj 重录
2. 业务步对、落库字段错 → 引擎缺口（专用路径 vs index 归一）；允许改代码时最小修 + 相关 characterize pin，再重录
3. 每轮保留 analyze/create/prepare/start、`traj-*-final.json`、日志摘录

## 交付物

- `tmp/<dir>/through-report.md`（尝试表 + VERDICT）
- `traj-id.txt`、analyze/create/prepare/start JSON、步骤摘要
- 状态一行：`DONE` | `DONE_WITH_CONCERNS` | `BLOCKED` + 原因

除非用户明示，**不** commit/push。

## 实证锚点（可抄）

| 场景 | 参考 | 备注 |
|------|------|------|
| 客户选择器查询→选行 | traj 848 / 湿测 857 | fid `9000000011`，stamp `26080511161570617` |
| 客户信息查询 | traj 526 | fid `9000000039`；查询页先重置 |
| 对公建档 | traj 515/524 | 列表 stamp |

STC 首行样例判据：`click_table_row_radio` 且 `row_text=first`，`xpath_smart` 含结构首行（非业务键）。

---

## 可复制提示词模板

把 `{…}` 换成具体值后，整段发给执行 Agent / 测试同事。

````markdown
# 角色
你是本仓（JS-gen）的「功能湿测录制」Agent。用控制面 API 新建交易、真机录制，验收某一引擎行为是否在落库步骤中体现。
默认控制面：http://localhost:4097；Python：D:/anaconda3/python.exe。
证据目录：tmp/{证据目录}/。除非 Lead 明示，禁止 git commit / push。
先 Read 并遵循：scripts/prompts/skills/ui-record-wet-test/SKILL.md。

# 本单输入（填齐再开工）
- 验收目标：{一句话，如：STC 后选行落库 row_text=first + 结构 xpath}
- 参考历史交易：{如 traj #848；含查询→选行的成功样例}
- functionId / systemAccountId / 关键 stamp：{从参考交易抄，勿猜}
- 成功判据（硬性，落库级）：{如 click_table_row_radio.paramsJson.row_text == "first" 且 xpath_smart 含结构首行，而非业务键}
- 禁入：{如新增/提交/删除/OCR}
- 是否允许改引擎代码：{否=只录制验收 / 是=湿测撞缺口可最小修复后再重录}

# 流程（严格按序）

## 0. 开场
- 读 docs/superpowers/guides/ui-record-through-line-agent-prompt.md（API/坑位）
- 读 agent-log 最近条目；动代码前写开工声明（若本单允许改代码）
- 确认无他线占用执行机槽：GET /api/v2/executors（看 connected + inUse）

## 1. 重启（需要新代码生效或本地 executor 离线时）
- 先确认无重要在途录制
- 跑 config/restart-local.cmd
- 等到 4097 LISTENING，且至少一台 executor connected=true（常见本地名 LMY）
- 日志：tmp/server-main.log、tmp/executor-main.log

## 2. 锚定参考交易
- GET /api/v2/trajectories/{参考id}，记下 functionId、systemAccountId、任务骨架、关键 stamp
- 在证据目录写 reference.md（fid / stamp / 关键步骤类型）

## 3. 写任务文案（写入 task/requirement）
必须含：
【硬性成功门闩——未满足不得 done】
- 落库/业务判据（具体到动作名与字段）
- 禁止项
- 关键数据（可从参考交易抄的已知可查 stamp）
编号步骤要短、只覆盖验收路径；查询类务必「先填条件再点一次查询」。

## 4. 标准录制管线
a) POST /api/v2/trajectories/analyze  body={description:任务全文, functionId}
   → phases 从 data 取（若包 {code,data}）
b) POST /api/v2/trajectories  name/task/requirement/phases/functionId/systemAccountId
c) POST .../record/prepare（timeout≥600s）
d) （推荐）CDP 端口 = 19242+slotIndex：关掉残留遮挡弹窗，再 start
e) POST .../record/start  body={phaseIds:[...]}（timeout≥1200s）
f) POST .../detach

## 5. 验收（以落库为准，不以 isSuccessful）
拉取 GET /api/v2/trajectories/{id}，检查：
- stepCount > 0；若 ~1 分钟内全 phase_done 且 0 步 → 假成功，记 BLOCKED/重录，勿当 PASS
- 目标动作是否出现
- paramsJson / elementJson 是否满足本单成功判据
- 对照 executor-main.log（如 query_clicked、index 归一）

写 through-report.md：trajId、各次尝试表、VERDICT=DONE|DONE_WITH_CONCERNS|BLOCKED、证据路径。

## 6. 失败再试规则
- 遮挡弹窗 / 空查校验 / already-operated-this-phase → 改任务后新建交易重录
- 业务步已对但落库字段不对 → 属引擎缺口：定位 record 路径，仅当本单允许改代码时最小修 + pin + 重录
- 每轮证据保留：analyze/create/prepare/start JSON、traj-*-final.json、日志摘录

# 输出
- tmp/{证据目录}/through-report.md
- traj-id.txt、关键 JSON、步骤摘要
- 状态一行：DONE / DONE_WITH_CONCERNS / BLOCKED + 原因
````

### 填空示例（STC 首行湿测）

```
验收目标：STC 后选行落库 row_text=first + 结构 xpath
参考历史交易：traj #848
functionId：9000000011；systemAccountId：2
关键 stamp：客户编号 26080511161570617
成功判据：click_table_row_radio 且 row_text=first，xpath_smart 含 dialog 作用域结构首行
禁入：评级新增/提交/删除；主列表行编辑
是否允许改引擎代码：否（或 Lead 明示为是）
证据目录：stc-first-row-wet
```
