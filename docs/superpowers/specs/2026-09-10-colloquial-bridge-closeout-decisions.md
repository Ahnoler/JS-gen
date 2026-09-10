# 口语桥接收尾裁定 + 方向 5 后续（Lead 决策记录）

> 日期：2026-09-10 · 记录：DSH reviewer
> 上游：G 判决 [`2026-09-10-colloquial-bridge-g-verdict.md`](../reports/2026-09-10-colloquial-bridge-g-verdict.md)（`666e0215`）+ 收尾复核（`33da2125`）· 实施报告 [`2026-09-10-colloquial-bridge-report.md`](../reports/2026-09-10-colloquial-bridge-report.md)
> 本文件 = Lead 把「F-4 / 方向 5 两条路径」三项待决**全部委托 reviewer 裁定**后的结论记录。
> **一句话：F-4 采用最小留痕（不做硬拦）；方向 5 的零依赖词面桥支线关闭；「回收口语语料」条件立项但当前 BLOCKED（数据源不可达）；embedding 不立项。**

## 1. 裁定汇总

| # | 议题 | 裁定 | 依据 |
|---|---|---|---|
| **R-1** | F-4：`loadSynonyms()` 不读 `status` | **最小留痕**：不改加载行为、不改指标/阈值/exit code；`--synonyms` 结果记录资产 `status`，非 `active` 时向 stderr 打一行告警；配 1 条 pin | §3 |
| **R-2** | 方向 5 之「零依赖词面桥」 | **关闭**（两向证尽：失败反推 1/115；语料正向建表 0/245，E 层 0/50 字面重叠为构造性） | §4.1 |
| **R-3** | 方向 5 之「回收口语语料建表」 | **条件立项，当前 BLOCKED**：本机 DB 不可达、LLM 端点不可达、仓库内无用户口语语料（实测见 §4.2）。前置 = Lead 提供数据源（§4.3 清单）；达标判据沿用本线（E ≥0.25 / 全新地面 ≥4） | §4.2-4.4 |
| **R-4** | embedding 立项 | **不立项（押后）**：① 与 R-3 同受"配对语料"前置阻塞（没有"口语↔卡片"配对，embedding 的收益无法在 E 层之外被验证）；② 仓库无计算侧与离线降级；③ 热态 p95 0.14ms → 逐原子网络调用不可行 | §4.5 |
| **R-5** | 环境恢复前的可执行工作 | **只做收尾（R-1 + F-2/F-5）**；方向 1/2 均需真实环境（SUT/LLM/库），当前不可执行；若 Lead 短期内无法提供环境，可选离线替代项 = KB 资产治理门禁 v1（§5.2） | §5 |

## 2. 待办与归属

| 事项 | 归属 | 形态 |
|---|---|---|
| F-2 收口（`T2-bridge.txt` `git add -f`） | 实施方 | 与 F-5 同 commit |
| F-5 收口（生成脚本幂等化 + 头注释警示） | 实施方 | 同上 |
| R-1（F-4 最小留痕 + pin + 门禁复跑） | 实施方 | 独立 commit |
| 台账对齐（报告 §8 + agent-log 收工） | 实施方 | 第三 commit |
| 数据源/环境取证（§4.3） | **Lead** | 提供可达端点或导出样本 |
| embedding 边界 5 项（端点/模型/存储/离线降级/延迟预算） | **Lead** | 仅当 R-3 数据前置满足后再议 |

## 3. R-1 详设（F-4 最小留痕）

**现状**：`scripts/kb/recall-eval.mjs:305 loadSynonyms()` 只校验 `asset.entries` 是数组，**不读 `status`**；全仓仅该文件两处引用（:305 定义 / :335 CLI 调用），无其他 importer（已核）。故 `status:"archived"`（口语桥表）与 `status:"unvalidated"`（P0 词表）都是**文档性**的。

**为什么不硬拦**：加 `status` 过滤会让 `--synonyms` 对 P0 的 `data/kb/synonyms.json` 变成静默 no-op，**已冻结的 P0/v2 产物不可复现**（例如 T3-on.json 记录 67 条加载）——用"改动度量语义"换取"防误用"，代价与收益不成比例。真正的防误用闸门是接线门（B5 端到端证明 + moduleKey scope），不是资产字段。

