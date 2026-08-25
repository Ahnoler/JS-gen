# 历史数据回填支持度评估

> 日期：2026-08-25
> 关联：[[packet-capture-mvp-design]]；`2026-08-25-sut-three-interfaces.md`；`2026-08-25-field-mapping-method.md`；`2026-08-25-saveCustCorporat-field-mapping.md`
> 状态：已完成评估——三个接口的数据完全足够支持历史数据回填，所有边界场景均由 JS-gen 侧逻辑兜底

---

## 1. 评估目标

评估被测系统三个接口（页面元素定义 / 接口结构定义 / 日志文件获取）提供的数据，是否足够支持 JS-gen 的历史数据回填功能——即：拿到三个接口的返回数据后，能否将历史报文中的字段值自动填入表单控件。

评估基于天阳宏业信贷系统「对公客户概况」页的实测数据（122 个可见表单字段，~170 个 API 请求体字段）。

---

## 2. 数据链与映射基础

三个接口通过 `prop` 字段名串联，形成完整的映射链：

```
接口一 element.prop
  = 接口二 inputParams[]
  = 日志 Request Body 的 key
```

- 接口一提供「每个控件对应的 API 字段（prop）、该元素触发的接口地址（url）、字段中文名（name，调试用）」
- 接口二提供「接口接收哪些字段」（inputParams 字段名列表）——验证层
- 接口三提供「应用日志文件」（DemoHeadIntercept 拦截器产出），JS-gen 解析出历史报文的实际字段值——填写数据来源

字段映射分两个阶段（详见 `2026-08-25-field-mapping-method.md`）：
1. **结构对齐**：接口一元素定义 ↔ DOM 元素，用 prop / name / inputType / section 四维匹配
2. **报文-表单映射**：历史报文 requestBody ↔ 表单元素，通过 prop 关联取填写值

---

## 3. 完全支持的回填场景

三个接口只提供 JS-gen 无法自行获取的核心数据（`name`、`prop`、`url`、`method`、`inputParams`，以及接口三日志文件解析出的 `requestBody`）。以下场景的数据链完整，可直接支撑回填：

> **说明**：接口三现为「日志文件获取接口」——SUT 提供应用日志文件（`DemoHeadIntercept` 拦截器产出），JS-gen 从日志中解析出 requestBody。下文表格中「接口三 | requestBody[prop]」均指日志解析结果。

### 3.1 textbox / textarea（47 字段，占 38%）

| 来源 | 提供数据 | 用途 |
|------|---------|------|
| 接口一 | prop | 映射主键 + DOM 定位锚点 |
| DOM | inputType=textbox/textarea（JS-gen 探测） | 知道用什么方式填 |
| 接口三 | requestBody[prop] | 知道填什么值 |

DOM 定位用 `el-form-item[prop="{prop}"] input.el-input__inner`。金额类字段的去千分位是 JS-gen 侧格式处理逻辑，不是数据缺口。

### 3.2 date（16 字段，占 13%）

| 来源 | 提供数据 | 用途 |
|------|---------|------|
| 接口一 | prop | 映射主键 + DOM 定位锚点 |
| DOM | inputType=date（JS-gen 探测 `.el-date-editor`） | 知道是日期选择器 |
| 接口三 | requestBody[prop] | 日期值（可能带 `00:00:00` 后缀） |

日期格式适配（strip time suffix、识别 picker 的 format）是 JS-gen 侧逻辑。

### 3.3 普通 select（约 45 字段，占 37%）

| 来源 | 提供数据 | 用途 |
|------|---------|------|
| 接口一 | prop | 映射主键 + DOM 定位锚点 |
| DOM | inputType=select + options（展开下拉面板读取 `el-select-dropdown__item`） | 知道是下拉框、有哪些选项 |
| 接口三 | requestBody[prop] = 码值（如 `601`） | 知道选哪个码值 |

展开 DOM 下拉面板后，按码值找到对应选项（如码值 `601` → 文本「企业类」的 dropdown item）并点击。选项列表完全来自 DOM，不依赖接口提供。

### 3.4 disabled 字段跳过

JS-gen 从 DOM 检测 `input.disabled` 属性 / `is-disabled` CSS class → 回填时跳过禁用字段（系统自动生成或从其他来源带入的）。运行时 DOM 状态即真实状态，比静态接口定义更准确。

### 3.5 隐藏/自动字段识别

requestBody 中约 48 个字段在接口一元素定义中没有对应 prop → 判定为非表单字段（审计字段、URL 回显、计算字段）→ 回填时跳过。这个识别本身就是三接口交叉验证的结果：

```
需回填的字段集合 = 接口一 prop 集合 ∩ 接口三 requestBody key 集合
```

---

## 4. 边界场景——JS-gen 侧逻辑兜底

以下场景表面上看三接口数据不够，但均可通过 JS-gen 侧增加逻辑解决，不需要 SUT 侧增强接口。

### 4.1 级联下拉

**场景**：省份→城市→区县、银行总行→分行→支行。选择父级后子级 options 扨动态加载。

**看似的缺口**：接口一给的是静态 options，不反映级联关系；三接口都没有标记哪些 select 是级联的、依赖哪个父字段。

