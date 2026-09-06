# UI 录制贯通 — Agent 提示词手册

> 日期：2026-09-06  
> 用途：交给其他 Agent / 同事，按产品「UI录制」标准路径做 **新增交易录制 → 填任务 → AI 分析拆阶段 → 按阶段执行**  
> 实证来源：客户管理档位 A（建档 #515/#524）+ 档位 B（查询 #526）；对齐控制面 `/api/v2/trajectories/*`  
> 前端契约：`http://localhost:4097/api/docs`；本仓 Python：`D:/anaconda3/python.exe`

---

## 1. 一页心智模型（UI ↔ API）

| 产品 UI（UI录制） | 实际在干什么 | Agent 应对 |
|------------------|--------------|------------|
| 左树选功能叶子 | 定 **functionId**（勿挂 intermediate 目录） | 先锚点：`GET /api/v2/processes/{pid}/functions` |
| **+ 添加交易录制** → 填交易名称 / 任务 | 建草稿交易 + 任务正文 | 先写清任务文案，再 `analyze` → `POST /trajectories` |
| AI 分析拆阶段 | 把任务拆成可执行 phases | `POST /api/v2/trajectories/analyze`，审阶段后再入库 |
| 绑定账号 / 准备环境 | 登录 SUT、占执行机槽 | `systemAccountId` + `POST .../record/prepare` |
| 按阶段执行 / 录制 | Agent 在浏览器逐步操作并落库步骤 | `POST .../record/start`（可带 `phaseIds`） |
| 结束 | 释放槽 / Chrome | `POST .../detach`（硬关）；`stream/detach` 仅停推流语义不同 |
| 列表「阶段数 / 步骤数 / 已确认」 | 验收录制质量 | 看 `phaseCount` / `stepCount` / **业务 stamp**，不要只看 `isSuccessful` |

**标准顺序（勿跳步）：**

```
功能锚点 → 任务文案（含成功门闩）→ analyze → 建交易(phases)
  → prepare → start →（必要时 CDP 补证）→ detach → 报告 / KB source
```

列表列含义：

| 列 | 含义 |
|----|------|
| 交易名称 | create 时的 `name`（建议 `KB贯通-{模块}-{YYYYMMDD-HHMM}`） |
| 阶段数 | analyze 拆出的 phases → `phaseCount` |
| 步骤数 | 各阶段真实动作总和（假成功时会接近 0） |
| 状态 | draft → recording → recorded / 产品侧「已确认」另说 |
| 播放 | 对**已录**交易的执行/回放；**贯通录制主路径是 record/start**，不是先空跑播放 |

---

## 2. 可复制：Agent 提示词模板

把 `{…}` 换成具体值后整段发给执行 Agent。

````markdown
# 角色
你是本仓（JS-gen）的「UI 录制贯通」执行 Agent。按产品路径完成：
新增交易录制 → 填任务 → AI 分析拆阶段 → prepare → 按阶段 record → detach → 验收。
用控制面 API（默认 http://localhost:4097），证据写 tmp/{证据目录}/。
Python：D:/anaconda3/python.exe。子代理禁止 git commit（由 Lead 提交）。

# 本单输入（必须填齐）
- 功能叶子名：{如：对公客户管理 / 客户信息查询 / 产品阶段管理}
- functionId：{数字}（禁止用 intermediate / 已合并的旧孪生 id）
- processId：{如客户管理=4}
- systemAccountId：{默认 2}
- 交易名称：KB贯通-{模块}-{YYYYMMDD-HHMM}
- 业务 stamp / 关键数据：{如客户名称=KB测客户-…；须可在 SUT 核对}
- 成功判据（硬性）：{如：列表查询可见 stamp / 字段回填=某值+保存 toast}
- 禁入：{如 OCR/影像/新增建档/某按钮}
- 可选 KB 卡：data/kb/flows/{card}.json（只回写 source/rules，勿改引擎/_kb.py除非声明）

# 纪律
1. 先确认 functionId：GET /api/v2/processes/{processId}/functions，核对 name、intermediateFlag=0、pageId、menuXpath。写 function-anchors.md。
2. 任务文案必须编号分步 +【硬性成功门闩】：门闩未满足不得 done / 不得提前结束阶段。
3. 管线顺序固定：
   a) POST /api/v2/trajectories/analyze  body含 functionId + requirement全文
      → 若响应是 {code,data}，phases 从 data 取，勿把整包当 phases
   b) POST /api/v2/trajectories  name/task/requirement/phases/functionId/systemAccountId
      → 若 phaseCount=0，用 PUT .../trajectories/{id}/phases 补挂
   c) 确认空闲执行机 GET /api/v2/executors（不抢他线槽）
   d) POST .../record/prepare（timeout≥600s）
   e) POST .../record/start（timeout≥1200s；可带全部 phaseIds）
   f) POST .../detach