**改什么（三处，全部加法）**：
1. `recall-eval.mjs`：`--synonyms` 模式下若资产声明了 `status`，把它记入 `result.synonyms.status`（**仅在资产声明时出现**，未声明则字段不出现 → 历史产物形状不受影响）；
2. 同一处：`status` 存在且 ≠ `active` 时向 **stderr** 打一行告警（例：`[recall-eval] synonyms asset status="archived" — 仅限度量，禁止接线`）；**不影响 exit code、不写入 metrics**；
3. `characterize-kb-recall-eval.mjs` 增 1 条 pin（5 → 6 passed）。

**明确不改**：加载行为（仍全量加载）、`metrics` 任何字段、`compareWithBaseline`、阈值 floor、`DEFAULT_SYNONYMS` 指向、`data/kb/synonyms.json`、`data/kb/colloquial-bridge.json`。

**验收（缺一不可）**：
- pin 三态：① 带 `status:"archived"` 的资产 → 条目**全量加载**（计数不变）+ status 被暴露；② 无 `status` 的资产 → 行为与现状完全一致（无新字段、无告警）；③ 告警不改变 exit code 与指标。测试资产写 `tmp/`，不得落 `data/`；
- `characterize-kb-recall-eval` **6 passed**、`characterize-flow-card-recall` **26 passed**；
- `--synonyms data/kb/colloquial-bridge.json` 复跑：六项指标与 `tmp/kb-bridge/T3-on.json` 逐位相同（除 `generatedAt`/`gitHead`/**新增的 status 字段**/延迟计时）——即"只加留痕，不碰度量"。

## 4. 方向 5 的收口与前置

### 4.1 R-2 关闭理由（已两向证尽）

