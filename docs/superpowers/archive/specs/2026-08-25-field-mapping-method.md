# 字段映射通用方法设计（报文捞取 MVP）

> 日期：2026-08-25
> 关联：[[packet-capture-mvp-design]]；`2026-08-25-sut-three-interfaces.md`
> 状态：设计草案

---

## 1. 问题定义

### 1.1 为什么不能值匹配

值匹配的思路是「DOM 控件当前显示的值 = API 请求体中某字段的值 → 建立映射」。这在**已有数据的编辑表单**上可行，但在以下场景失效：

- **空表单填写**：表单尚未填入任何值，DOM 控件为空，无法与 API 请求体做值比对
- **新增表单**：新增场景下控件值是默认值或空，与历史报文的实际业务值不对应
- **不同数据实例**：同一表单页面对不同客户显示不同值，值匹配结果不可复用

因此需要一种**不依赖当前控件值的通用映射方法**。

### 1.2 映射的两个阶段

字段映射分为两个阶段，各自解决不同问题：

| 阶段 | 匹配对象 | 目的 | 方法 |
|------|---------|------|------|
| **阶段一：结构对齐** | 接口一元素定义（prop）↔ DOM 实际元素（prop） | 确认接口一定义与页面实际结构一致，建立 DOM 定位锚点 | prop 精确匹配为主；DOM 侧的 name/inputType/section 用于 prop 缺失时的消歧 |
| **阶段二：报文-表单映射** | 历史报文 requestBody ↔ 表单元素 | 将历史报文字段值映射到表单控件，生成填写数据 | prop 字段名直接关联 |

---

## 2. 阶段一：结构对齐（接口一定义 ↔ DOM 元素）

### 2.1 匹配信号

接口一只提供 `name`、`prop` 和 `url` 三个字段。映射以 prop 为唯一主键，其余结构化信号由 JS-gen 从 DOM 提取（用于 DOM 内部消歧和填写方式判断，不依赖接口提供）：

| 信号 | 来源 | 接口一是否提供 | 可靠性 |
|------|------|---------------|--------|
| **prop** | `el-form-item[prop]` 属性 / 接口一 `prop` 字段 | 是 | ★★★★★ 最高——直接就是 API 字段名 |
| **url** | 接口一 `url` 字段 | 是 | ★★★★★ 元素→接口映射，SUT 直接提供 |
| **name** | DOM `.el-form-item__label` 文本（去 `*`） | 否（DOM 获取） | ★★★★☆ 高——中文标签，可能重名 |
| **inputType** | DOM 控件类型探测 | 否（DOM 获取） | ★★★★☆ 高——select/date/textarea/textbox |
| **section** | DOM `el-collapse-item__header` 文本 + 层级推断 | 否（DOM 获取） | ★★★☆☆ 中——空间相似性推断 |
| **required** | DOM `el-form-item.is-required` CSS class | 否（DOM 获取） | ★★★★☆ 高 |
| **disabled** | DOM `input.disabled` 属性 | 否（DOM 获取） | ★★★★☆ 高 |
| **maxlength** | DOM `input[maxlength]` 属性 | 否（DOM 获取） | ★★★☆☆ 辅助验证 |
| **options** | DOM `el-select-dropdown__item` 列表（展开下拉后读取） | 否（DOM 获取） | ★★★☆☆ 中——需展开下拉面板 |

### 2.2 匹配算法

