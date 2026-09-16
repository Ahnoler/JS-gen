# Design: 表单字段内同族控件 xpath 消歧（field_slot）

**日期**：2026-09-16  
**状态**：已批准；计划 [`../plans/2026-09-16-form-field-intra-slot-xpath.md`](../plans/2026-09-16-form-field-intra-slot-xpath.md)  
**触发**：产品库「产品公共要素配置 → 保证金比例」单字段内多 input/select，相对 xpath 多命中  
**相关**：xpath 栈 skill / `src/cdp/page-locator-helpers.js`（`formFieldXpathSmartOf`、`buildLocatorSnap`、`pinOccurrence`）；前端 `ui-auto-recording-agent-vue-master/vue-project`（`pickParamText` / `getStepTitle`）  
**用户裁决**：① 消歧方案 **A**（字段内序号 + class-token）；② 展示用独立字段 **`field_slot`**，不改写 `label_text`；③ **JS-gen + SPA 同任务交付**

---

## 1. 问题

### 1.1 真机结构（Playwright MCP · 2026-09-16）

页面：`产品库管理` → 产品详情 →「产品公共要素配置」→「产品基础参数」→ 字段「保证金比例」。

| 文档序 | 控件族 | DOM 要点 |
|--------|--------|----------|
| 1 | input | `.tsscInput` → `input.el-input__inner`（placeholder「请输入」） |
| 2 | select | `.tssc-multi-select` → `.el-select`（「请选择」；选项含 `<` / `≤`） |
| 3 | （字面） | `el-col` 文本「值」 |
| 4 | select | 同上第二枚 `.el-select` |
| 5 | input | 第二个 `.tsscInput` |

同 `.el-form-item` 内：真 `.el-select` ×2、裸 input ×2。

### 1.2 现算法失败点

1. **Leaf 过宽**：`formFieldXpathSmartOf` 使用 `div[contains(@class,'el-select')]`，子串命中 `el-select-dropdown` / `el-select-dropdown__wrap` → 本字段 loose 命中 **6**，tight class-token 命中 **2**。  
2. **字段内同族无序号**：即便收紧 leaf，`itemPred//el-select` 仍 2 命中。  
3. **全局 pin 被 region 清掉**：`buildLocatorSnap` 在 `occurrence≥1` 且存在 region/titlebox 时清空 smart，退 `xpath_full` 或歧义 xpath——与「语义相对 xpath」目标冲突。  
4. **展示撞名**：SPA `getStepTitle` = `动作中文 | pickParamText(label_text…)`；两枚 select 的 `label_text` 皆为「保证金比例」→ 列表无法区分。

### 1.3 目标 / 非目标

**In**

1. AI 录制与人工录制：字段内同族控件的 `xpath_smart` **唯一且可回放验证**。  
2. 同类型序号字母后缀仅用于展示：`[选择下拉 | 保证金比例-A]`；语义 `label_text` / `formLabel` 仍为「保证金比例」。  
3. 契约字段：`field_slot`（`A`/`B`/…）落在 element（及可选 params 镜像）；派生 `display_label` 供列表使用。  
4. 同步 JS 单源 → regenerate `_locator_helpers_js.py`；SPA 与本仓同交付。  
5. characterization + 保证金比例湿测证据。

**Out**

- 不改写历史轨迹步骤（无迁移回填义务；新录制生效）。  
- 不用「值」字面 / el-col 位次做结构锚（非通用）。  
- 不把 `field_slot` 拼进 `label_text`（避免规则/去重/召回精确匹配副作用）。  
- 不扩展到「跨不同 form-item 同名 label」消歧（已有 exact label / region 链）。

---

## 2. 方案（已选 A）

```
form-item(label=保证金比例)
  └─ same-family leaves (tight class-token / plain input)
        count≥2 → xpath_smart = (itemPred//leaf)[n]
                 field_slot   = letter(n)   // 1→A, 2→B, …
                 display_label= formLabel + '-' + field_slot
        count=1 → 现状（无 field_slot）
```

Leaf 族（与现 `formFieldXpathSmartOf` 分支对齐，全部改 class-token 或显式排除 dropdown）：

| 族 | tight leaf |
|----|------------|
| select | `div[class-token('el-select')]`（不得命中 dropdown） |
| input | `input[not(ancestor::div[class-token('el-select')])]`（或等价 tsscInput 路径，须排除 select 内 input） |
| date / radio-group / checkbox-group / cascader / tree-select | 同理：仅当字段内同族 ≥2 才加 `[n]` |

**序号作用域**：仅当前 `.el-form-item` 内、**同 leaf 族**文档序（select 与 input 各自从 A 起算）。

**与 `pinOccurrence` 关系**：字段内 pin 是 **局部** `(item//leaf)[n]`，不是页面级 `(smart)[n]`。region/titlebox 清空规则 **不得** 抹掉已验证的字段内 pin。