| 方向 | 方法 | 实测 |
|---|---|---|
| 失败反推（P0 线） | 从 v1 失败集反推词表 | 泛化 **1/115**（CI 下界 0.001，与 0 不可区分） |
| 语料正向（本线） | A 卡面 / B 需求文档 / C 湿测 drift 域内语料建表 67 条 | v2 全表 **增量 0**、E 层 **0.100 不动**、27 条可命中/30 对字面相遇/17 对点火/**0 对翻 gold** |

结构性原因（reviewer 独立复算）：E 层 50 条 query 与桥接 term 的**字面重叠 = 0**；三类语料建出的全是「领域词↔领域词」措辞变体。机制形态（term 必须字面出现）**按构造够不着**纯口语。→ 该支线没有剩余假设可测，关闭。

### 4.2 R-3 的阻塞证据（reviewer 本机实测，2026-09-10）

| 前置 | 实测 | 结论 |
|---|---|---|
| 生产轨迹库（`trajectory.task` = 用户需求原文） | `getDB()` → `trajectory` count：**acquireConnectionTimeout 10s 超时** | **不可达** |
| LLM（`LLM_BASE_URL/LLM_API_KEY` 已配置） | `callLLM('只回复两个字：可用')` → **fetch failed（10.7s）** | **不可达** |
| 仓库内用户口语语料 | `grep '"requirement"' data/` → **0 命中**；`data/kb/req/*/drafts/*.json`（177）全部 `draftFrom:"req"` = 卡片式领域草稿；`data/kb/staging/recall-events.jsonl` 88 条 `{query,flowRef}` 是 **agent 任务草稿体**（"点击「查询」。预期结果：…"），仅 5 个不同 flowRef | **无弹药** |

> 附注：`propose-runs.jsonl` 显示 2026-09-09 曾成功跑过真实 LLM propose（120s/次），说明**网络是时变的外部条件**，不是仓库属性。故此支线标记为 BLOCKED 而非"证伪"。

### 4.3 Lead 取证清单（其一即可解阻塞）

**A. 可达的只读端点**：`config/.env` 中 `DB_HOST/DB_PORT/DB_USER/DB_PASS/DB_NAME` 可用（本地或内网），且禁止写操作。
**B. 导出样本**（推荐，脱敏、可版本化）：`trajectory` 表导出 JSONL/CSV，**≥500 条**、覆盖 ≥5 个模块，字段至少含：
`id`、`task`（用户需求原文）、`record_status`、`function_id`/`moduleKey`、该轨迹的卡片引用（如 `kb_flow_ref` 或原子级 `suggestedFlowRef`）、`created_at`。
脱敏要求：不含账号口令/客户姓名证件号（如有，替换为占位符即可，**保留措辞原文**）。
**C. LLM 可达**：仅当要做"真实 LLM 草稿质量评测"时才需要（本线不需要）。

### 4.4 go/no-go 判据（拿到 A 或 B 之后的第一步，先判可行性再建表）

1. **配对可得性**：能构造 `(用户原文, 卡片)` 配对 ≥200 条、≥3 个模块；否则 **NO-GO**（弹药不足，不再建表）；
2. **口语性抽检**：盲抽 20 条原文，≥60% 判为"用户口语/非文档腔"（如"把客户的口子先封住"这类）；否则 **NO-GO**（说明库里也是领域腔，桥接无从谈起）；
3. **物理隔离**：建表语料与 v2 评测集（`kb-recall-eval.v2.json`/`kb-recall-failures.v1.json`）零交集，沿用本线 SOP；
4. **达标门不变**：E 层 ≥0.25、**全新地面（v2-new）增量 ≥4**、A ≥0.95、B/C/D 不掉、零新增 FP；
5. **达标才接线**，且必须走 B5 端到端证明（真实 `proposeDraftTrajectories` + 假 LLM + moduleKey scope 门控）。
   → 任一 NO-GO：方向 5 彻底收口，不再追加投入。

### 4.5 R-4 embedding 押后

即便 R-3 的数据前置满足，embedding 仍需 Lead 先定 5 项边界（端点/模型/存储/离线降级/延迟预算），且仓库内**无计算侧**（`special_element` embedding 列仅 schema）、热态 p95 **0.14ms** 与逐原子网络调用不兼容。**先解 R-3（有配对语料），再议语义侧**——顺序不可颠倒。

## 5. 下一步优先级（R-5）

1. **立即**：F-2/F-5 收口 + R-1 实施 + 台账（[收尾计划](2026-09-10-colloquial-bridge-closeout.md)）。
2. **等环境**：方向 2（KB 价值的 A/B 证明）——最高价值，但需真实 SUT + LLM；方向 1（atom → record → replay 一条真实交易）需 SUT/浏览器。两者在 DB/LLM 不可达时**均不可执行**。
3. **若环境短期不可恢复**（可选的离线替代项，仅在被指派时立项）：**KB 资产治理门禁 v1** —— 把 `scripts/kb/wet-test-check.mjs` 的模块级机械检查提升为**全局门禁 + 覆盖率地板**（卡 ↔ 章节 ↔ 湿测叶 ↔ 血缘的覆盖矩阵、孤儿资产检测、新鲜度提示），并处置已发现的孤儿：`data/kb/flow_lineage.json`（72/84 映射）**当前无任何运行时消费者**（T1b 血缘作用域回退后遗留）。

## 附录：本次裁定的实测证据（可复核）

```bash
# F-2：修正只在工作区，HEAD 未修
git status --porcelain tmp/kb-bridge/                 # → " M tmp/kb-bridge/T2-bridge.txt"
git show HEAD:tmp/kb-bridge/T2-bridge.txt | Select-String note
#   → "裁决规则与逐条理由见 t2-build-table.mjs 头注释（…）"   ← 旧文本仍在库

# F-5：入库脚本会把归档资产还原
git show HEAD:tmp/kb-bridge/t2-build-table.mjs   # 产物字面量 status:'candidate'，无 archiveNote/archivedSemantics；头注释 Run: node …

# 度量不受收尾影响：entries 逐位未变
#   3ea6bab5 与当前表的 entries sha256 均为 eb4ec272ec40e3a76d38febc19009d26d476533c5a0761ee75ffcaacbb1e6197（67 条）

# R-3 阻塞：库/LLM 不可达
node -e "…getDB()('trajectory').count()"              # → Knex: Timeout acquiring a connection（10s）
node -e "…callLLM('只回复两个字：可用')"                # → fetch failed (10.7s)
```
