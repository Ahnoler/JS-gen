# PR-LOC-HL · 步骤级高亮（step bbox 在阶段长图画步骤框）设计

日期：2026-08-17 · 状态：设计稿（待批准）

## 背景与目标

产品需求已变更：阶段长图**不再做元素高亮**，改为"步骤控件坐标储存 + 推送给公司其他平台"
（批量推送 V2.0 方向）。步骤控件坐标（`element_json.bbox`，内容坐标系）已随新录制落库
（见 2026-08-17-step-element-region-bbox-design.md）。

PR-LOC-HL 是**内部可视化验证工具**：在阶段长图上按录制步骤把每步操作过的控件画"步骤框"
（同一步多个元素同色 + 步骤序号），用来验证：
1. 步骤坐标（bbox）落库正确、与阶段长图坐标系对齐（重录新数据）；
2. 推送出去的坐标在长图上的落点符合预期；
3. 存量旧数据（无 bbox）也能通过阶段截图元素匹配点亮，做回归可视化。

## 数据源（同一内容坐标系，可直接叠加）

| 数据 | 来源 | 坐标 |
|------|------|------|
| 阶段长图 | `screenshot.image_data`（kind=`phase_highlight`） | — |
| 长图内容尺寸 | `screenshot.metadata_json.contentWidth/contentHeight` | 内容坐标系 |
| 长图元素 | `metadata.elements[]`（`rect{x1,y1,x2,y2}` + label/kind/regionId/layers） | 内容坐标系 |
| **步骤坐标（新）** | `trajectory_step.element_json.bbox{x1,y1,x2,y2}` | 内容坐标系（`pickScrollRoot` 滚动根，与阶段截图 rect 同一根） |
| 步骤详情 | `element_json.formLabel/text/target_kind/region_id/layers` + `action_type` + `params_json` | — |

坐标系对齐依据：`stepBBoxOf` 与阶段截图 collect 共用同一个 `pickScrollRoot` 滚动根，
`y = rect.top - root.top + root.scrollTop` 偏移语义一致（阶段截图 metadata.rect 已实测对齐，
见 spec-2026-08-17 bbox 湿测 y1=4769）。

## 渲染设计

复用 `lightup-phase-screenshot.mjs` 骨架（自包含 HTML：sticky bar + stage 缩放 + 坐标换算）：

- **图片显示**：按 `contentWidth/contentHeight` 比例缩放（浏览器拉伸），框坐标 =
  `rect × (显示宽 / contentWidth)`——与元素点亮工具完全一致。
- **步骤框**：每步一个颜色（HSL 按步序号循环，同一步多个元素同色）；`bbox` 画实线框 +
  左上角步骤序号徽标；fallback 匹配的元素画虚线框 + 虚线角标区分。
- **交互**：
  - hover 步骤框 → 详情浮层（步骤号 / action_type / 控件标签 / 参数摘要 / region / layers）；
  - 点击步骤框 → 右侧步骤列表联动高亮；
  - 顶部 bar：全部 / 仅 bbox / 仅匹配 筛选、框透明度滑块、步进器（上一/下一 步居中显示）。
- **步骤列表**：左侧/顶部列出本阶段全部步骤（步骤号 + 动作 + 标签），点击跳转对应框；
  无坐标且未匹配的步骤列出但不画框（灰色，标注"无坐标"）。

## 旧数据 fallback（三维匹配）

step 无 `bbox` 时，从 `metadata.elements[]` 匹配 rect：

- 匹配键：`label = formLabel || text || matchedLabel` → `elements.label`；
  `kind = target_kind` → `elements.kind`；`regionId = region_id` → `elements.regionId`；
  任一维度为空则跳过该维度；全空维度的 step 按未匹配处理。
- 命中即用该 element 的 `rect` 画框，标注来源 `match`。
- 实测（traj 38 phase 3，112 steps，截图 #8734）：**110/112 可匹配（98.2%）**，
  label 命中 103、kind 命中 110；仅 2 个未匹配（空 label 1 个、树标题 1 个）。

## 工具形态

- 新建 `scripts/tools/lightup-step-highlight.mjs`（与元素点亮工具分离——功能边界：前者按
  步骤聚合画框，后者按控件点亮，互不修改）。
- CLI：`--trajectory 38 [--phase 629]`（默认最新阶段截图）或 `--id <screenshotId>`；
  输出 `tmp/lightup-steps-<screenshotId>.html`（浏览器打开即用）。
- 读取复用 `config/database.js` + 直接查 `screenshot`/`trajectory_step` 两表。

## 验收标准

1. traj 38（旧数据）：≥95% 步骤点亮（fallback 路径），框与真实控件位置对齐（视觉抽查）。
2. 重录后（新数据）：直接 `bbox` 画框，与阶段长图元素 rect 重合（同坐标系双源交叉验证）。
3. 交互可用：hover 详情、步骤列表联动、筛选/步进正常。
4. `node --check` 通过；不触碰 `lightup-phase-screenshot.mjs` / `layer-tree-from-properties.mjs`。

## 不在范围

- 推送给外部平台的导出格式（步骤坐标已随 v2 接口 + element_json 落库，本次不做导出）。
- 存量 steps bbox 回填（旧数据走 fallback，不值得回填）。
- 元素分层 / 元素点亮功能的任何改动。
