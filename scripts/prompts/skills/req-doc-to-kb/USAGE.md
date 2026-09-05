# req-doc-to-kb · Agent Team 使用说明

> 给 **Lead Agent** 及其 **worker 子代理**：按本规程把仓库内需求分册批量导入 `data/kb/req/`。  
> 契约正文：同目录 [`SKILL.md`](./SKILL.md)。设计：`docs/superpowers/specs/2026-09-05-req-doc-kb-import-design.md`。

---

## 0. 一句话任务

对 `docs/天阳信贷系统需求文档` 下选定语料中的 **每一个需求分册 `.docx`**：登记模块作业区 → officecli 切片 → 产出 `chapters/` + `through-chains.md` → `manifest.status = sliced`。  
**本批默认不出草稿卡**（不写 `drafts/`），除非用户另行明示。

---

## 1. Lead 必读（开跑前）

### 1.1 必读文件

1. `scripts/prompts/skills/req-doc-to-kb/SKILL.md`（步骤 / 禁区 / 检查清单）  
2. 本文件（语料优先级、moduleKey、并行规则）  
3. `AGENTS.md` 跨 Agent 开工/收工（动仓库文件前写 `docs/superpowers/agent-log.md` 并 commit）

### 1.2 硬禁区（任一 worker 违反即失败）

| 禁止 | 说明 |
|------|------|
| 写 `data/kb/flows/**` | 正式流程卡只读 |
| 调用 `scripts/kb/promote.py` | 禁止 |
| 写 `data/kb/staging/` | 禁止 |
| 改源 `.docx` | 只读 |
| 一次多模块抢同一 `moduleKey` | 并行必须 **moduleKey 互斥** |
| 导入手册 / 接口 / 案例 / 计划 / `.xlsx` | v1 只接受 **需求分册 docx** |
| 恢复 `save_section.py` | 他线有意删除，无关本任务 |

### 1.3 本批目标状态

每个模块：`registered` →（切片）→ **`sliced`**。  
不要默认 `drafted`。  
**湿测阶段（2026-09-05 用户拍板）**：sliced 后按「逐模块、逐叶节点」跑真机湿测回填 `wet-test.md`（协议见 SKILL.md「湿测」节）；drafts/promote 以湿测 match 叶为门槛，仍需用户明示。

### 1.4 控制面

- 优先：`POST/GET http://localhost:4097/api/v2/kb/req-modules`（服务需已加载含该路由的构建）。  
- 不可用：用 Node 直调 `src/services/kb-req-modules.js` 的 `registerReqModule`，或按契约手建 `data/kb/req/<moduleKey>/`。  
- 上传接口 `…/source` 为 **501**，本批只用 **绝对路径** `sourcePath` 登记。

---

## 2. 语料优先级（同一模块只取一份 canonical）

根目录：`docs/天阳信贷系统需求文档/`

| 优先级 | 目录 | 用法 |
|--------|------|------|
| **P0（主跑）** | `A_v5.2需求文档0824/` | **默认全集**；文件名带字母序号（K01/A02…） |
| P1（补洞） | 根下按域文件夹（`产品管理/`、`用信管理/`…） | 仅当 0824 **缺该域** 时补（例：押品、系统管理） |
| P2 | `A_v5.2需求文档0811/` | 一般 **跳过**（被 0824 覆盖） |
| P3 | `A_v5.2需求文档/`（无日期） | 一般 **跳过** |
| P4 | `A_原版需求/` | **跳过**（旧版；除非 Lead 显式 gap-fill） |

**跳过文件类型：** `.xlsx`、`*-操作步骤清单.md`、非「需求分册」说明性杂件。

**已存在作业区：**  
- `data/kb/req/product-mgmt/` 若已是 `registered`/`sliced`：对该 key **增量切片**（更新 chapters / through-chains），登记时可用同一 `sourcePath`（0824 的 K01），**不要** `reset:true` 除非用户要求清空。

---

## 3. moduleKey 命名约定