4. 验收以业务证据为准，不以「全阶段 completed」为准：
   - 核对 stepCount、各 phase 真实 steps
   - SUT 侧验证成功判据（列表 stamp / 字段值 / toast）
   - AI 若 ~十几秒全 phase_done 且几乎无步骤 = 假成功：用 CDP（19242+slot）补完并写入 cdp-*.json，报告如实写
5. 证据最低集：task-requirement.md、analyze/create JSON、traj-id.txt、through-report.md（trajId/fid/stamp/阶段表/hit）、必要时截图
6. 收工：更新 KB source（若有卡）、todo/agent-log 由 Lead；你只交报告与文件清单

# 任务文案骨架（写入 requirement）
【硬性成功门闩——未满足不得 done】
- {成功判据一句}
- 禁止：{禁入列表}

1、进入…预期：…
2、操作…预期：…
3、核对…预期：…
关键数据
{stamp 与字段}

# 输出
- through-report.md 结论表 + 阶段表（每 phase：status / step 数 / 是否假完成）
- 阻塞时写明：缺什么、下一步建议（换 stamp / CDP / 引擎门闩另案）
- 状态：DONE | DONE_WITH_CONCERNS | BLOCKED（假成功但业务 hit=true → DONE_WITH_CONCERNS）
````

---

## 3. API 速查（与 catalog 一致）

控制面默认 `http://localhost:4097`。产品文档：`/api/docs`。

| 步骤 | 方法 |
|------|------|
| 功能树 | `GET /api/v2/processes/{processId}/functions` |
| 拆阶段 | `POST /api/v2/trajectories/analyze` |
| 建交易 | `POST /api/v2/trajectories` |
| 补阶段 | `PUT /api/v2/trajectories/{id}/phases`（create 漏挂时） |
| 执行机 | `GET /api/v2/executors` |
| 准备 | `POST /api/v2/trajectories/{id}/record/prepare` |
| 录制 | `POST /api/v2/trajectories/{id}/record/start` |
| 硬卸 | `POST /api/v2/trajectories/{id}/detach` |
| 详情/树 | `GET /api/v2/trajectories/{id}`、`.../tree` |

CDP 端口段：执行机 `EXECUTOR_CDP_PORT_BASE`（常见 **19242** + slotIndex）。

---

## 4. 实证坑位（教别人时必讲）

1. **挂对叶子**：对公建档是 **7**（勿 1478）；客户信息查询是 **9000000039**（勿「查询对公客户分配」9000000283）。
2. **analyze 包一层**：`{code,data}` → phases 在 `data`；建交易漏 phases 时 PUT 补。
3. **成功门闩写进任务**：否则 Agent 常「进页就 done」。
4. **`recorded` ≠ 有步骤**：看 `stepCount`；必要时 CDP 补证并以业务 hit 为准。
5. **查询页先重置**：残留条件会导致 stamp 查 0 条（见 traj #526）。
6. **双开不抢槽**：`GET /executors` 看 online/inUse；不与用信/他线抢同一 Chrome。
7. **禁入写死**：OCR/影像/不可逆提交等必须出现在任务文案与报告。

参考湿测：

| 线 | traj | 卡 | 备注 |
|----|------|----|------|
| 对公建档 A | #515 / #524 | `customer_onboarding.json` | P2 可回放步骤；列表 stamp |
| 客户查询 B | #526 | `customer_query.json` | hash `#/cstMgt/csinfEnqr/cstEnqr`；重置 quirk |

设计/计划样例：`docs/superpowers/specs/2026-09-05-customer-mgmt-kb-design.md`、`.../customer-query-kb-design.md` 及对应 `plans/`。

---

## 5. 证据与收工清单

**执行 Agent 应交：**

- `tmp/{dir}/function-anchors.md`
- `tmp/{dir}/task-requirement.md`
- `tmp/{dir}/analyze.json` / `create.json` / `traj-id.txt`
- `tmp/{dir}/through-report.md`（结论表 + 阶段表 + hit/阻塞）
- 可选：`cdp-*.json`、列表截图

**Lead 应收：**

- 业务成功判据是否成立（不只看 API 200）
- KB `source` / rules 是否回写
- `docs/superpowers/agent-log.md` 收工；commit 仅本线文件（勿带 `.env`、他线 WIP、误删 docs）

---

## 6. 状态口径（报告用）

| 状态 | 何时用 |
|------|--------|
| **DONE** | 业务门闩满足，且有合理步骤或已声明 CDP 补证路径清晰 |
| **DONE_WITH_CONCERNS** | 业务 hit=true，但存在假完成 / 0 步 phase / 需重置等 quirk |
| **BLOCKED** | functionId 错、无执行机、stamp 失踪、门闩无法满足且无经 Lead 的替代方案 |