```
输入：接口一返回的元素定义列表 elementDefs[]（每项含 {prop, url}）
      DOM 提取的表单元素列表 domElements[]（每项含从 DOM 获取的 prop/name/inputType/section/disabled/required）

输出：匹配结果 matched[]，每项 { elementDef, domElement, confidence, signals }

算法：
1. 以 prop 为主键建立索引：
   defByProp = Map(prop → elementDef)         // 接口一提供
   domByProp = Map(prop → domElement)          // DOM 获取

2. 第一轮：prop 精确匹配
   for each prop in (defByProp.keys ∩ domByProp.keys):
     match(def, dom, confidence=1.0, signals=['prop'])

3. 第二轮：prop 缺失时用 DOM 信号模糊匹配
   // 仅当接口一定义中有 prop 但 DOM 中无对应 prop 时触发（极少见）
   for each def in (defByProp.keys - domByProp.keys):
     candidates = domElements.filter(dom =>
       dom.name === def.name && dom.inputType === def.inputType   // name/inputType 均来自 DOM
     )
     if candidates.length === 1:
       match(def, candidates[0], confidence=0.8, signals=['name','inputType'])
     else if candidates.length > 1:
       // 同名同类型，用 DOM 空间相似性消歧
       best = candidates.find(dom => dom.section === def.section)
       if best:
         match(def, best, confidence=0.7, signals=['name','inputType','section'])

4. 第三轮：报告未匹配项
   unmatchedDefs = defByProp.keys - matched.defs
   unmatchedDoms = domByProp.keys - matched.doms
   → 人工审查或标记为「接口一定义与页面不一致」
```

> **注意**：接口一只提供 `name`、`prop` 和 `url`（name 为字段中文名，仅调试用）。算法第二轮和第三轮中使用的 `name`/`inputType`/`section` 信号全部由 JS-gen 从 DOM 提取，不依赖接口一提供。url 字段在匹配阶段不参与（它用于后续接口二的调用和日志报文的 URI 匹配），但在填写阶段用于区分字段属于哪个接口的入参。

### 2.3 DOM 控件类型探测规则

```
inputType 探测（按优先级）：
  if el-form-item 内含 .el-date-editor   → 'date'
  else if 内含 textarea                  → 'textarea'
  else if 内含 .el-select                → 'select'
  else if 内含 input.el-input__inner     → 'textbox'
  else                                   → 'unknown'
```

### 2.4 section（分区）推断

Element UI 表单的分区结构：

```
el-collapse
  └ el-collapse-item
      ├ el-collapse-item__header  ← 分区标题文本（如「对公客户概况」）
      └ el-collapse-item__content
          ├ [分区子标题 div]       ← 如「基本信息」「登记信息」（非标准 Element UI，需按 DOM 层级推断）
          │   └ el-form-item × N
          ├ [分区子标题 div]
          │   └ el-form-item × N
```

推断方法：
1. 顶层分区：`el-collapse-item__header` 文本 → `section`（如「对公客户概况」）
2. 子分区：遍历 `el-collapse-item__content` 的子元素，文本型 div（无 form-item 子元素、文本长度 < 20、不含 `*`/`请`/按钮文本）→ 标记为子分区标题
3. 每个 `el-form-item` 的 `section` = 其最近的祖先子分区标题

### 2.5 实测验证（对公客户概况页）

从 DOM 提取 122 个 `el-form-item`，每个都有 `prop` 属性：

| 信号 | 覆盖率 | 说明 |
|------|--------|------|
| prop | 122/122 (100%) | 所有 form-item 都有 prop 属性 |
| name | 122/122 (100%) | 所有 form-item 都有 label 文本 |
| inputType | 122/122 (100%) | 探测成功：textbox 42 / select 51 / date 16 / textarea 5 / 其他 8 |
| required | 122/122 (100%) | `is-required` CSS class |
| disabled | 122/122 (100%) | `input.disabled` 属性 |
| maxlength | 78/122 (64%) | 部分控件有 maxlength 属性 |
| section | 部分可推断 | 子分区标题需按 DOM 层级推断，顶层「对公客户概况」确认 |

**结论**：prop 属性 100% 覆盖，第一轮 prop 精确匹配即可完成全部映射，无需进入 name 模糊匹配。

---

## 3. 阶段二：报文-表单映射（历史报文 ↔ 表单元素）

### 3.1 核心关联键：prop

历史报文的 `requestBody` 是一个扁平 JSON，key 就是 API 字段名。接口一的 `prop` 也是 API 字段名。两者通过 `prop` 直接关联：

