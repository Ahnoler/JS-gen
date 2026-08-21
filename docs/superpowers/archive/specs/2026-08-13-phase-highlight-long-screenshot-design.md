# Design: Phase highlight long-page screenshot (AI record)

**Date:** 2026-08-13  
**Status:** Approved — plan at `docs/superpowers/plans/2026-08-13-phase-highlight-long-screenshot.md`  
**Trigger:** 产品要在 AI 录制阶段结束后，把本阶段操作过的控件高亮，再滚屏拼成一张长图给用户看。清单原 **PR-LOC**（phase stitch）与 **PR-LOC-HL**（操作后高亮）在本刀合并为「阶段 done 时控件描边 + 长页拼接」，不是逐步截图。  
**Related:** [product brief](2026-08-12-product-requirements-miaoyi-brief.md) PR-LOC / PR-LOC-HL; [todo-list](../todo-list.md); [unify partition](2026-08-12-unify-partition-locator-architecture-design.md); `filterMetaSteps` (`src/models/meta-step-actions.js`)

## Problem

现有截图只按 **步骤** 存 `before`/`after`（`screenshot.trajectory_step_id` + `kind`），给回放/调试用，不是给用户看「这一阶段 AI 动过哪些控件」。

长表单（对公客户概况等）一屏装不下；阶段结束时弹窗可能已关、页面可能已跳。需要一张 **phase 级** 展示图：当前页长图 + 仍能定位到的操作控件描边。分区算法只负责把同名控件找准，不把整块 region 涂色。

## Goals

1. AI 录制每个阶段 `phase_done`（步骤已落库）后自动生成 **1** 张长图，绑在该 `trajectory_phase`。  
2. 高亮集合 = 产品步骤树：`filterMetaSteps` 之后的步骤对应的 **L2 控件**（填写/点击/下拉等用户看得见的步）。  
3. 在 **当前页** 用 `xpath_smart` + 分区再定位；命中则描边；找不到则跳过该步。  
4. 一个控件都找不到也保存当前页长图。  
5. 截图失败不让录制失败。

## Non-goals

- 人工录制本刀不做。  
- 不整块 region 刷色、不把整页当一个高亮区。  
- 不逐步操作完成后立刻截（原 PR-LOC-HL 逐步高亮仍挂起）。  
- 不改步骤 `before`/`after` 截图。  
- 不重放整阶段、不重开已关弹窗。  
- 本刀不加步骤序号角标。  
- 不单独再截一张弹层长图（弹层若仍开着，会进当前视口那一段）。  
- 前端不算分区、不画框；只展示 phase 上的图 URL。

## Locked decisions

| # | Decision |
|---|----------|
| 1 | 触发 = 每个 AI 阶段 `phase_done` 且本阶段步骤已 flush；绑 `trajectory_phase`。 |
| 2 | 高亮 = 当前页仍能定位的操作 **控件**；分区只用于消歧定位。 |
| 3 | 步骤过滤 = `filterMetaSteps`（与产品树一致）。 |
| 4 | 0 命中仍存当前页长图。 |
| 5 | 捕获 = 页上临时描边 → 滚主滚动区拼接 → 去掉描边。 |
| 6 | 失败软：warn，录制继续。 |
| 7 | 逐步高亮截图（每步一张）仍是 **PR-LOC-HL 残余**，本刀不包含。 |

## Architecture

```text
AI record phase_done
  → persist remaining action_log steps
  → capturePhaseHighlightScreenshot(phaseId)   // fail-soft
       1. load steps of phase → filterMetaSteps
       2. CDP evaluate: resolve hosts (xpath_smart → region scope → xpath_full)
       3. mark hits with temporary outline
       4. find scroll root (.el-main / overflow / document)
       5. viewport screenshots + stitch PNG
       6. unmark
       7. UPSERT screenshot kind=phase_highlight
       8. trajectory_phase.stitch_screenshot_id = id
  → continue next phase / stop recording
```

**谁执行：** JS-gen 控制面编排，走已附着会话的 CDP（与 `resolve-element` 同源：可注入 `PAGE_LOCATOR_HELPERS`）。不把拼接逻辑放到 Python agent。无 CDP / 已 detach → skip + warn。

