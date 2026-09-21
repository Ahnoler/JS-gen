# 湿测交接：需求切片 → 原子草稿交易（draft-traj）

> **✅ 湿测已 PASS（2026-09-08 凌晨，Zcode 夜班，DoD 6/6）**：报告 `tmp/req-draft-traj/through-report-wet.md`，traj 681/682。实测补记：① migrate 已落（四列在库，无需再跑）；② propose 的 suggestedFunctionId 可能越界（如 90000107304 非 system.id，commit 撞 FK）——勾选后建议统一带 functionIdOverrides=9000000740 兜底；③ Windows Git Bash 内联中文 JSON 会变 GBK 乱码导致假 `unknown_or_stale_atom`，必须 `--data-binary @utf8文件`；④ 待修：propose 侧应对 suggestedFunctionId 做 system.id 校验。

> **给执行 Agent**：本文是可独立执行的湿测计划，**不是**让你重切全库需求文档。  
> **作者会话**：Cursor Lead（req→draft-traj 已合入 `uara_V1.2`，终审 Approved）。  
> **日期**：2026-09-07  
> **规格**：[`docs/superpowers/specs/2026-09-07-req-to-draft-traj-design.md`](../specs/2026-09-07-req-to-draft-traj-design.md)  
> **实现计划**：[`docs/superpowers/plans/2026-09-07-req-to-draft-traj.md`](./2026-09-07-req-to-draft-traj.md)  
> **代码终点**：约 `c044387f` / 其后 docs 收工；characterize 目标 **OK 19**

---

## 0. 你是谁、为什么交给你

你正在跑 **主链七环节贯通**（计分板 R1–R7）。本单与主链录制 **正交**：只测「从已切片的需求作业区生成 **draft 交易**」，**禁止** `prepare` / `record/start`，不抢执行机槽、不碰你正在录的 R6/R7 轨迹。

| 你的主线（继续） | 本单（顺路湿测） |
|------------------|------------------|
| R1–R5 已 ✅；R6 用信 BLOCKED@SUT；R7 等 R6 | 验证 draft-traj API 能从 `data/kb/req/<module>/` 出原子草稿 |
| 可继续排查 R6 提交 | 本单失败 **不阻塞** 主链，报告即可移交 |

---

## 1. 功能一句话

```
已 sliced 的 data/kb/req/<moduleKey>/
  → POST …/draft-traj/propose   （原子候选 + 文档/章节出处）
  → 人勾选 atomKeys
  → POST …/draft-traj/commit    （仅建 recordStatus=draft，写 provenance 四字段）
```

**不做**：自动录制、组件扫描、批量推送改推组件（todo ⑧′，未来版本）。

---

## 2. 前置检查（必须先过）

控制面：`http://localhost:4097`（或你环境实际端口）。

```bash
# 1) 迁移：trajectory 上四列 provenance
npx knex migrate:latest --knexfile config/knexfile.js
# 确认列存在（任选）：req_module_key / req_source_path / req_chapter_ref / req_atom_key

# 2) 离线门闩
node scripts/characterization/characterize-req-draft-traj.mjs
# 期望：OK 19（或 ≥19）
```

若 characterize 失败：停，把输出贴回 Lead；**不要**继续湿测。

---

## 3. 测什么、不测什么

### 做

- 用 **现成** `data/kb/req/product-mgmt/`（或任意已有 `through-chains.md` + `chapters/` + `source.link.json` + `manifest.json` 的模块）。
- propose → 人工看原子粒度与出处 → 勾选 **1～2** 个 atom → commit → GET 核对 provenance。
- 负例：重复 commit、假 atomKey、缺 functionId。

### 不做

- **不要**把 `docs/天阳信贷系统需求文档` 全库按新标准重切一遍。
- **不要**为测本 API 去 clear/重录主链 traj（595/604/…/613 或你当前 R6 单）。
- **不要**调用 `record/prepare`、`record/start`、`detach`（除非你误开了，立刻 stop/detach 并写进报告）。
- **不要**改 `scripts/session_runner.py`、恢复 `save_section.py`、动主链引擎热区（除非 R6 阻塞本身需要且另开工声明）。

### 何时才改切片

仅当 propose 结果 **整条主链合成一原子**（粒度不合格）时：

1. 局部改该模块 `through-chains.md`（步骤表写成原子闭环：新增一级 / 新增分类 / 新增产品…），**不必**重啃 docx；
2. 再 propose 一次。

从未 sliced 的模块：才走 `scripts/prompts/skills/req-doc-to-kb/`；本单默认不要求。

---

## 4. 首通湿测步骤（product-mgmt）

> 以下 curl 示例；PowerShell 注意 UTF-8。也可用任意 HTTP 客户端。

### 4.1 Propose

```http
POST /api/v2/kb/req-modules/product-mgmt/draft-traj/propose
Content-Type: application/json

{ "maxAtoms": 10 }
```

**人工核对清单（写入报告）：**

- [ ] HTTP 200；`atoms.length ≥ 1`
- [ ] 每条 `atom` 含非空：`atomKey`、`sourceDoc`、`sourceChapter`、`taskDraft`、`title`
- [ ] 粒度：偏向原子（如新增一级分类 / 新增分类 / 新增产品），**不是**「建库→启用」一整条
- [ ] `rejected`（若有）无出处；**不得**出现在 `atoms`
- [ ] 磁盘出现：`data/kb/req/product-mgmt/.draft-traj-propose.json`（gitignore 可能忽略；存在即可）