```
requestBody = {
  "cstNo": "26081317115618826",       ← key = "cstNo"
  "cstNm": "鑫瑞丰禾农业开发有限公司",  ← key = "cstNm"
  "cpctTp": "601",                    ← key = "cpctTp"
  ...
}

接口一元素定义 = [
  {"prop":"cstNo", "url":".../saveCustCorporat"},        ← prop = "cstNo"
  {"prop":"cstNm", "url":".../saveCustCorporat"},        ← prop = "cstNm"
  {"prop":"cpctTp", "url":".../saveCustCorporat"},       ← prop = "cpctTp"
  ...
]

映射结果 = [
  {prop:"cstNo", domLocator:..., inputType:"textbox", fillValue:"26081317115618826", url:".../saveCustCorporat"},
  {prop:"cstNm", domLocator:..., inputType:"textbox", fillValue:"鑫瑞丰禾农业开发有限公司", url:".../saveCustCorporat"},
  {prop:"cpctTp", domLocator:..., inputType:"select", fillValue:"601", url:".../saveCustCorporat"},
  ...
]
```

> inputType、display 等信息由 JS-gen 从 DOM 获取，不来自接口一。

### 3.2 填写值生成规则

根据 `inputType` 不同，填写值的生成方式不同：

| inputType | 填写值来源 | 填写方式 | 注意事项 |
|-----------|-----------|---------|---------|
| textbox | `requestBody[prop]` 原值 | native setter 输入文本 | 金额类需去千分位；日期类需补 `00:00:00` |
| textarea | `requestBody[prop]` 原值 | native setter 输入文本 | 长文本字段 |
| select | `requestBody[prop]` 码值 | 按 options 中 value 匹配 option 并点击 | 需用码值（如 `601`），非显示文本（如「企业类」） |
| date | `requestBody[prop]` 日期值 | date picker 选择或输入 | API 格式 `2016-08-13 00:00:00` → DOM 只需 `2016-08-13` |

### 3.3 select 控件的码值映射

select 控件是字段映射中最复杂的部分——DOM 显示中文标签，API 传输码值。

**数据流**：

```
接口一 options: [{label:"企业类", value:"601"}, {label:"事业类", value:"602"}, ...]
                                                         ↓
历史报文 requestBody: {"cpctTp": "601"}
                         ↓
匹配：requestBody["cpctTp"] = "601" → options 中 value="601" → label="企业类"
                         ↓
填写：在 DOM select 中选择 value="601" 的 option（点击 label="企业类" 的下拉项）
```

**options 来源**：完全由 JS-gen 从 DOM 获取。展开 select 下拉面板后，从 `el-select-dropdown__item` 元素中读取选项列表（label 文本 + value 码值）。填写 select 时本来就要展开下拉面板，顺便读取选项，不需要接口提供静态 options。

### 3.4 空表单场景

空表单场景下，阶段一仍然有效（prop/name/inputType 结构信号不依赖值，均从 DOM 结构获取），阶段二的填写值来源变为：

| 场景 | 填写值来源 | 说明 |
|------|-----------|------|
| 有历史报文 | `requestBody[prop]` | 从历史报文样本取值 |
| 无历史报文 | DOM required 标记 + 接口二 inputParams 验证 | 生成空值或默认值（必填字段标注待人工） |
| select 无报文但 DOM 有选项 | DOM 下拉面板第一个非空 value | select 控件的默认选择 |

**关键**：阶段一的结构对齐不依赖值，空表单也能完成——prop 属性、label 文本、控件类型都是 DOM 结构固有的，与是否有值无关。

### 3.5 多接口场景

一个页面可能触发多个接口（如保存接口 + 评级查询接口）。接口一的每个元素自带 `url` 字段，标明该元素属于哪个接口：