- 正则：`^[a-z0-9]+(-[a-z0-9]+)*$`  
- 一册一文一 key；**同一业务域多册** → **拆 key**，不要把多份 docx 塞进一个作业区（API 只有一个 `sourcePath`）。

### 3.1 推荐映射表（P0 = `A_v5.2需求文档0824`）

路径前缀均相对仓库根；`sourcePath` 请写成 **本机绝对路径**（Windows 例：`D:/dev/JS-gen/docs/天阳信贷系统需求文档/A_v5.2需求文档0824/K01….docx`）。

| moduleKey | moduleName | 源文件（0824） |
|-----------|------------|----------------|
| `meeting-mgmt` | 公共组件-会议管理 | `00…公共组件需求分册【会议管理】.docx` |
| `customer-common` | 客户管理-公共功能 | `A01…【公共功能】.docx` |
| `customer-corp` | 客户管理-对公客户 | `A02…【对公客户管理】.docx` |
| `customer-group` | 客户管理-集团集群 | `A03…【集团集群管理】.docx` |
| `rating` | 评级管理 | `B01…评级管理需求分册.docx` |
| `credit-corp` | 授信-对公 | `C01…【对公授信】.docx` |
| `credit-retail` | 授信-对私合作方 | `C02…【对私、合作方授信】.docx` |
| `credit-group` | 授信-集团 | `C03…【集团授信】.docx` |
| `credit-interbank` | 授信-同业 | `C04…【同业授信】.docx` |
| `limit-quota` | 额度-限额 | `D02…【限额管理】.docx` |
| `limit-ctrl-api` | 额度-管控接口 | `D03…【管控接口】.docx` |
| `loan-corp` | 用信-对公 | `F01…对公用信.docx` |
| `loan-retail` | 用信-对私 | `F02…【对私用信】.docx` |
| `disburse` | 放还款-放款 | `H01…【放款管理】.docx` |
| `repay` | 放还款-还款 | `H02…【还款管理】.docx` |
| `postloan-risk-class` | 贷后-风险分类 | `I01…【风险分类】.docx` |
| `postloan-warn` | 贷后-预警 | `I02…【贷后预警】.docx` |
| `postloan-check` | 贷后-检查 | `I03…【贷后检查】.docx` |
| `collection` | 催收管理 | `J01…催收管理需求分册.docx` |
| `product-mgmt` | 产品管理 | `K01…产品管理需求分册.docx` |
| `archive` | 档案管理 | `L01…档案管理分册.docx` |
| `smart-ctrl` | 智能控制配置 | `M01…智能控制配置需求分册.docx` |
| `portal` | 统一门户 | `O01…统一门户需求分册.docx` |
| `asset-preserve-ops` | 资产保全-日常辅助 | `P01…【日常管理及其他辅助】.docx` |
| `asset-preserve-npl` | 资产保全-清收处置 | `P02…【不良资产清收处置】.docx` |
| `digital-mobile` | 数字化信贷-面客移动端 | `Q01…【面客移动端】.docx` |
| `digital-loan-desk` | 数字化信贷-办贷端 | `Q02…【办贷端】.docx` |

### 3.2 P1 补洞（0824 无对应册时）

| moduleKey | moduleName | 建议源（根下域文件夹） |
|-----------|------------|------------------------|
| `collateral-info` | 押品-信息管理 | `押品管理/押品管理-押品信息管理-V1.0.0.docx` |
| `collateral-func` | 押品-功能 | `押品管理/押品管理分册_押品功能-V1.0.0.docx` |
| `system-mgmt` | 系统管理 | `系统管理/系统管理分册-V1.0.0.docx` |

用信域若要以「合同 / 变更」拆册（仅当用户要求跑根目录用信多册而非仅 F01/F02）：

| moduleKey | 源（根 `用信管理/`） |
|-----------|---------------------|
| `loan-contract` | `用信管理分册_合同管理文档-V1.0.0.docx` |
| `loan-change` | `用信管理分册_用信变更-V1.0.0.docx` |

---

## 4. Lead 编排流程

