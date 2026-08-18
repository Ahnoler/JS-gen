# PR-LOC-HL · 步骤级高亮工具（step bbox → 阶段长图画步骤框）实施计划

日期：2026-08-17 · 前置：design（2026-08-17-pr-loc-hl-step-highlight-design.md，已确认方向）

## 目标

新建 `scripts/tools/lightup-step-highlight.mjs`：读阶段长图 + 同 phase 步骤，
在长图上按步骤画"步骤框"（同一步多元素同色 + 步骤序号），hover/点击看步骤详情。
新数据用 `element_json.bbox` 直画；旧数据（无 bbox）fallback 三维匹配阶段截图元素 rect
（实测 traj 38 phase 3：110/112 = 98.2% 可匹配）。

## 任务拆分（TDD：每个任务先 characterization 后实现）

### Task 1: 数据加载 + 三维匹配纯函数

- 工具文件顶部实现（导出的纯函数，便于 characterization import）：
  - `loadPhaseData(db, {trajectoryId, phaseId, screenshotId})` → `{screenshotId, meta, steps}`：
    - screenshot 行（`--id` 直查 / `--trajectory [--phase]` 取最新 `kind='phase_highlight'`）
    - `meta = metadata_json`（`contentWidth/contentHeight/elements[]`）
    - steps：`trajectory_step` 按 `trajectory_phase_id` 排序（`id/action_type/params_json/element_json`），
      归一化 `{stepId, seq, actionType, label, kind, regionId, bbox, params}`
      （label = `formLabel || text || matchedLabel`；bbox 校验 `x2>x1 && y2>y1`）
  - `matchStepToElement(step, elements)` → element | null：三维键 `label→label`、`kind→kind`、
    `regionId→regionId`，任一维度为空跳过；优先级 regionId > label > kind（region 最精确）。
  - `resolveStepBoxes(steps, elements)` → `[{step, boxes: [{rect, source: 'bbox'|'match'}]}]`
    （bbox 直用；无 bbox 走匹配，匹配多个取第一个）。
- characterization `scripts/characterization/characterize-step-highlight.mjs`：
  - 用 traj 38 phase 3 真实 DB 数据断言：steps 数 > 100；bbox 步骤 0（旧数据）；
    fallback 匹配 ≥ 95%；label/kind 命中数符合实测（≥103 / ≥110）；
    纯函数边界（空 label、非法 rect 被滤、region 维度跳过）。
  - 注：characterization 读真实 DB（traj 38 固定）——与 characterize-step-region-bbox 同风格；
    若 traj 38 重录后 steps 有 bbox，断言更新为"bbox 步骤 ≥ 1 且优先直用"。

### Task 2: buildHtml 渲染（框 + 序号 + 图例 + 步骤列表）

- `buildHtml({b64, meta, resolved})` → 自包含 HTML（复用 lightup 骨架：sticky bar + stage 缩放 +
  坐标换算 `rect × (显示宽 / contentWidth)`）：
  - 每步一组框：`<div class=box>` 绝对定位 + `border:2px solid hsl(seq*47%360,70%,45%)` +
    左上角序号徽标（`<span class=badge>N</span>` 同色底）；
  - fallback 框虚线 border + 徽标加 `M` 后缀；无坐标步骤不画框，列表置灰；
  - 图例（bar 内）：步骤色示例 + 实线=bbox / 虚线=匹配；
  - 步骤列表（左侧 sticky 列）：步骤号 + action + 标签，`data-step` 关联。
- characterization：断言 HTML 含全部步骤框（resolved 数）、每框含 badge、虚线/实线类、
  列表行数 = steps 数、坐标换算函数正确（给定 rect/contentWidth/显示宽 → 正确 px）。

### Task 3: 交互脚本

- hover 框 → 详情浮层（步骤号 / action_type / 标签 / 参数摘要 / region / 来源 bbox|match）；
- 点击框 → 列表联动高亮；点击列表行 → 对应框闪烁 + 若不可见滚动 stage 到框；
- bar 筛选 radio：全部 / 仅 bbox / 仅匹配 / 无坐标；透明度滑块；步进器（上一步/下一步居中）；
- Escape 关浮层。
- 验证：生成 HTML 后 9242 浏览器人工抽查交互（列表点击联动、浮层、筛选）。

### Task 4: CLI + 收尾

- CLI：`node scripts/tools/lightup-step-highlight.mjs --trajectory 38 --phase 629` /
  `--trajectory 38`（最新阶段截图）/ `--id <screenshotId>` / `--width 1000`；
  输出 `tmp/lightup-steps-<screenshotId>.html`；打印统计（steps 总数 / bbox 数 / 匹配数 / 无坐标数）。
- `node --check` 两文件；characterize 注册进 `scripts/refactor/verify-all.sh`；
- 端到端：traj 38 phase 3 → HTML 生成 → 9242 打开抽查（旧数据 fallback 点亮 + 交互）；
  重录后新数据再验 bbox 直画（步骤框与元素点亮框重合）。

## 验收

1. traj 38（旧数据）点亮率 ≥ 95%（characterization 断言）。
2. HTML 交互可用（9242 抽查）。
3. `verify-all.sh` 全绿（新增 characterize 注册）。
4. 不触碰 lightup-phase-screenshot.mjs / layer-tree-from-properties.mjs（功能分离）。

## 实施方式

主线程直接实现（子代理额度上次不足，不再依赖）。每任务：先写 characterization 断言 →
跑红 → 实现 → 跑绿。完成后汇报统计与 HTML 路径。