---

## 3. 数据契约

### 3.1 Element / locator snap（JS-gen）

新增（有歧义时才写）：

| 字段 | 类型 | 含义 |
|------|------|------|
| `field_slot` | string | `A`…`Z` 后可 `AA`（预留；本版 n≤26 足够） |
| `display_label` | string | `normalizeFormLabel(formLabel) + '-' + field_slot` |
| `locator_occurrence` | number | 可与字段内 n 对齐写入；语义仍为 1-based 命中序 |

不变：`formLabel`、`params.label_text`（录制落库主语义名）。

### 3.2 录制落库

- **人工**：`manual_recorder` mapper / capture 透传 `field_slot`、`display_label` 进 `element_json`。  
- **AI**：`buildLocatorSnap` → 步骤 `element`；`params.label_text` 仍用扫描/规则中的字段名（无 `-A`）。  
- 可选：`params.field_slot` / `params.display_label` 镜像，便于只读 params 的前端路径；**以 element 为准**，params 为镜像。

### 3.3 回放

优先 `xpath_smart`（已含 `[n]`）。`label_text` 仍精确匹配字段名；不要求调用方传 `field_slot`。

### 3.4 SPA 展示

路径：`D:\dev\ui-auto-recording-agent-vue-master\vue-project`

- `pickParamText` / `getStepTitle` / StepsPanel 同源映射：展示名 =  
  `element.display_label || params.display_label || (label_text + (field_slot ? '-' + field_slot : ''))`  
  再与动作中文拼成 `选择下拉 | 保证金比例-A`（现有 `label | paramText` 格式不变）。  
- 编辑「步骤名称」仍编辑 `label_text`（语义名）；只读展示层加 slot，避免用户手改把 `-A` 写进语义字段（若产品坚持可编辑展示名，另议；本版 **展示派生、语义可编**）。

---

## 4. 实现触点（文件级）

### 4.1 JS-gen

| 文件 | 改动 |
|------|------|
| `src/cdp/page-locator-helpers.js` | tight leaf；字段内同族计数；emit `(…)[n]` + `field_slot`/`display_label`；region 清 pin 豁免字段内 pin |
| `scripts/_gen_locator_helpers_py.mjs` | 再生 Python mirror（禁止手改生成物） |
| `src/cdp/locator-builders/controls.js`（若离线重建走此路径） | 与 snap 同语义，防双源漂移 |
| `src/models/element.js` | 白名单透传 `field_slot` / `display_label` |
| `scripts/manual_recorder/**` | capture/mapper 透传 |
| `scripts/characterization/*` | 新 pin：loose→tight、同字段双 select/input、region 不清字段内 pin |
| `scripts/refactor/verify-all.sh` | 注册新 pin（若独立文件） |

### 4.2 SPA

| 文件 | 改动 |
|------|------|
| `src/utils/trajectory-tree.ts` | `pickParamText`（或旁路 helper）接入 `display_label`/`field_slot` |
| `src/views/ui-recording/step-detail/index.vue` | `getStepTitle`/`stepTitle` 走同一 helper |
| `src/api/recording` ElementJson 类型 | 声明新字段 |
| 其他用 `pickParamText` 的列表（ui-assets DetailDialog 等） | 自动受益 |

---

## 5. 验收

1. **离线**：characterization 红→绿；`verify-all` 无新增红。  
2. **湿测（本页）**：对「保证金比例」两枚 select、两枚 input 分别录制（人工或 AI 一步），`xpath_smart` eval 命中 1 且对准目标；步骤列表显示 `… | 保证金比例-A/B`（分类型）。  
3. **回归**：单控件字段（如「业务产品编号」）无 `field_slot`，标题仍为纯 label。  
4. **回放**：新录步骤 `xpath_smart` 回放 ok（至少 select/fill 各一例）。

---

## 6. 风险与决策记录

| 风险 | 处置 |
|------|------|
| 历史步骤仍歧义 | 接受；仅新录制修复 |
| `contains(@class,'el-select')` 历史 xpath | 新录制改 tight；旧步骤不强制改写 |
| 字母用尽 | 本版 n≤26；超出可后续 `AA` |
| SPA 与后端字段名不一致 | 契约以本文 §3 为准，两端同 PR/同会话交付 |

---

## 7. Spec 自检

- [x] 无 TBD/占位实现细节（字母规则、leaf 表、清 pin 豁免已写清）  
- [x] 与用户裁决一致（A + field_slot + 双仓）  
- [x] 范围边界明确（Out 列表）  
- [x] 前后端契约单处定义  

**请审阅本文件**；批准后按 writing-plans 落 `docs/superpowers/plans/2026-09-16-form-field-intra-slot-xpath.md` 再开工实现。
