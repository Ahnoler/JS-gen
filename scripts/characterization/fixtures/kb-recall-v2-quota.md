# KB 召回评测集 v2 — 分层配额表（T0 冻结）

> 日期：2026-09-10 · 线：recall-eval-v2（spec §10 决策 A1–A6 已批，不再回问）
> v1 盘点（机械统计，`T0-inventory.txt`）：**130 条 / A40 B30 C15 D15 N30 / 62 卡**，excluded 4，无卡触及单卡 4 上限（分布：25 卡×1、31 卡×2、6 卡×3）。

## 配额表

| 层 | v2 目标 | 来源 | 备注 |
|---|---|---|---|
| A 词面一致 | **55**（55–60） | v1 40 原样 + 新增 15 | 新 query 以卡面 flow/keywords 词面直给 |
| B 改写同义 | **45**（45–50） | v1 30 原样 + 新增 15 | 同义改写但允许词面部分重叠 |
| C 场景长句 | **20** | v1 15 原样 + 新增 5 | 多步骤场景叙述 |
| D 别名/短码 | **20** | v1 15 原样 + 新增 5 | 系统码/页面码/英文短码 |
| **E 口语改写（新层）** | **50** | 全新 | **三子模式各 ≥15**：`colloquial-synonym`（名词同义）/ `colloquial-verb`（动词短语）/ `colloquial-domain`（领域口语）；每条带 `pattern` 字段；**不得出现卡面原词** |
| N 负样本 | **55** | v1 30 原样（跨域）+ 近域新增 25 | 近域=同业务域但**无对应卡**（含 N-002 类靶子），每条带 `whyNegative` |
| **合计** | **目标 245 / 底线 ≥235**（正 ≥180 / 负 ≥55） | v1 130 原样 + 新增 ≥105 | 本表规划 +115 = 245：A+15 B+15 C+5 D+5 E+50 N+25 |

**落地计划**：新增 115 条 → 总 245；正样本 190（≥180 ✓）/ 负样本 55（≥55 ✓）。

## 覆盖约束（DoD）

- 正样本覆盖 **≥70 卡**（v1 62 + 新增净增 ≥8 卡）；单卡 **≤4**；query **无重复**（对 v1 与 v2 新增都查重）；无陈旧 gold（gold 必须在 `data/kb/flows/*.json` 现存 stem 中）。
- 新增条目一律 `source: "v2-new"`；v1 搬入条目 `source: "v1"`（T1 脚本搬运，禁止手抄）。
- `relabels` 默认空（例外通道，逐条 why + reviewer 复核）。

## 标注纪律（T2 执行，G2 专查）

1. **禁跑匹配器**：标注期间不得运行 `recall-eval.mjs` / `rankFlowCards` / `matchFlowForAtom` 对候选 query 求值；gold 只从语料出发（`data/kb/flows/*.json` 的 flow/aliases/keywords/menu_path/nodes + `data/kb/req/*/through-chains.md` 步骤 + 湿测叶名）。反推实现输出即作废。
2. **建表隔离**：本线不构建词表/别名/阈值类资产；T5 词表只允许用 v1 失败集（35 条，`kb-recall-failures.v1.json` 只读）或现有 `data/kb/synonyms.json`（v1 失败反推产物）——**v2 条目在构建期物理排除在上下文之外**。
3. **歧义进 `excluded`**：query 可合理命中 ≥2 张无先后依据的卡 → 不入 entries，进 `excluded` 附 why。宁少勿脏。
4. **双人复核**：主标后换视角复核（业务合理性 + gold 唯一性 + 层归属），复核记录落 `tmp/kb-eval-v2/T2-labeling-log.md`。
5. **E 层纪律**：query 不得出现卡面 flow/aliases/keywords 原词（同义改写的全部意义所在）；`pattern` 三选一必填。
6. **N 层纪律**：跨域（v1 原样）+ 近域 25 条全新（同业务域、无对应卡，例：贷款展期、利率试算、还款计划变更等被测系统尚无卡的域）；每条 `whyNegative` 说明为何应拒答。
