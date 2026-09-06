# 步骤 element 分层 + 坐标入库 · Design

**Status:** 设计已定（2026-08-17 用户拍板 3 决策）  
**Tracking:** [`todo-list.md`](../todo-list.md) PR-LOC-HL · 本 spec 为「按 step 分层 + 步骤级高亮」前置项

## 1. 背景 / 问题

产品需求澄清（2026-08-17）暴露设计缺陷：

1. 阶段截图（`metadata.elements`）记录元素位置与信息，**与分层无关**——分层不应依赖截图；
2. **要求根据 step 的 element_json 直接完成元素分层**（产品需求）；
3. step 还需记录**坐标**，用于完成「步骤级高亮截图」（PR-LOC-HL）。

现状缺口（已全库核实）：`trajectory_step.element_json` 只含 `xpath/text/formLabel/target_kind/candidates` 等——**无 region/layers/bbox**（1796 步仅 10 个单层 `main`）。导致：
- 元素分层工具 `--trajectory` 模式无分层数据（traj 38 显示"未分区 115 步"）；
- 推送导出 `transcationProperties.regionId` 为空（`deriveRegionRef` 读 element 的 region，而 element 没有）。

## 2. 目标

录制时把步骤操作控件的 **`region_id` / `region_label` / `layers[]` + `bbox`（内容坐标）** 写入 `trajectory_step.element_json`，使：
- **元素分层**：直接读 step element_json（不依赖截图）；
- **步骤级高亮**：step bbox 可直接在阶段长图上画框（PR-LOC-HL 后置项，坐标先备好）。

## 3. 已拍板决策

| 决策 | 结论 |
|------|------|
| bbox 坐标系 | **内容坐标系**（对齐阶段截图 `metadata.elements[].rect`） |
| 获取时机 | **Python 录制动作时**（`_capture_element` / `_enrich_click_element` 等，操作前后 DOM 未变） |
| 存量处理 | **只影响新录制**，存量 1796 步不回填 |

## 4. 方案

### 4.1 数据格式（element_json 新增 4 字段）

```jsonc
// trajectory_step.element_json 现有字段保持不变，新增：
{
  "region_id": "tab:客户基本信息|section:对公客户概况|titlebox:基本信息",
  "region_label": "tab页签:客户基本信息 / 功能分区:对公客户概况 / 标题栏:基本信息",
  "layers": [ { "role": "tab", "label": "客户基本信息" },
              { "role": "section", "label": "对公客户概况" },
              { "role": "titlebox", "label": "基本信息" } ],
  "bbox": { "x1": 32, "y1": 214, "x2": 1504, "y2": 260 }   // 内容坐标（相对滚动根 box + scrollTop）
}
```

字段对齐阶段截图 metadata 命名：`layers`（同 metadata.elements[].layers）、`region_id`/`region_label`（element 已有约定）、`bbox`（新增，明确"步骤操作时的控件位置"）。

### 4.2 坐标体系（内容坐标，对齐长图）

复用阶段截图同一套滚动根逻辑（`pickScrollRoot`，含内部滚动容器泛化，`src/cdp/phase-screenshot-page.js`）：

```
root = pickScrollRoot()            // .el-main/.app-main 优先；否则全页最高可滚动容器
box  = root.getBoundingClientRect()
rect = el.getBoundingClientRect()  // 操作控件
内容坐标：
  x1 = rect.left   - box.x
  y1 = rect.top    + root.scrollTop - box.y
  x2 = rect.right  - box.x
  y2 = rect.bottom + root.scrollTop - box.y
```

与 `phase-screenshot-capture.js` 的 `pushCollected` 换算完全一致（left-box.x、top+topI-box.y）——两处对齐，长图上的步骤框可直接画。

### 4.3 Python 录制侧改动

**`scripts/controller/actions/js_snippets/`**（注入 PAGE_LOCATOR_HELPERS 的 snippet）：
- `fill_core.py` 的 `JS_CAPTURE_FROM_XPATH`、`enrich.py` 的 `JS_ENRICH_CLICK_LOCATOR`：返回对象追加：
  - `region_id` / `region_label` / `layers`：对解析出的控件 `el` 调 `assignRegion(el)`（withLayers 结果）
  - `bbox`：`{x1,y1,x2,y2}` 内容坐标（用 4.2 公式，snippet 内联 pickScrollRoot + box + scrollTop）

**`scripts/controller/actions/_helpers.py`**：
- `_capture_element` / `_enrich_click_element` 返回 dict 透传新字段（`region_id`/`region_label`/`layers`/`bbox`）

**透传链路**（已确认无需改动）：Python element dict → `_record_action(..., element=element)` → action_log → Node `stepEntryToTrajectoryStep` → `element_json`（element key 原样持久化，`trajectory-step-service.js` 不裁剪）。

### 4.4 消费方

- **元素分层**：`layer-tree-from-properties.mjs --trajectory` 已支持读 `layers`/`region_id`（无需改）；
- **步骤级高亮**（PR-LOC-HL 后置）：读 step `bbox` 在阶段长图上画框；
- **推送导出**：`transcationProperties.regionId` 自动带出（`deriveRegionRef` 读 element region）；`bbox` 导出后置。

## 5. 边界

- 只影响新录制（存量不回填，已拍板）；
- 本期落地：element_json 写入 + 分层工具可用；步骤级高亮用 bbox 画框为 PR-LOC-HL 后置（坐标已备）；
- 推送导出 bbox 字段后置。

## 6. 验证

1. **characterization**（Python）：断言 `JS_CAPTURE_FROM_XPATH` / `JS_ENRICH_CLICK_LOCATOR` 含 `assignRegion` + `bbox` 换算（`scrollTop`）；断言 `_helpers.py` 透传新字段；
2. **Python import smoke**：`_js_snippets` / `form_action_engines` 可导入；
3. **录制湿测**：录带 tab/向导/折叠的页面（如 traj 38 场景），验证 element_json 含 region/layers/bbox + `layer-tree --trajectory` 显示多层树 + 坐标与阶段截图 metadata 坐标系一致（box 命中同一滚动根）。

## 7. 风险

- **滚动根一致性**：录制时与截图时滚动根必须同逻辑（4.2 复用 `pickScrollRoot`），否则 bbox 与长图坐标系错位——用同一实现 + 湿测验证 box；
- **snippet 体积**：PAGE_LOCATOR_HELPERS 已 1576 行注入，新增 assignRegion 调用无额外注入成本（helpers 已含）；
- **evaluate 开销**：每动作多一次 region/bbox 计算，可忽略。
