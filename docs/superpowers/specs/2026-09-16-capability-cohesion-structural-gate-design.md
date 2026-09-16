# 能力内聚结构硬闸 — 设计

> 日期：2026-09-16  
> 状态：**已批准；本文件只定规格，本轮不实现**  
> 基线：`uara_V1.2`（含已合入的 [PR #41](https://github.com/Ahnoler/JS-gen/pull/41)）  
> 相关：[`2026-09-15-atomic-draft-tx-split-boundary-design.md`](2026-09-15-atomic-draft-tx-split-boundary-design.md) §3.7 / §5；[`2026-09-07-req-to-draft-traj-design.md`](2026-09-07-req-to-draft-traj-design.md)；线上 prompt `scripts/prompts/req-draft-traj-atomize-prompt.md`；`src/services/req-draft-traj/{propose,atom-depend,flow-card-guide,propose-cache}.js`  
> 决策：用 **taskDraft 步骤组分类 + 序列规则** 做机检能力内聚；不引入产品树层 / 按钮文案场景黑名单；代码闸为事实源，prompt 只轻量呼应。

---

## 1. 问题

PR #41 已落地（`uara_V1.2`）：

- 物化后空 `produces` 硬拒 `missing_depend_fields`
- `PROPOSE_CACHE_VERSION = 4`
- atomize prompt 改为 XML 分区；`<bad>` 已含同页多能力（维护+排序形态）与维护缺定位

湿测 **重新 propose**（cache v4）后仍不足：

| 病灶 | 现状 | 为何现有闸打不中 |
|------|------|------------------|
| `produces` 有值但质量差 | 常把 **atom `title` 原样当作唯一 produce 键**（title-as-key 刷过空字段闸） | `missing_depend_fields` 只查非空 |
| 同页多能力合写 | 「维护基本信息」与「上移/下移」仍进 **同一** `taskDraft` | 往往只有一次【保存】，`multi_persist_task_draft` 不触发；依赖图也不看步骤语义 |
| 维护缺定位准备 | 维护笔跳过查询/搜索/选中，直接打开表单改字段 | prompt `<bad>` 约束模型，无结构闸；本轮不新开 `missing_locate_prep` 拒因（见 §6、§8） |

空 produces 硬闸是必要前置，**不是**能力内聚的充分条件。

---

## 2. 目标与非目标

### 2.1 目标

机检 **能力内聚**：同一 atom 不得把同页上两项可独立验收的业务能力写进一份 `taskDraft`。

约束必须是 **通用动词族 / 步骤角色**，禁止：

- 产品树层级清单（一级/子类/产品必须拆）
- 具体按钮名或菜单黑名单（禁止写死「不得出现上移」或「不得出现维护基本信息」）

「上移/下移」与「维护/修改」只作为 **通用 UI 动词族** 的例子，用来说明分类，不是场景法。

### 2.2 非目标（本轮明确不做）

- 实现本闸（本文件是规格；plan / 代码另开任务）。
- validate-retry：被拒后第二次 LLM 重切。
- 场景黑名单（模块/菜单/按钮文案禁表）。
- 流程卡拓扑重写（不改 `data/kb/flows` 闭环切分语义）。
- 完整 `produces` 语义词典（键必须是业务对象名等）；本轮只打 title-as-key。
- 用本闸替代 `dataDependsOn` / `dangling_data_depend` / `self_produce_depend` 依赖图。
- 录制运行时按能力调度。

---

## 3. 与既有闸的关系

| 闸 | 职责 | 本轮 |
|----|------|------|
| `missing_depend_fields` | 物化后 `produces` 为空 | 保持；不够 |
| `self_produce_depend` | `produces ∩ dataDependsOn` | 保持 |
| `dangling_data_depend` | 非 preset 依赖键同批无 produces | 保持 |
| `multi_persist_task_draft` | `countPersistConfirms(taskDraft) > 1` | **保持**；多次落库仍走它 |
| `multi_write_atom` | 非 flowGuided 多写 / 闭环不共享 | 保持 |
| **`multi_capability_task_draft`（新）** | 同 atom 多项非准备能力，即使只有一次保存 | **本规格新增** |
| **`produces_eq_title`（新）** | `produces` 在规范化后精确等于 `title` | **本规格新增**（质量闸，非内聚闸） |

**分工一口径：**

- 多次【确定】/多次保存动词 → 仍只报 `multi_persist_task_draft`（先于新闸，见 §7.2）。
- 一次保存 + 夹带另一项能力（维护后又上移）→ 本闸 `multi_capability_task_draft`。
- 依赖谁先于谁 → 仍只走 atom-depend 图；本闸不改写、不补全 `produces`/`dataDependsOn`。

[`2026-09-15` §3.7](2026-09-15-atomic-draft-tx-split-boundary-design.md) 曾写「能力内聚只在 prompt、不为按钮文案加硬拒」。本规格 **升级** 为结构硬闸，但仍遵守「无场景黑名单」：硬的是步骤角色序列，不是某几个产品按钮名。

---

## 4. 核心算法（批准）

输入：物化并 `sanitizeTaskDraftKeyData` 之后的单笔 atom（`title`、`taskDraft`、已 `normalizeProduces` 的 `produces`）。  
输出：通过，或 `{ reason }` 硬拒。不改写 `taskDraft`。

### 4.1 解析为步骤组

把 `taskDraft` 切成 **步骤组**。一组 = 一个编号步骤及其 `操作：` 块。

1. 丢弃文末元数据，不参与分类：
   - 以 `来源：` 开头的行起，直到文末或「关键数据」块之前；
   - 「关键数据」标题行及其后 KV 行。
2. 按编号步骤切分。编号行匹配（实现须覆盖现网两种写法）：
   - `^\s*\d+、`（主路径，fallback/`buildTemplateTaskDraft` 与 prompt 样例）
   - `^\s*\d+[\.．]\s+`（容错）
3. 一组的范围：从该编号行到下一编号行（不含）或元数据边界。
4. 组内 **动作文本（haystack）**：
   - 若存在 `操作：`（全角）或 `操作:`（半角），取该标记之后的文本（可跨行到组末）；
   - 否则取整组正文（编号前缀可剥可不剥，分类用正则，不依赖编号）。
5. 空组（无可见动作文本）跳过。
6. 无任何编号步骤时：把去掉元数据后的整段当作 **一组**。

湿测/fallback 常见形态（须能切出 3 组）：

```
1、新增一级分类，操作：【新增一级分类】→【确定】
2、选中分类下新增子分类，操作：【新增分类】→【确定】
3、分类下新增产品，操作：【新增产品】→【确定】
```

prompt 正例形态（无 `操作：` 亦须能切组，整行当 haystack）：

```
1、进入功能页，等待加载
2、搜索/定位并选中已有对象
3、打开该项能力对应的表单或页签，填写本能力字段
4、一次【保存】成功
```

### 4.2 组分类（三桶 + 闭环尾特例）

对每组 haystack 做三类标记（可同时命中，再按下面优先级收成 **一个角色**）。

#### A. 定位准备白名单（locate-prep）

仅当服务于 **打开/找到操作对象**，不含另一项可验收能力。命中词（中文，含子串即可）：

| 意图 | 词面（通用，非场景） |
|------|----------------------|
| 查询过滤 | `查询` `搜索` `过滤` `筛选` |
| 选中 | `选中` |
| 点行/节点 | `点击行` `点击节点` `点行` `点选节点`；`点击` 且同行出现 `行` 或 `节点` |
| 打开/进入目标 | `打开` `进入`（进页/打开表单或页签；不是「打开后立刻上移」那种夹带） |
| 展开 | `展开` |
| 切页签 | `切换页签` `切页签`；`切换` 且同行出现 `页签` 或 `tab`（大小写不敏感） |
| 进页附属 | `等待加载` `等待` `加载` `刷新`（无写操作） |

`打开`/`进入`/`切换页签` **只有在该组没有 other-family 命中时** 才算 locate-prep（「仅用于打开目标」）。

#### B. 落库闭环（persist）

命中任一即视为含闭环词：

- 词面 `确定` / `保存` / `提交`（含 `【确定】`、`确定】`、`【保存】` 等）；
- 复用现有 `isPersistBoundaryAction`（`src/services/req-draft-traj/flow-card-guide.js`）：字符串 haystack 走 `PERSIST_BOUNDARY_RE`（`保存|提交|(?<![未已])启用|禁用|克隆|删除|作废|撤销(?!查询)|确定`）。组内若将来带 `buttons` 字段，对象形态与现闸一致：`action` 用全正则，`buttons` 只认 `确定`。

**通用闭环尾（closer）** 与 **闭环即能力** 要分开：

- **Closer：** 仅 `确定` / `保存` / `提交`（及带【】变体）。它们 **结束** 主能力，**不** 单独构成第二项能力。
- **Persist-as-capability：** `isPersistBoundaryAction` 中非 closer 的词（`启用`/`禁用`/`删除`/`克隆`/`作废`/`撤销`）。若一组 **只含** 定位 + 这类词 + 可选 closer，则该项 **就是** 主能力（例如「选中 → 启用」）。

`未启用`/`已启用` 对 `启用` 的误匹配排除规则与现函数一致，本闸不得放宽。

#### C. 其它能力（other）

定位白名单与 closer（`确定`/`保存`/`提交`）之外的、可独立验收的写/改操作。用 **通用动词族** 识别（不是按钮黑名单、不是产品树层）：

| 族 id | 词面（子串） | 说明 |
|-------|--------------|------|
| `reorder` | `上移` `下移` `置顶` `置底` `排序` | 列表侧顺序能力 |
| `maintain` | `维护` `修改` `编辑` `填写` `录入` | 表单侧改字段 |
| `create` | `新增` `添加` `创建` `新建` | 新建对象 |
| `delete` | `删除` `移除` | 与 persist-as-capability 重叠时见下 |
| `export` | `导出` `下载` | |
| `import` | `导入` `上传` | |
| `status` | `启用` `禁用` | 与 persist-as-capability 重叠时见下 |
| `clone` | `克隆` `复制` | |

**重叠裁定：**

- `删除`/`启用`/`禁用`/`克隆` 若是该组 **唯一** 的非 locate 族，按 persist-as-capability 收成主能力，不另计 other。
- 若同一组或同一 atom 里它们与 **另一个不同族** 共存（如 `维护` + `启用`，或 `上移` + `删除`），按多项能力拒。

未列入上表、但也不是 locate/closer 的动词：本轮 **不** 单凭生词拒（避免把说明性散文误杀）。多项能力的机检靠「≥2 个不同族」与「other 组的序列」。实现不得把具体产品按钮文案（如「维护基本信息」「上移」四字专名）写成独立禁条；只能走本表族。

#### 收成单一角色

对一组，按 haystack 收集：locate 命中、closer 命中、persist-as-capability 命中、other 族集合 `F`。

1. `|F| ≥ 2` → 角色 `multi`（组内已多项能力）。
2. `|F| = 1` 且该族不是被「唯一 persist-as-capability」吸收 → 角色 `other`（该族即本组能力）。
3. 无 `F`，有 persist-as-capability 或 **仅 closer** → 角色 `persist`。
4. 仅 locate（可含等待加载）→ 角色 `locate`。
5. 什么都不命中（纯说明）→ 角色 `neutral`：序列上与 `locate` 相同（可出现在主能力前；主能力后出现 `neutral` 不视为夹带能力）。

`打开…填写…【保存】` 落在同一组：`maintain` + closer → 角色 `other`（一族 + 闭环尾），**不是** `multi`。

`维护基本信息…上移…下移…【保存】` 同一组：`maintain` + `reorder` + closer → `multi`。

### 4.3 序列规则

在步骤组序列上（已跳过空组）：

1. **组内 `multi`** → 立即拒 `multi_capability_task_draft`。
2. 统计角色为 `other` 的组：至多 **一个**。超过 → 拒 `multi_capability_task_draft`。
3. 令 **主能力组** 为：
   - 若存在唯一 `other` 组 → 该组；
   - 否则第一个 `persist` 组（locate → 单次保存 的主能力就是保存本身）；
   - 若既无 `other` 也无 `persist`（纯导航/定位）→ 本闸 **通过**（不替代入口折叠、`multi_write_atom` 等既有规则）。
4. **主能力之前** 只允许 `locate` 与 `neutral`。出现 `other` 或 `persist`（persist-as-capability 或 extra closer 组）→ 拒 `multi_capability_task_draft`。  
   - 特例：主能力是 `other` 时，**紧随其后的唯一 closer-only `persist` 组** 视为闭环尾，不算第二项能力（`填写本能力字段` 与 `一次【保存】` 分两步编号的 prompt 正例必须过）。  
   - 闭环尾只能是 closer 词（`确定`/`保存`/`提交`）。persist-as-capability（`启用`/`删除`…）不得当「前面 other 的尾巴」——那是第二项能力。
5. **主能力之后** 不得再出现能力组：即不得有 `other`，也不得有非闭环尾的 `persist`（persist-as-capability 或第二次 closer）。批准口径是「主能力后不得再有能力组」，**不是**「主能力后不得再有 locate」——trailing `locate`/`neutral` 本闸不报（写后再查询是否该拆笔交给 prompt / 既有标准，避免本闸误杀说明性收尾）。
   - 闭环尾允许紧随 **`other` 主能力** 或 **persist-as-capability 主能力**（「启用」后确认框里的【确定】与现 `countPersistConfirms`「启用 + 确定执行此操作？」仍算一次落库的口径一致）。闭环尾组必须 **closer-only**（haystack 只有 `确定`/`保存`/`提交` 及标点/【】，无 other 族）。
6. 多个 closer/persist 确认仍由 **既有** `multi_persist_task_draft` 处理；本闸即使看到两次保存，实现上也 **先让 persist 闸报**，避免同一草稿两个 reason 抢主因。

因此**意图形状**（实现必须放过）：

```
locate*  →  [ optional single other ]  →  [ optional single closer persist ]  →  [ locate|neutral ]*
```

或（无 other，保存/启用/删除等即主能力）：

```
locate*  →  persist(closer 或 persist-as-capability)  →  [ optional closer-only persist ]  →  [ locate|neutral ]*
```

trailing `locate`/`neutral` 本闸放过，不等于鼓励写完再查。

非法例（均 `multi_capability_task_draft`）：

| 形状 | 湿测对应 |
|------|----------|
| `locate → maintain+save → reorder` | 维护基本信息与上移/下移合写 |
| `reorder → maintain+save` | 先排序再维护 |
| 单组 `维护…上移…保存` | 组内两族 |
| `locate → persist → other` | 保存后再做另一能力 |
| `other(create) → persist → other(create)` | 多新建；若有多次确定，主因仍是 `multi_persist_task_draft` |

### 4.4 produces 质量（本轮仅 title-as-key）

在 `normalizeProduces` 之后：

- 若 `produces.length === 1` 且 `produces[0] === String(title).trim()`（精确相等，不折叠空白以外的 trim、不大小写折叠、不做包含匹配）→ 拒 `produces_eq_title`。
- `produces` 含 title 之外还有其它键 → **不** 因本条拒。
- 不做语义词典（不判断「已维护对象」是否像业务键）。

**与 fallback 的冲突（实现时必须处理，本轮规格先钉死）：**

现网 `fallbackDependFields(title)`（`propose.js`）把写步骤 title **原样** 填进 `produces`，为的是躲过 `missing_depend_fields`。本闸落地后若仍 `produces: [title]`，无 LLM 路径会 **全部** 被 `produces_eq_title` 打死。

裁定：闸对 LLM 与 fallback **一律** 生效；实现本闸的同一变更里，fallback 必须改成 **不等于 title** 的合成键（例如 `${title}产物` 或从 step.action 抽出的对象片语，只要 `!== title`）。不得为本闸给 fallback 开豁免。不得把合成键做成再次精确等于 title。

### 4.5 依赖图

`validateAtomDependGraph` 行为不变。被 `multi_capability_task_draft` / `produces_eq_title` 拒掉的 atom **不得** 向同批 `produced` 集合贡献键（与现网「被拒 atom 不贡献 produces」一致），以免下游假绿。

---

## 5. Prompt 侧（轻量）

代码闸是事实源。prompt 只加 **短句**，不把动词族表抄进模型合同。

在 `scripts/prompts/req-draft-traj-atomize-prompt.md` 的能力内聚条（现 `<split_rules>` 第 9 条 / 第 5 条准备步骤）补一句，语义必须是：

> 允许并入主能力的准备步骤 **仅限定位类**（查询/搜索/过滤/选中/点行或节点/打开或进入目标/展开/切换页签）。准备步骤不得夹带另一项可独立验收的能力。

保留现有 `<bad reason="same-page multi-capability">`（维护 vs 列表侧排序形态）与 `<bad reason="maintain missing locate/search/select prep">`，文案可不动。

`docs/superpowers/prompt-engineering/atom-depend-split-samples.md` 实现阶段可补一句「结构闸 reason = `multi_capability_task_draft`」，非本规格交付物。

禁止：按产品树层或按钮专名加 `<bad>`。

---

## 6. 湿测验收（product-mgmt 再 propose）

控制面须加载 **cache v5**（见 §7.3）；**必须重新 propose**，不得复用 v4 缓存。

| # | 场景 | 期望 |
|---|------|------|
| W1 | 模型把「维护基本信息」与「上移/下移」写进同一 `taskDraft` | 该候选不得进 `atoms`；`rejected[].reason === "multi_capability_task_draft"` |
| W2 | 维护已有对象 | 通过的维护笔须含定位准备（查询/搜索/选中等），或按既有标准拆成「定位+维护」可录笔；**本闸不新造 `missing_locate_prep`**——缺定位仍主要靠 prompt 既有 `<bad>`；合写才走 W1 |
| W3 | `locate* → 一次【保存】/【确定】`（无第二项能力） | 必须通过本闸（及既有空 produces / 依赖图闸，若字段合法） |
| W4 | 多次落库确认 | 仍为 `multi_persist_task_draft`，不得改报 `multi_capability_task_draft` 作为主因 |

title-as-key：湿测若仍 `produces: [title]`，该笔须 `produces_eq_title`，不得靠改 title 绕过空字段闸混进 `atoms`。

---

## 7. 实现落点（供后续 plan；本轮不写代码）

### 7.1 文件

| 落点 | 职责 |
|------|------|
| 新 helper（推荐）`src/services/req-draft-traj/capability-cohesion.js` **或** `flow-card-guide.js` 旁导出 | 解析步骤组、分类、序列判定；纯函数，无 I/O。优先新文件，避免 `flow-card-guide.js` 再膨胀；`isPersistBoundaryAction` 只 import 复用 |
| `atom-depend.js` 旁亦可，但依赖图与步骤语义分开更清晰 | 不要把本闸塞进 `validateAtomDependGraph` |
| `propose.js` | 在 `countPersistConfirms` 之后、`missing_depend_fields` / 依赖图之前接线；fallback 合成键去 title 化 |
| `propose-cache.js` | `PROPOSE_CACHE_VERSION` **4 → 5**（实现时再 bump，**现在不要改**） |
| `scripts/prompts/req-draft-traj-atomize-prompt.md` | §5 一句 |
| characterization | 见 §8 |
| 本规格已存在；实现 plan 另文 | 不要在实现时回改本文件的 reason 字符串，除非 Lead 改裁定 |

公开函数建议（实现时可微调用名，但 reason 字符串锁死）：

```text
parseTaskDraftStepGroups(taskDraft) → Array<{ raw, haystack }>
classifyCapabilityGroup(haystack) → 'locate' | 'persist' | 'other' | 'multi' | 'neutral'
assertCapabilityCohesion({ title, taskDraft, produces })
  → { ok: true } | { ok: false, reason: 'multi_capability_task_draft' | 'produces_eq_title' }
```

`other` 组若需测族 id，测试可读内部 `families`，产品 API 只暴露 `reason`。

### 7.2 接线顺序（单 atom materialize）

与现网 `materializeOne` 对齐，插入点在 `sanitizeTaskDraftKeyData` 之后：

1. `countPersistConfirms > 1` → `multi_persist_task_draft`（现有，保持第一）
2. **新** `assertCapabilityCohesion` → `multi_capability_task_draft` 或 `produces_eq_title`
3. provenance / `produces.length === 0` → `missing_depend_fields`
4. 批级 `validateAtomDependGraph`（`self_produce_depend` / `dangling_data_depend` / 空 produces 双保险）

同一 atom 只保留 **第一个** reason。

`produces_eq_title` 与空数组互斥：空数组仍走 `missing_depend_fields`。先规范化再比 title。

### 7.3 缓存

实现本闸时 **必须** `PROPOSE_CACHE_VERSION` 4→5。注释写明：v5 = 能力内聚结构闸 + title-as-key 拒。湿机未 bump 会把 v4 合写草稿继续 commit。

**本规格 PR 不得改 `propose-cache.js`。**

### 7.4 JSDoc / lint

新导出函数按 `docs/jsdoc-convention.md` 补 `@param`/`@returns`；只插注释不删行；`npm run lint` 不得新增 warning。

---

## 8. Characterization（实现阶段必 pin）

冷测，不调真 LLM。夹具风格对齐 `characterize-persist-boundary.mjs` / `characterize-atom-depend.mjs`（fakeLLM + demo-mod 或纯 helper）。

**必 pin（名称可改，断言语义锁死）：**

| ID | 输入要点 | 期望 |
|----|----------|------|
| C1 merge reject | `taskDraft` 含定位 + 维护/保存 + 上移/下移（可分多编号步，或单步 `操作：` 混写） | `rejected` 含 `multi_capability_task_draft`；该笔不在 `atoms` |
| C2 locate+save pass | 正例：进页 → 搜索/选中 → 打开表单填本能力字段 → 一次【保存】；`produces` 为业务键（≠ title） | 通过本闸；不得误报 `multi_capability_task_draft` |
| C3 multi_persist 仍走旧闸 | 三行 `操作：…【确定】`（现 `THREE_CONFIRM_DRAFT` 形态） | `multi_persist_task_draft`；**不要**改成只报 `multi_capability_task_draft` |
| C4 title-as-key | `title === "维护基本信息"` 且 `produces: ["维护基本信息"]`，taskDraft 即使内聚合法 | `produces_eq_title` |
| C5 组内两族 | 单编号步 haystack 同时 `维护` 与 `上移` | `multi_capability_task_draft` |
| C6 closer 分步 | 编号 3 = 填写（maintain），编号 4 = `【保存】` | 通过（闭环尾特例） |

既有 pin 不得回退：`characterize-atom-depend` 空 produces、`characterize-req-draft-traj` 的 `PROPOSE_CACHE_VERSION`（实现后改为 **5**）、`characterize-persist-boundary` 的 `isPersistBoundaryAction` / `未启用` 排除。

证伪：实现后应用 stash/还原旧 helper，C1 必须变红。

---

## 9. 错误码与 API 面

| `reason` | 何时 |
|----------|------|
| `multi_capability_task_draft` | §4.3 序列或组内 `multi` |
| `produces_eq_title` | §4.4 |

载荷形态与现网 `rejected: [{ atomKey, reason }]` 一致。不新增 HTTP 状态；propose 仍 200 + 部分 rejected。

`/api/docs`（`src/dashboard/api-docs/catalog.js`）实现阶段补一句 reason 列表即可；本规格 PR 不改 catalog。

---

## 10. 决策记录

1. 能力内聚从 prompt-only（2026-09-15 §3.7 / PR #40 散文、PR #41 XML）升级为 **结构硬闸**；放弃 PR #39 式场景关键词拒。
2. 分类三桶：locate-prep 白名单 / persist（复用 `isPersistBoundaryAction` + closer）/ other 动词族。other 用 **族** 而非按钮专名。
3. 主能力至多一项；其前仅定位；其后不得再有能力。Closer 可单独成编号步挂在唯一 other 之后，以保证 prompt 正例「填字段」+「一次保存」可通过。
4. `multi_persist_task_draft` 不合并进新闸：多次落库与「一次保存夹带另一能力」是两类病。
5. produces 本轮只打 **精确 title-as-key**；fallback 实现时必须改合成键。
6. 维护缺定位：湿测期望仍在，但本轮不新增 reason；避免与「无定位的纯保存笔」（W3）打架。
7. 实现时 cache 4→5；本规格文档 PR 不 bump。

---

## 11. 本轮交付

- [x] 本设计文件  
- [ ] 实现（另开 plan / PR）  
- [ ] cache v5  
- [ ] characterization C1–C6  
- [ ] prompt 一句 + 湿测 W1–W4