```
元素定义：
  {prop:"cstNo", url:".../saveCustCorporat"}        ← 属于保存接口
  {prop:"fnlRtgGrd", url:".../getRatingResult"}      ← 属于评级接口

按 url 分组后分别映射：
  saveCustCorporat 组 → 用 saveCustCorporat 的历史报文填值
  getRatingResult 组 → 用 getRatingResult 的历史报文填值（只读字段，不需填写）
```

---

## 4. 字段映射的完整流程

```
                    接口一：页面元素定义
                    ┌──────────────────────────────────┐
                    │ [{prop, url}, ...]               │
                    │  prop = API 字段名（映射主键）     │
                    │  url  = 元素触发的接口地址         │
                    └──────────┬───────────────────────┘
                               │
                               │  阶段一：结构对齐
                               │  prop 精确匹配（接口一 prop ↔ DOM prop）
                               │  name/inputType/section 从 DOM 获取（用于消歧）
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
         DOM 元素        接口二：接口结构定义  接口一 url 去重
    ┌──────────────┐  ┌──────────────────┐  ┌──────────────┐
    │el-form-item  │  │method            │  │接口列表       │
    │prop="cstNo"  │  │inputParams[]     │  │              │
    │label="客户编号"│  └────────┬─────────┘  └──────┬───────┘
    │inputType=text│           │                   │
    │(DOM探测)     │           │                   │
    └──────┬───────┘           │                   │
           │                   │                   ▼
           │                   │           接口三：日志文件获取
           │                   │           ┌──────────────────┐
           │                   │           │日志文件解析出     │
           │                   │           │requestBody       │
           │                   │           │{cstNo:"260...",  │
           │                   │           │ cstNm:"鑫瑞...", │
           │                   │           │ cpctTp:"601",...}│
           │                   │           └────────┬─────────┘
           │                   │                    │
           └───────────────────┼────────────────────┘
                               │
                               │  阶段二：报文-表单映射
                               │  prop 字段名直接关联
                               │
                               ▼
                    ┌──────────────────────────────────┐
                    │ 填写数据                           │
                    │ [                                 │
                    │  {prop:"cstNo",                   │
                    │   domLocator: "el-form-item[prop='cstNo'] input",
                    │   inputType:"textbox",  ← DOM获取  │
                    │   fillValue:"26081317115618826",  │
                    │   url:".../saveCustCorporat"},    │
                    │  {prop:"cpctTp",                  │
                    │   domLocator: "el-form-item[prop='cpctTp'] .el-select",
                    │   inputType:"select",   ← DOM获取  │
                    │   fillValue:"601",                │
                    │   options:[{label,value},...],    │
                    │     ↑ DOM下拉面板获取              │
                    │   url:".../saveCustCorporat"},    │
                    │  ...                              │
                    │ ]                                 │
                    └──────────────────────────────────┘
```

---

## 5. DOM 定位策略

匹配完成后，需要为每个字段生成 DOM 定位锚点，用于自动化填写。

### 5.1 定位公式

基于 `el-form-item[prop]` 的 prop 属性定位，这是最稳定的锚点：

```css
/* textbox / textarea */
el-form-item[prop="{prop}"] input.el-input__inner
el-form-item[prop="{prop}"] textarea

/* select */
el-form-item[prop="{prop}"] .el-select
el-form-item[prop="{prop}"] .el-select input.el-input__inner

/* date picker */
el-form-item[prop="{prop}"] .el-date-editor input.el-input__inner
```

### 5.2 定位稳定性分析

| 锚点 | 稳定性 | 说明 |
|------|--------|------|
| `el-form-item[prop]` | ★★★★★ | prop 是表单验证绑定字段，不会因 UI 重构变化 |
| `.el-form-item__label` 文本 | ★★★☆☆ | 中文标签可能因国际化/改版变化 |
| DOM 层级路径 | ★★☆☆☆ | 布局调整会断裂 |
| input 顺序索引 | ★☆☆☆☆ | 字段增删会移位 |

**推荐**：始终用 `el-form-item[prop]` 作为主锚点，label 文本仅作辅助验证。

---

## 6. 边界情况与处理

