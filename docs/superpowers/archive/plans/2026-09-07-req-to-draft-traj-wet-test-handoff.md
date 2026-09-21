# 湿测移交：需求切片 → 原子草稿交易（req→draft-traj）

> **✅ 湿测已 PASS（2026-09-08 凌晨，Zcode 夜班，DoD 6/6）**：报告 `tmp/req-draft-traj/through-report-wet.md`，traj 681/682。实测补记：migrate 已落无需再跑；suggestedFunctionId 可能越界（勾选后带 functionIdOverrides=9000000740 兜底）；Git Bash 内联中文 JSON 变 GBK 乱码——`--data-binary @utf8文件`。

> 日期：2026-09-07  
> 交给：主链贯通 Agent（当前计分板 R1–R5 已齐；R6 用信 `BLOCKED@SUT`；R7 等 R6）  
> 规格：`docs/superpowers/specs/2026-09-07-req-to-draft-traj-design.md`  
> 实现计划：`docs/superpowers/plans/2026-09-07-req-to-draft-traj.md`（代码已合入 `uara_V1.2`，终审 Approved）  
> **本单不录制、不抢执行机槽**（只建 `draft`；与 R6 SUT 阻塞正交）

---

## 0. 你要验证什么

用已有 **需求切片作业区**（`data/kb/req/<moduleKey>/`）自动生成 **原子粒度草稿交易**，替代手工「新增交易」写任务。

成功终点（本湿测）：

1. `propose` 返回带 **需求文档 + 章节出处** 的原子候选；
2. 人（或你按清单）勾选子集后 `commit` 只创建这些 `draft`；
3. 轨迹上结构化出处四字段非空；
4. **全程不调用** `record/prepare` / `record/start`。

**不需要**把历史需求文档整库按新标准重切一遍。已 `sliced` 的模块直接测；只有 chains 太粗导致「一锅主链一个原子」时，才局部改 `through-chains.md`。

---

## 1. 与主链计分板的关系

| 主链 | 状态（截图口径） | 对本湿测 |
|------|------------------|----------|
| R1–R5 | 已完成（含 traj 595/604–608/613 等） | 勿动这些已录交易 |
| R6 用信 | 录制管线绿 + 单据已生成，**流程提交 BLOCKED@SUT** | 本湿测不依赖 R6 解锁；也不要为测 draft-traj 去解 R6 |
| R7 合同 | 等 R6 | 本湿测不涉及 |

本功能测的是 **KB 作业区 → 草稿交易生成**，不是主链七环节业务闭环。可与 R6 阻塞并行：不占 executor。

---

## 2. 前置检查（必须先过）

工作目录：仓库根 `JS-gen`；控制面 `http://localhost:4097`。

```bash
# 1) 落 provenance 列（四字段）
npx knex migrate:latest --knexfile config/knexfile.js

# 2) 离线门闩（实现侧已钉）
node scripts/characterization/characterize-req-draft-traj.mjs
# 期望：OK 19（或 ≥19）
```

确认模块作业区存在（任选其一有完整切片的即可）：

- 优先：`data/kb/req/product-mgmt/`（产品库，chains/chapters 较熟）
- 或主链相关已 sliced 模块（客户/评级/授信等）——**仍建议首通用 product-mgmt**，避免和主链交易清单混淆

必备文件：

- `manifest.json`
- `source.link.json`
- `through-chains.md`
- `chapters/`（至少一个 md）

```bash
# 快速探测
curl -s http://localhost:4097/api/v2/kb/req-modules/product-mgmt
# 期望 hasThroughChains=true、hasChapters=true
```

---

## 3. 湿测步骤（首通）

### 3.1 Propose

```http
POST /api/v2/kb/req-modules/product-mgmt/draft-traj/propose
Content-Type: application/json

{ "maxAtoms": 12 }
```

可选：`{ "chainIds": ["chain-a"] }`（若解析出的 chainId 已知）。

**人工核对（写入报告）：**

| 检查项 | 期望 |
|--------|------|
| `atoms[].sourceDoc` | 非空（来自 source.link / 文档路径） |
| `atoms[].sourceChapter` | 非空（含 `chapters/…` 或章标题） |
| `atoms[].atomKey` / `taskDraft` | 非空 |
| 粒度 | 偏原子（如新增一级分类 / 新增分类 / 新增产品），**不是**「建库→启用」整链一条 |
| `rejected` | 无出处的进这里，不进 `atoms` |
| 副作用 | 模块目录出现 `.draft-traj-propose.json`；**无新录制会话** |

把完整 JSON 存到：`tmp/req-draft-traj/wet-propose-<stamp>.json`。

### 3.2 勾选并 Commit

从 `atoms` 里挑 **1～2** 条（优先带 `suggestedFunctionId` 的；没有则 commit 时带 override）。