**JS-gen 侧解决逻辑**：按 DOM 出现顺序逐个填 select，每次填完一个后重新查询后续 select 的 options（Vue 在父级选中后会动态加载子级选项）。不需要预知级联关系——DOM 顺序天然就是级联顺序（父 select 在子 select 之前）。

**结论**：不需要 SUT 增强。

### 4.2 条件显隐字段

**场景**：某些字段的显示/隐藏取决于其他字段的值（如「对公客户类型=企业类」时显示「注册资本」，「事业类」时显示「经费来源」）。

**看似的缺口**：接口一返回全量静态定义，不包含显隐规则。

**JS-gen 侧解决逻辑**：
1. 每填完一个字段后重新查询 DOM，检查是否有新出现的 `el-form-item`
2. 对定位失败的字段（当前隐藏）先跳过
3. 全部填完后统一重试一轮——此时触发显隐条件的字段已填入值，之前隐藏的字段可能已显示

**结论**：不需要 SUT 增强。

### 4.3 重复子表 / 动态行

**场景**：「添加多个联系人」「添加多行账户」这类可重复区域。

**看似的缺口**：接口一只列出一组字段定义，不反映重复结构；三接口都没有标记哪些字段属于可重复组。

**JS-gen 侧解决逻辑**：
1. DOM 侧：检测同 prop 出现多次的元素组 → 判定为可重复行
2. requestBody 侧：检测对应 key 是否为数组类型（如 `contacts: [{name, phone}, {name, phone}]`）
3. 逐行匹配：数组长度决定行数，每行数据对应一组同 prop 元素

**结论**：不需要 SUT 增强。

### 4.4 select 目标码值不在 DOM 选项中

**场景**：历史报文中的码值在 DOM 下拉面板的选项里找不到对应项。

**看似的缺口**：历史报文有码值 `605`，但 DOM 下拉面板只渲染了 `601`~`604`（可能因虚拟滚动未全部渲染、或选项动态加载未完成）。

**JS-gen 侧解决逻辑**：滚动下拉面板触发完整渲染，重新读取 `el-select-dropdown__item`；若仍找不到，通过 Vue 组件实例查询 el-option 的完整 value 列表；最后仍无则跳过并标注待人工。选项列表完全由 JS-gen 从 DOM 获取，不依赖接口提供。

**结论**：不需要 SUT 增强。

---

## 5. 覆盖率估算

基于对公客户概况页实测数据：

| 场景 | 字段数 | 占比 | 回填支持度 | 信息来源 / 兜底方式 |
|------|--------|------|-----------|---------|
| textbox + textarea | 47 | 38% | ✅ 完全支持 | 接口一 prop + DOM 控件类型 + 接口三 requestBody |
| date | 16 | 13% | ✅ 完全支持 | 接口一 prop + DOM 控件类型 + 接口三 requestBody |
| 普通 select | ~45 | 37% | ✅ 完全支持 | 接口一 prop + DOM 下拉选项 + 接口三 requestBody 码值 |
| 级联 select | ~6 | 5% | ✅ 支持 | JS-gen：DOM 顺序逐个填写 + 重新查询子级 options |
| unknown 类型 | 8 | 7% | ✅ 支持 | JS-gen：尝试 textbox 方式填写，失败标注 |
| 条件显隐字段 | 未知 | — | ✅ 支持 | JS-gen：填后重查 DOM + 末尾重试 |
| 重复子表 | 未知 | — | ✅ 支持 | JS-gen：DOM 同 prop 多次检测 + requestBody 数组匹配 |
| **可见字段合计** | **122** | **100%** | **100% 支持** | — |
| 隐藏/自动字段 | ~48 | — | N/A | 跳过（页面自动生成） |

---

## 6. 结论

**三个接口的数据完全足够支持历史数据回填。**

- 三个接口提供核心数据：`prop`（映射主键）、`url`（元素→接口）、`method`（HTTP 方法）、`inputParams`（字段名验证）、`requestBody`（填写值）
- 实测页面 122 个可见字段 100% 通过 prop 精确匹配，数据链完整
- 级联下拉、条件显隐、重复子表、目标码值不在 DOM 选项中四个边界场景全部由 JS-gen 侧逻辑兜底
- 不需要 SUT 侧增强接口（撤回之前提出的四项可选字段）
- 接口契约维持 `2026-08-25-sut-three-interfaces.md` 当前定义不变

JS-gen 侧需实现的兜底逻辑汇总：

| 兜底逻辑 | 触发场景 | 实现要点 |
|---------|---------|---------|
| DOM 控件类型探测 | 所有字段 | `.el-date-editor`→date、`textarea`→textarea、`.el-select`→select、`input`→textbox |
| DOM 下拉面板读 options | select 字段 | 展开 `el-select-dropdown__item` 读取选项列表（码值↔显示文本） |
| DOM 顺序逐个填 select | 级联下拉 | 每填完一个 select 后重新查询后续 select 的 options |
| 填后重查 DOM + 末尾重试 | 条件显隐 | 每填完一个字段检查是否有新 form-item 出现；全部填完后对失败字段重试一轮 |
| 同 prop 多次检测 + 数组匹配 | 重复子表 | DOM 侧检测同 prop 重复元素，requestBody 侧检测数组类型 key，逐行匹配 |
| textbox 方式 fallback | unknown 类型 | 尝试用 native setter 输入，失败则标注待人工 |