**`phase_error` / abort：** 没有成功的 `phase_done` 则 **不截**。`phase_done` 且 `success=false` 仍截（展示已操作过的控件）。

## Storage

`screenshot` 今日：`kind ENUM('before','after')`，`trajectory_step_id` NOT NULL 语义（UPSERT 键 `uk_ss_step_kind`）。

本刀变更：

1. `kind` 增加 `phase_highlight`。  
2. 增加可空 `trajectory_phase_id`（FK → `trajectory_phase.id` ON DELETE CASCADE）。  
3. `phase_highlight` 行：`trajectory_step_id` 为 NULL；`trajectory_id` 必填。  
4. 唯一键 `uk_ss_phase_kind (trajectory_phase_id, kind)`，每阶段一张，重复生成覆盖。  
5. `trajectory_phase.stitch_screenshot_id` 可空 FK → `screenshot.id` ON DELETE SET NULL。写入顺序：先 INSERT/UPSERT `screenshot`（带 `trajectory_phase_id`），再 UPDATE phase 的 `stitch_screenshot_id`（避免循环外键插不进去）。

查询：交易树 / phase 详情带 `stitchScreenshotId` + 已有 `GET /api/v2/screenshots/:id/image`。列表接口可附带 `kind=phase_highlight` 的 meta（不含 blob）。

超 `MEDIUMBLOB` 16MB：拼接后若 `file_size` 过大则缩小（降低宽度或 JPEG `image/jpeg`）再写入；仍超则截断高度并 warn。

## Pipeline (page)

1. **解析控件**  
   对每条业务步骤，按序：  
   - `element.xpath_smart`：`document.evaluate` 快照；恰好 1 个 **可见** 节点 → 命中。  
   - 多个节点：用步骤 `region_id` / `region_label` 与 `assignRegion(node)` 对齐后再取可见命中。  
   - 否则 `xpath_full`。  
   - 不可见 / 0 命中 → 跳过。  
   同一 DOM 节点多步操作只描一次。

2. **描边**  
   命中加 `data-jsgen-phase-hl="1"` + 页内一次性 stylesheet（Chrome 审查风：`outline: 2px solid #1a73e8` + `box-shadow: inset 0 0 0 9999px rgba(111,168,220,.45)`），不改 layout、不改业务 class。截完删除属性与 stylesheet。

3. **滚动根**  
   优先可见 `.el-main` / `.app-main` 且 `overflow` 为 auto/scroll 且 `scrollHeight > clientHeight`；否则文档根。粘性顶栏允许切片重叠（例如 48px）。

4. **拼接**  
   滚到 0 → 截视口 → 增加 `clientHeight - overlap` → 重复，直到底部或切片上限（30）。Node 侧纯 JS PNG 拼接（P0 用 `pngjs`，不强制 `sharp`）。截完恢复滚动位置。

## Error handling

| 情况 | 行为 |
|------|------|
| 无附着 CDP | skip + warn |
| 0 步或全是 meta | 仍截当前页长图（无描边） |
| evaluate / 截图像失败 | warn，不抛出录制 |
| 图过大 | 缩小或转 JPEG；仍失败则 skip + warn |
| 覆盖生成 | UPSERT 同 phase+kind，更新 `stitch_screenshot_id` |

## Testing

**Characterization（无浏览器或 fixture DOM）：**

- `filterMetaSteps` 输入含 `save_form_snapshot` → 高亮候选不含 meta。  
- 唯一 `xpath_smart` 可见节点 → 进入 hit 列表。  
- 0 hit 仍要求「产出一张图」的服务契约（可用 mock CDP）。  
- 迁移：`kind` 含 `phase_highlight`；phase 有 `stitch_screenshot_id`。

**湿测（CDP / BiB，对公长表单阶段）：**

- `phase_done` 后该 phase 有 `stitchScreenshotId`，image API 返回 PNG/JPEG。  
- 仍在页上的填写/点击控件有蓝框。  
- 已关弹窗内的操作无框。  
- 故意杀掉截图路径时录制仍能 `recorded`。

## Product tracking

- **PR-LOC**（本刀）：phase 绑定长图 + 控件高亮。  
- **PR-LOC-HL**：逐步「操作完成后高亮再截」仍 **挂起**。  
- **PR-LAYER**：不在本刀；分层树继续等分区主线。