**失败常见原因：**

| 现象 | 处理 |
|------|------|
| 400 through-chains 缺失 | 换模块或补 `through-chains.md` |
| 404 模块未登记 | `GET /api/v2/kb/req-modules` 看清单；或先 register |
| 原子过粗 | 改 chains 步骤表后重 propose（§3） |
| LLM 超时/空 | 看控制面日志；可再打一次 propose（会刷新 cache） |

### 4.2 勾选并 Commit

从 `atoms` 里选 **1～2** 个（优先带 `suggestedFunctionId` 的；产品库常见 `9000000740`）。

```http
POST /api/v2/kb/req-modules/product-mgmt/draft-traj/commit
Content-Type: application/json

{
  "atomKeys": ["<paste-atomKey-1>", "<paste-atomKey-2>"],
  "systemAccountId": 2,
  "functionIdOverrides": {}
}
```

若某原子 `missing_function_id`：

```json
"functionIdOverrides": { "<atomKey>": 9000000740 }
```

**验收：**

- [ ] `created[].trajectoryId` 有值；条数 = 勾选成功数
- [ ] `GET /api/v2/trajectories/:id` → `recordStatus=draft`
- [ ] 同响应/详情含：`reqModuleKey`、`reqSourcePath`、`reqChapterRef`、`reqAtomKey`（camelCase）
- [ ] **无** recording 状态、无新占槽

### 4.3 幂等与负例

1. **同 atomKeys 再 commit（不带 force）** → `skipped` 含 `duplicate_draft`（或同类 duplicate 文案）。
2. **假 atomKey** → `unknown_or_stale_atom`。
3. **未 propose 的模块直接 commit** → 400（cache missing）。

---

## 5. 与主链计分板的关系（避免串台）

当前计分板快照（交接时）：

| 环节 | 状态 | 备注 |
|------|------|------|
| R1 客户新增 | ✅ | traj 595 |
| R2 对公评级 | ✅ | 604+607 |
| R3 对公授信 | ✅ | 605+608 |
| R4 审批 | ✅ | 606/607/608 |
| R5 批复 | ✅ | traj 613 已生效 |
| R6 用信申请 | ⚠️ | 管线绿、单据 YXPC… 待发起；**流程提交 BLOCKED@SUT** |
| R7 合同 | ⌛ | 等 R6 |

**纪律：**

- 本单湿测 **并行可做**，但：
  - 不 `stop`/`detach` 主链正在用的 remote_session；
  - 不用主链业务 stamp 当 draft-traj 案例数据；
  - 报告里分开写「draft-traj 结果」与「R6 阻塞进展」。

若执行机槽紧张：优先保证 R6 排查；draft-traj **只打 propose/commit（不占槽）**，可随时做。

---

## 6. 产出物（你必须交回）

写到：

`tmp/req-draft-traj/through-report-wet.md`

建议结构：

```markdown
# draft-traj 湿测报告

- 时刻 / Agent / 控制面端口
- migrate：是否已跑 / 列是否存在
- characterize：OK n
- moduleKey：product-mgmt（或实际）
- propose：atoms 数、rejected 数、粒度判断（合格/过粗）、各选中 atom 的 sourceDoc/sourceChapter 摘录
- commit：trajectoryId 列表、GET provenance 摘录
- 负例：duplicate / 假 key / 结果
- 是否误触录制：否/是（若是写清理动作）
- 与主链：本单未动 R6/R7 轨迹 …
- 遗留移交：…
```

可选：把 propose/commit 原始 JSON 落到 `tmp/req-draft-traj/_propose.json`、`_commit.json`（勿提交密钥）。

收工：在 `docs/superpowers/agent-log.md` 顶部插 **收工条**（范围仅本湿测报告 + 若改了 chains 则写明）；**不要**把无关 WIP 打进同一 commit。用户未要求则先不 commit，按你们线惯例。

---

## 7. 成功 / 失败判据

**PASS（本单收口）：**

1. characterize ≥19  
2. propose 有出处齐全的原子，且粒度可接受（或已改 chains 后可接受）  
3. commit 1～2 条 draft + provenance 可查  
4. 幂等 skip 成立  
5. 全程无自动录制  

**FAIL（写清根因即移交）：**

- migrate/characterize 不过  
- propose 空或全 rejected  
- commit 全部 skipped 且无法用 override 救回  
- 误伤主链录制会话  

---

## 8. 关键路径速查

| 用途 | 路径 |
|------|------|
| 路由 | `src/routes/v2/kb.js` |
| 服务 | `src/services/req-draft-traj/*` |
| 迁移 | `migrations/20260907120000_trajectory_req_provenance.js` |
| 离线测 | `scripts/characterization/characterize-req-draft-traj.mjs` |
| 夹具 | `scripts/characterization/fixtures/req-draft-traj/demo-mod/` |
| 产品模块作业区 | `data/kb/req/product-mgmt/` |
| API 契约 | `/api/docs` → KB 组 draft-traj 两条 |

---

## 9. 给执行 Agent 的最短口令

1. migrate + characterize OK 19  
2. propose `product-mgmt` → 审出处与原子粒度  
3. 勾 1～2 个 commit → 验 draft + provenance  
4. 再 commit 验 duplicate skip  
5. 写 `tmp/req-draft-traj/through-report-wet.md`  
6. **不要**重切全库；**不要**录制；**不要**动 R6 在途会话  

完。