### Phase A — 盘点（Lead 亲自做，可派只读 explore）

1. 列出 P0 全部 `.docx`，对照 §3.1 生成 **工作表**（CSV/Markdown 表）：`moduleKey | moduleName | absSourcePath | status`。  
2. 扫 `data/kb/req/*`：已有 key 标 `exists`；`product-mgmt` 标 `upgrade-to-sliced`。  
3. 写 `docs/superpowers/agent-log.md` **开工声明**（范围：`data/kb/req/**`、本 skill 目录只读；禁入 flows/promote/staging/他线 WIP），并 **立即 commit**。  
4. 建议落地进度文件（可 gitignore 或提交）：`tmp/kb-req-batch/progress.md`（每模块一行：pending / slicing / sliced / failed）。

### Phase B — 派工（并行规则）

- **每个 worker 只领 1 个 `moduleKey`**（可一轮多 worker 并行，key 必须互斥）。  
- 推荐并发：3～5；officecli/大 docx 内存紧时降到 2。  
- Worker **不 commit**；Lead 每完成一批（如 5 个 `sliced`）统一 `git add data/kb/req/<keys>` 并 commit。  
- Worker 提示词必须包含：SKILL.md 路径、本文件 §1.2 禁区、该行的 moduleKey / moduleName / absSourcePath、目标 status=`sliced`、**禁止 drafts**。

### Phase C — 单模块标准作业（Worker；与 SKILL 步骤对齐）

1. **登记**  
   - `POST /api/v2/kb/req-modules`  
     `{ "moduleKey","moduleName","sourcePath":"<绝对路径>","note":"batch 0824" }`  
   - 或等价 `registerReqModule(...)`。  