```http
POST /api/v2/kb/req-modules/product-mgmt/draft-traj/commit
Content-Type: application/json

{
  "atomKeys": ["<从 propose 复制的 atomKey>", "<可选第二条>"],
  "systemAccountId": 2,
  "functionIdOverrides": {
    "<atomKey>": 9000000740
  }
}
```

说明：

- `systemAccountId`：沿用你们贯通账号（产品库常用 `2`）；主链模块按该模块账号。
- `functionIdOverrides`：仅当 atom 无 `suggestedFunctionId` 或猜错时必填；product-mgmt 产品库叶子常用 `9000000740`。
- **不要**设 `force: true`（首通测幂等）。

**人工核对：**

| 检查项 | 期望 |
|--------|------|
| `created[].trajectoryId` | 有值；条数 = 勾选成功数 |
| GET `/api/v2/trajectories/:id` | `recordStatus=draft`；`reqModuleKey` / `reqSourcePath` / `reqChapterRef` / `reqAtomKey` 均非空 |
| 未勾选的 atom | **没有**对应新交易 |
| 执行机 / recording | **无**新的 prepare/start；与 R6 槽位无关 |

证据：`tmp/req-draft-traj/wet-commit-<stamp>.json` + 各 traj GET 摘录。

### 3.3 幂等与负例（短）

1. **再 commit 同一 atomKey（无 force）** → `skipped` 含 `duplicate_draft`。  
2. **假 atomKey** → `unknown_or_stale_atom`。  
3. **不先 propose 直接 commit**（或删掉 `.draft-traj-propose.json`）→ 400（cache 缺失）。  
4. （可选）`suggestedFunctionId` 为空且不传 override → `missing_function_id`。

---

## 4. 何时才需要「按新标准」动需求文档

| 现象 | 动作 |
|------|------|
| propose 粒度正确、出处齐全 | **停**；报告 PASS，不必重切 docx |
| 整条主链被打成 1 个 atom | **改**该模块 `through-chains.md`：步骤表按原子闭环拆行（参考产品库「新增一级 / 新增分类 / 新增产品」分行）；再 propose |
| 大量进 `rejected`（无章节） | 补 `chapters/` 章末清单或修正章节出处子弹；再 propose |
| 模块根本没有作业区 | 才走 `req-doc-to-kb` Skill 登记+切片；**不要**为本湿测批量重切 30 模块 |

主链 R1–R7 相关模块：若要用本 API 批量生成草稿，等 **product-mgmt 首通 PASS** 后再单列第二份计划；本移交单范围 = 首通 + 报告。

---

## 5. 报告模板（收工必交）

写到：`tmp/req-draft-traj/through-report-wet.md`

```markdown
# req→draft-traj 湿测报告

- 时刻 / 控制面：
- migrate：是/否
- characterize-req-draft-traj：OK ?
- moduleKey：
- propose：atoms=? rejected=? 证据路径=
- 勾选 atomKeys：
- created trajectoryIds：
- GET 出处四字段：抽样贴一条
- 幂等/负例：结果
- 结论：PASS / FAIL + 一句话
- 遗留：是否需改 through-chains / 是否建议下一模块
```

可选：在 `docs/superpowers/agent-log.md` 顶部插收工条（若你方协议要求），**不要**恢复 `CHANGELOG.md`。

---

## 6. 禁区（硬）

- 禁止对本湿测调用 `record/prepare`、`record/start`、批量 Excel `mode=record`。
- 禁止 stop/detach 主链在途会话；禁止为「测草稿」去解 R6 `BLOCKED@SUT`。
- 禁止写 `data/kb/flows/**` promote；禁止改 `scripts/session_runner.py` 他线 WIP。
- 禁止把整份需求分册 docx 当 propose 输入（必须先有 req 作业区）。
- 子智能体不 commit；由主会话按你们协议提交（若只跑湿测、不改代码，通常无 commit）。

---

## 7. API 速查

| 方法 | 路径 |
|------|------|
| Propose | `POST /api/v2/kb/req-modules/:moduleKey/draft-traj/propose` |
| Commit | `POST /api/v2/kb/req-modules/:moduleKey/draft-traj/commit` |
| 模块详情 | `GET /api/v2/kb/req-modules/:moduleKey` |
| 轨迹详情 | `GET /api/v2/trajectories/:id` |

契约说明：`http://localhost:4097/api/docs`（KB 组）。

实现入口：`src/services/req-draft-traj/`；路由：`src/routes/v2/kb.js`。

---

## 8. 完成定义（DoD）

- [ ] migrate 已跑；characterize OK ≥19  
- [ ] product-mgmt（或指定模块）propose 证据 + 人工粒度/出处核对  
- [ ] commit 1～2 条 draft + GET 出处四字段  
- [ ] 幂等 duplicate 至少测一次  
- [ ] `tmp/req-draft-traj/through-report-wet.md` 已写  
- [ ] 未触发任何录制 / 未干扰 R1–R7 在途交易  

以上完成即本移交单收口；全库需求重切与主链用本 API 批量建草稿 **不在本单**。