### 6.1 prop 缺失

部分 `el-form-item` 可能没有 `prop` 属性（如表单容器、按钮组）。处理方式：
- 跳过无 prop 的 form-item（它们不是数据字段）
- 在接口一定义中也不包含这些元素

### 6.2 同名不同 prop

同一表单内可能存在多个 label 文本相同的控件（如两个「保存」按钮）。处理方式：
- prop 精确匹配不受影响（prop 唯一）
- name 模糊匹配时需用 section + inputType 消歧

### 6.3 嵌套对象字段

如果 API 请求体含嵌套对象（如 `{address: {city:"...", street:"..."}}`），prop 可能是 `address.city` 或 `address[city]`。处理方式：
- 接口一应展开嵌套字段为扁平 prop（如 `addressCity`）
- 或 DOM prop 也使用点号路径（Element UI 支持 `prop="address.city"`）

### 6.4 动态字段

某些字段是动态生成的（如表格行内编辑），prop 可能是 `tableData.0.fieldName`。处理方式：
- 动态字段不走静态映射，单独按表格行处理
- 接口一可标记 `dynamic: true`

---

## 7. 实测数据（对公客户概况页）

### 7.1 结构对齐结果

| 指标 | 数值 |
|------|------|
| DOM form-item 总数 | 122 |
| 有 prop 属性的 | 122 (100%) |
| prop 精确匹配成功 | 122 (100%) |
| 需 name 模糊匹配的 | 0 |
| 未匹配 | 0 |

### 7.2 控件类型分布

| inputType | 数量 | 占比 |
|-----------|------|------|
| select | 51 | 42% |
| textbox | 42 | 34% |
| date | 16 | 13% |
| textarea | 5 | 4% |
| unknown | 8 | 7% |

### 7.3 select 选项示例（DOM 实测）

对公客户类型（`cpctTp`）的下拉选项：

| label（显示文本） | value（API 码值） |
|-------------------|-------------------|
| 企业类 | 601 |
| 事业类 | 602 |
| 集体经济组织 | 603 |
| 国家机关 | 604 |
| 社会团体 | 605 |

这些选项在 DOM 中以 `el-select-dropdown__item` 元素存在，接口一的 `options` 字段应提供同样的 `{label, value}` 对。

### 7.4 API 请求体字段覆盖率

| 指标 | 数值 |
|------|------|
| API 请求体字段总数 | ~170 |
| DOM 可见字段（有 prop） | 122 |
| DOM 有 prop 且 API 有对应 key | 122 (100%) |
| API 有 key 但 DOM 无对应 prop | ~48（隐藏字段/审计字段/URL 回显） |

122 个可见字段 100% 通过 prop 精确匹配到 API 请求体字段。剩余 ~48 个 API 字段是隐藏/审计/URL 回显字段，不需要 DOM 映射（填写时自动生成或从 URL 提取）。

---

## 8. 总结

**字段映射的通用方法**：

1. **不依赖值**——以 prop（API 字段名）为映射主键，name/inputType/section 作为 DOM 侧消歧信号（均从 DOM 获取，不依赖接口提供）
2. **接口一最小化**——接口一只提供 `name`、`prop` 和 `url`（name 仅调试用）；控件类型、标签、选项、禁用/必填等全部由 JS-gen 从 DOM 获取
3. **prop 是主键**——Element UI 的 `el-form-item[prop]` 属性直接就是 API 字段名，100% 覆盖率
4. **两阶段流程**——先结构对齐（接口一 prop ↔ DOM prop），再报文映射（requestBody ↔ 表单元素，通过 prop 关联）
5. **空表单可用**——结构信号是 DOM 固有的，不依赖控件值；填写值从历史报文取
6. **select 用码值**——填写时用 DOM 下拉面板中选项的 value（码值），非 label（显示文本）；options 从 DOM 获取
7. **DOM 定位用 prop**——`el-form-item[prop="{prop}"]` 是最稳定的锚点