2. **读源** — officecli 打开 `sourcePath`；剥标题中 `RQM_META*` 噪声；不改源文件。  
3. **chapters/** — 按文档目录拆章为若干 `.md`（建议文件名 `01-章标题.md`）；含标题路径、ZJJK（若有）、要点；与 SUT 差异标「待湿测」。  
4. **through-chains.md** — 可贯通主链（闭环目标、有序步骤、前置、章节出处）；无闭环则写明「无闭环主链」并列旁路。参考先例：`tmp/product-mgmt/req-mainchain.md`（产品库主链风格）。  
5. **更新 manifest** — `status: "sliced"`，刷新 `updatedAt`；保留 `warnings`。  
6. **自检 SKILL 检查清单** → 向 Lead 回报：章数、主链条数、绝对路径、是否触碰 flows（必须否）。

### Phase D — Lead 验收与收工

每模块验收：

- [ ] `data/kb/req/<key>/manifest.json` 存在且 `status===sliced`  
- [ ] `chapters/` 至少一个 `.md`，或 manifest/报告写明失败原因  
- [ ] `through-chains.md` 存在  
- [ ] 每章末尾 ZJJK 清单行机器可解析  
- [ ] `git status --short data/kb/flows` 无本批改动  

全部完成后：agent-log **收工**（完成模块列表 / commit hash / 失败表）并 commit。  
可选：跑 `node scripts/characterization/characterize-kb-req-modules.mjs`（不依赖业务 chapters）。

### Phase E — 逐模块逐叶湿测（A→B→C 团队流水线，2026-09-05 实测定型）

切片验收后的独立任务单元，**一次只推进一个模块**（用户拍板），三角色分工：

- **A 预备代理（文本，可与 B 前段并行）**：从 chapters 的 ZJJK 清单行建 `data/kb/req/<key>/wet-test.md` 判定表（SKILL 湿测节模板与词表）；存量模块章末缺标准清单行的先回补（SKILL「存量回补条款」）。
- **B 湿测代理（浏览器，全局唯一串行）**：登录 SUT 逐叶判定回填——共享浏览器**一次只放一个 B 进浏览器**；写操作黑名单（禁止一切落库动作）；**每完成一个主链组增量写回**（SKILL 执行规则）；回报必含统计/drift/blocked 清单 + **协议疏漏观察 1-5 条**，回报消息**不带任何截图图片**（防回传丢失）。
- **C 回填代理（文本，B 收口后）**：按 drift 分类学把 drift 回填 chapters（「> SUT 实测」双源标注）；跨模块观察汇总给 Lead。

**Lead 验收线（每模块 B 收口必做，不过关打回重测）**：

0. **机械闸门**：`node scripts/kb/wet-test-check.mjs <moduleKey>` 无 FAIL（叶集 diff/判定统计/blocked-drift 证据校验/drift 回填覆盖）；
1. 截图存在且 mtime 落在该代理执行窗口内；
2. 抽 2-3 叶开页面复核判定（match 与 drift 各至少一叶优先）；
3. blocked 必须有异常原文（console/后端）或补测条件；not-found 必须有导航尝试记录。

模块收口：Lead 验收后代 commit（wet-test.md + chapters 回填，子代理不 commit）；agent-log 阶段回报；**blocked 汇入 `data/kb/req/_blocked-backlog.md`**，待引擎线跑流程造出数据后回收补测；**跨模块观察汇入 `data/kb/req/_cross-module-observations.md`**（错误族/行为对照/SUT 多出页面/公共组件状态），引擎线接手时按路径取。

**元演化机制（第 2 轮修订新增）**：B 组回报的「协议疏漏观察」由 Lead 记入观察池，**攒 3 个模块统一做一轮 SKILL 修订**——先例：首轮 7 条疏漏全部来自 rating+customer-corp 两模块实战，契约是被湿测长出来的，不是预先设计的。

节奏：SUT 会话约 50 分钟过期——**一个模块一个登录窗口**；推进顺序按业务链（已收口：credit-corp → rating → customer-corp；后续 customer-common → credit-retail → …）。

---

## 5. Lead 可直接粘贴的开场指令（给自己）

```text
你是 Lead。目标：按 scripts/prompts/skills/req-doc-to-kb/USAGE.md，
带领 agent team 把 docs/天阳信贷系统需求文档 的需求分册导入 data/kb/req/。

硬规则：
- 先读 USAGE.md + SKILL.md；语料以 A_v5.2需求文档0824 为 P0。
- 只做需求 docx → registered→sliced；默认不出 drafts；禁止 flows/promote/staging。
- 并行时 moduleKey 互斥；子代理不 commit；你代写 agent-log 开工/收工并分批 commit。
- moduleKey 用 USAGE §3.1 表；sourcePath 用仓库内文件的绝对路径。
- product-mgmt 若已存在则升级切片，勿盲目 reset。

先做 Phase A 盘点，产出进度表后，再 Phase B 派工。不要一次派超过 5 个并行 worker。
```

### Worker 提示词模板

```text
你只处理一个模块，禁止改其他 moduleKey，禁止 commit，禁止写 data/kb/flows 与 promote。

读：scripts/prompts/skills/req-doc-to-kb/SKILL.md
按 USAGE.md Phase C 执行。

moduleKey: <KEY>
moduleName: <NAME>
sourcePath: <ABS_PATH_TO_DOCX>
目标：manifest.status = sliced；写 chapters/ 与 through-chains.md；不要写 drafts/。

完成后只回报：Status / 章数 / 主链条数 / 文件列表 / 任何失败原因。
```

### B 湿测代理提示词模板（Phase E，蒸馏卡——派发时逐项保留硬约束）

```text
你是湿测执行代理，负责 <KEY> 模块逐叶真机湿测。你拥有 Playwright MCP 浏览器（snapshot→click）。
只许操作浏览器、截图、编辑 data/kb/req/<KEY>/wet-test.md；禁止 git、禁止写 agent-log、
禁止碰其他模块文件、禁止写 data/kb/flows。

必读：SKILL.md「湿测（视图3）」节；data/kb/req/<KEY>/wet-test.md（判定表，逐行回填）；
chapters/ 各章（文档口径）。

SUT：http://test.creditv5p2.tansun.com.cn/。会话约 50 分钟过期；若跳 #/login：
用户名 701994、密码 1，验证码/手机验证码留空，点【登 录】；中途过期就重登继续。

铁律：
- 写操作黑名单：确定/提交/保存/暂存/删除/作废/撤销/同意等落库动作一律不点；
  向导/弹窗/抽屉核对结构即止，截图后关闭。
- 只读入口优先【查看/查看详情】；无可达记录判 blocked+补测条件。
- 每行判定含日期；blocked 留异常原文（console/后端）；drift 必标类别。
- 截图 tmp/kb-wet-test/<KEY>/<编号>-<ZJJK>-<slug>.png。
- **链组增量写回**：每完成一组立即写回 wet-test.md，禁止攒最后。
- 回报纯文本、不带任何截图图片；必含：统计 / drift 清单 / blocked 清单 /
  跨模块观察（错误族归集·行为对照·SUT 多出页面）/ 协议疏漏观察 1-5 条。
```

### Lead 湿测开场指令模板（Phase E，给自己/接手会话）

```text
继续 req 作业区逐模块逐叶湿测战役（协议：SKILL.md「湿测」节 + USAGE.md Phase E）。
本窗口只做一个模块：<KEY>（下一模块待本模块收口后）。
1. 读 data/kb/req/<KEY>/wet-test.md（若无可按 chapters ZJJK 清单行建表）；
2. 登录 SUT（入口/账号见 wet-test.md 运行记录），主线程 Playwright MCP 串行；
3. 逐叶判定回填，写操作黑名单：禁止一切落库动作（确认/提交/作废/删除/保存）；
4. drift 按 SKILL 分类学回填 chapters（以 SUT 实测为准）；
5. 收口：commit wet-test.md + agent-log 阶段回报；blocked 留补测条件。
```

---

## 6. 失败与跳过策略

| 情况 | 处理 |
|------|------|
| officecli 读失败 / 损坏 docx | manifest 保持 `registered`；在 `chapters/_ERROR.md` 或进度表记失败；不阻塞其他模块。**降级路径**：browser_use env python（`D:/anaconda3/envs/browser_use/python.exe`）+ python-docx 提取段落/表格、解码 RQM_MERMAID base64；临时文件用后清理（6 批切片 5 批走此路径） |
| 超大文档超时 | 先切目录级大纲 chapters，through-chains 只列候选主链标题；note 标明 `partial` |
| moduleKey 冲突 | 禁止覆盖他模块；换更细 key（见 §3） |
| API 501/404 | 改直调 service / 手建目录，继续切片 |
| 湿测叶 blocked | 判定照填 `blocked` + **补测条件**；拦截类必须留异常原文（后端 BizException 抄全文，前端拦截抄 console 原文）；不阻塞其余叶 |
| 子代理回传丢失（`mm_items['image'][0]` 类报错） | **先产物考古再重派**：查截图目录 mtime/文件名进度判断实际走到哪（实例：customer-corp 首派走完 55 叶死于回传）；重派提示词加「链组增量写回」+「回报不带图」 |
| blocked 补测兑现 | Lead 阶段回报汇总各模块 blocked 台账；待引擎线跑流程造出数据（在途审批/已传授权书记录等）后回收补测，不从本线强造 |

---

## 7. 与「湿测 / 正式 KB 卡」的边界

本批只做到 **需求作业区 `sliced`**。  
正式 `data/kb/flows/*.json`、湿测 staging、promote **另开任务**，且需用户明示「出草稿卡」才会写 `drafts/`。

---

## 8. 快速自检命令

```bash
# 作业区列表（控制面已启动时）
curl -s http://localhost:4097/api/v2/kb/req-modules

# 服务层 pin（不依赖业务切片）
node scripts/characterization/characterize-kb-req-modules.mjs

# 湿测产物机械验收（防假完成闸门，模块收口前必跑）
node scripts/kb/wet-test-check.mjs <moduleKey> [moduleKey2 ...]

# 本批不得改动正式卡
git status --short data/kb/flows
```
