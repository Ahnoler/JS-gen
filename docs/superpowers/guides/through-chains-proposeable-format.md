# 贯通主链（through-chains.md）可 propose 格式规范

> 给文档改写线（Zcode / 文档 agent）用。  
> 关联：需求草稿向导 step1 的 `canProposeAtoms` 门控；解析实现 `src/services/req-draft-traj/parse-through-chains.js`。  
> 日期：2026-09-08

## 1. 现象

`GET /api/v2/kb/req-modules` 每行有：

| 字段 | 含义 |
|------|------|
| `hasThroughChains` | 目录下是否存在 `through-chains.md` |
| `canProposeAtoms` | **确定性解析**后是否至少有一条「表格步骤」 |

SPA「需求草稿向导」只允许 `canProposeAtoms === true` 的作业区点选生成候选。

**实扫（2026-09-08）**：`data/kb/req/` 下约 30 个模块里，**仅 `product-mgmt` 为 true**。其余文件虽在，但步骤不是解析器能吃的表格式 → propose 会得到 0 原子。

这不是前端 bug，也不是要先扩解析器；优先 **把主链文档改写成金标格式**（与 `product-mgmt` 主链 A 一致）。

## 2. 解析器硬约束（改写必须满足）

源：`parseThroughChainsMarkdown` / `hasProposeableChainSteps`。

1. **链标题必须是三级标题**：行首 `### …`（`##` 不算链起点）。
2. **步骤必须是 Markdown 表**（链标题之后、下一 `###` 之前的 `|` 行）。
3. **表头至少要能识别两列**：
   - 「步骤」（或含「步骤」的列）→ action
   - 「ZJJK」（大小写不敏感）→ zjjk  
   缺任一列 → 整张表被丢弃。
4. **有步骤行且 `步骤` 单元格非空** → 该链才会进入 `chains[]`。
5. `canProposeAtoms` = 至少一条链 `steps.length > 0`。

可选但推荐的列：`#` / `序号`、`页面/弹窗`、`关键按钮`。

**不算通过的写法（当前常见失败态）**：

- `## 主链 1：…` + `1. 2. 3.` 编号列表（如 `rating`）
- `### 主链 A：…` + `- **有序步骤**：` + 编号列表、**无步骤表**（如 `customer-corp` 多数链）
- 只有闭环目标 / 前置条件散文，没有步骤表
- 表头没有「步骤」或没有「ZJJK」列

## 3. 金标样例（摘自 product-mgmt 主链 A）

路径：`data/kb/req/product-mgmt/through-chains.md`

```markdown
### 主链 A：产品建库→配置→启用（核心闭环）

- **闭环目标**：……
- **前置条件**：……
- **章节出处**：……

| # | 步骤 | 页面/弹窗 | ZJJK | 关键按钮 |
|---|------|-----------|------|----------|
| 1 | 进入产品库，加载产品树（总行全按钮） | 产品库管理主页 | ZJJK00110131 | 进入/【刷新产品树】 |
| 2 | 新增一级分类（父层级空，层级=1） | 新增产品弹窗（标签=分类） | ZJJK00094361 | 【新增一级分类】→【确定】 |
```

说明：同文件内主链 B/C/D… 若仍是「有序步骤」列表，**当前也不会被解析**；向导能亮，是因为主链 A 已有表。改写时建议 **每条要进入 propose 的链都补表**。

## 4. 改写作业 SOP（纯文档，不改代码）

对每个目标 `moduleKey`：

1. 打开 `data/kb/req/<moduleKey>/through-chains.md`。
2. 保留元信息 / 「0. 菜单与页面锚点」等说明节（可用 `##`）。
3. 每条候选主链：
   - 标题改为 `### 主链 X：…`（字母或数字均可；解析用「主链」后片段生成 `chainId`）。
   - 保留闭环目标、前置条件、章节出处（列表即可）。
   - 把原「有序步骤」**逐条落成表行**（不要删业务信息，可压缩进「步骤」单元格）。
4. ZJJK：从步骤原文的 `ZJJK…` / `【ZJJK…】` 抽到 ZJJK 列；多码可用 ` / ` 连接；暂无则写 `—`（列仍须存在）。
5. 旁路 / 非闭环可留在文末，**不要**用 `### 主链` 开头，或明确不配步骤表（避免误 propose）。
6. **自检**（改完立刻跑，无需重启以外的环境依赖）：

```bash
# 在 JS-gen 根目录；服务需已加载含 canProposeAtoms 的代码
node --input-type=module -e "
import { listReqModules } from './src/services/kb-req-modules.js';
const rows = await listReqModules();
const hit = rows.filter(r => r.canProposeAtoms).map(r => r.moduleKey);
console.log('canProposeAtoms=true:', hit.join(', ') || '(none)');
"

# 或单文件解析
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { hasProposeableChainSteps, parseThroughChainsMarkdown } from './src/services/req-draft-traj/parse-through-chains.js';
const md = readFileSync('data/kb/req/<moduleKey>/through-chains.md','utf8');
const { chains } = parseThroughChainsMarkdown(md);
console.log('proposeable', hasProposeableChainSteps(md), 'chains', chains.map(c => ({ id:c.chainId, steps:c.steps.length })));
"
```

7. 可选：对已改写模块 `POST /api/v2/kb/req-modules/<moduleKey>/draft-traj/propose`（body 按现有 API），期望 `atoms.length > 0`。  
   **不要**提交 `data/kb/req/**/.draft-traj-propose.json` 缓存。

## 5. 建议改写优先级（业务向导）

用户侧已点过、易踩空的作业区优先：

| 优先级 | moduleKey | 现状摘要 |
|--------|-----------|----------|
| P0 | `customer-corp` | 已有 `### 主链`，缺步骤表 |
| P0 | `rating` | `## 主链` + 编号列表 |
| P1 | 主干业务链其余模块（loan-corp、credit-corp、…） | 多数同 rating/散文态 |
| — | `product-mgmt` | 已通过（主链 A 有表）；可顺带把 B+ 也表格化 |

一次可只改 1～2 个模块，改完自检 `canProposeAtoms` 再交下一批。

## 6. 明确不做（本任务边界）

- **不改** `parse-through-chains.js` / propose / Vue（扩解析器支持 `##`/编号列表属另开需求，需 Lead）。
- **不动** 轨迹查询 WIP、录制/回放、DB。
- **不** 为通过门控而空表灌水；步骤须来自现有需求口径。

## 7. 验收清单

- [ ] 目标模块 `canProposeAtoms === true`
- [ ] `parseThroughChainsMarkdown` 对该文件 `chains.length >= 1` 且各链 `steps.length >= 1`
- [ ] 向导列表中该作业区「可生成候选=是」，可点选；hover 禁用文案不再出现在该行
- [ ] （可选）propose 返回 `atoms.length > 0`
- [ ] 仅文档 diff；无 propose 缓存入 commit

## 8. 参考路径

- 金标：`data/kb/req/product-mgmt/through-chains.md`
- 解析：`src/services/req-draft-traj/parse-through-chains.js`
- 列表门控：`src/services/kb-req-modules.js` → `listReqModules`
- 向导 UX：`vue-project` → `src/views/ui-recording/req-draft-wizard/index.vue`
