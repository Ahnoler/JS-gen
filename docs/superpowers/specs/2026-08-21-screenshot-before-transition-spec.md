# 关键状态前置截图方案（Spec）

> 状态：待评审
> 日期：2026-08-21
> 前置：需求确认（页面跳转/页面关闭/弹窗关闭之前必须截图）——已核实现状：跳转前 ✅、关闭前 ⚠️ 部分、弹窗关闭前 ⚠️ 部分
> 关联：截图管线（scripts/controller/service.py 包装器 + scripts/state.py 页面级截图 + MinIO 落库）

---

## 1. 背景：现状核实（带证据）

### 1.1 已满足：页面跳转前截图
- **step 级**：所有 controller 动作执行前先拍 before 整页图（`scripts/controller/service.py:58-70`，`before_b64 = await capture_page_png_b64(...)` 在 `func(*args)` 之前），动作后另有 after 图；
- **page-level 级**：`register_page_screenshot_if_changed`（`scripts/state.py:221-256`）在动作后检测到页面变化（`before_key != after_key`）时，把**跳转前的旧页面图**以 `capturedAt:'before-leave'` 注册为页面级截图并上报（:234-243）。

### 1.2 未满足/部分满足
| # | 场景 | 现状 | 证据 |
|---|---|---|---|
| G1 | **页面/浏览器关闭前** | 正常结束：最后一个阶段结束时 `register_current_page_screenshot`（`capturedAt:'phase-end'`，`session_runner.py:328`）已覆盖；**异常路径未覆盖**：主循环 error/cancel（`:414-426`）直接 break → `browser_context.close()`/`browser.close()`（`:433-452`）无任何最终截图 | `scripts/session_runner.py:414-452` |
| G2 | **弹窗关闭前（弹窗裁剪图）** | dialog 裁剪图在动作**执行后**捕获（`service.py:95-110`）；`close_dialog` 执行后弹窗已消失 → `capture_dialog_png_b64` 返回 (None,None) → 弹窗级截图与 step 级 dialog 图均缺失（整页 before 图里虽有弹窗，但无弹窗裁剪/弹窗 key） | `scripts/controller/service.py:95-110`；`scripts/state.py:375+`（只找可见弹窗） |
| G3 | **通知关闭前** | `close_notification` 在 `_SKIP_SCREENSHOT_ACTIONS` 跳过名单（`scripts/state.py:28-41`）→ 关闭前无任何截图（含整页图） | `scripts/state.py:28-41` |

## 2. 目标 / 非目标

**目标**

- 会话/浏览器关闭前（含异常路径）必定有一次当前页面截图（`capturedAt:'session-end'`）；
- `close_dialog` 在关闭动作**执行前**捕获弹窗裁剪图（弹窗内容可追溯）；
- `close_notification` 关闭前有截图（移出跳过名单，页面级 before/after + 可选通知裁剪）。

**非目标**

- 不改截图存储 schema / WS 协议（全部复用现有 `page_level_screenshot` 事件与 `trajectory_step`/页面级截图落库）；
- 不做 tab 关闭（switch_tab 关闭标签页）的特殊截图（before 图已覆盖切换前页面）；
- 不改变现有 after 截图的语义与节奏。

## 3. 方案

### 3.1 G1：会话结束最终截图（core）

在 `scripts/session_runner.py` 主循环退出后、`browser_context.close()` 之前（`:433` 前）插入：

```
try:
    from .state import register_current_page_screenshot
    await register_current_page_screenshot(browser_context, png_b64=None)
except Exception:
    pass   # 截图失败不阻塞关闭
```

- `register_current_page_screenshot`（`state.py:200-218`）已有实现，仅需给 meta 增加 `capturedAt:'session-end'` 标记（新增可选参数 `captured_at`，默认维持 `'phase-end'` 语义不变，页面级截图时区分来源）；
- 覆盖正常结束（幂等：与最后阶段 phase-end 图同 key 会被替换/合并）与异常退出（error/cancel 路径统一走这里）；
- Node 侧无需改动（复用现有 `page_level_screenshot` 事件 → persist-live 落库）。

### 3.2 G2：close_dialog 前置弹窗截图（core）

改造 `scripts/controller/service.py` 包装器：

```
在 before 阶段（capture_page_png_b64 之后）增加：
    pre_dialog_b64, pre_dialog_meta = None, None
    if action_name == 'close_dialog':
        pre_dialog_b64, pre_dialog_meta = await capture_dialog_png_b64(browser_context)
        if pre_dialog_b64:
            await register_popup_screenshot(browser_context, page_key=before_key,
                dialog_title=(pre_dialog_meta or {}).get('dialogTitle') or '',
                anchor_xpath=(pre_dialog_meta or {}).get('anchorXpath') or '',
                dialog_b64=pre_dialog_b64, dialog_meta=pre_dialog_meta)
执行 func 后：
    close_dialog 时跳过 post 弹窗捕获（弹窗已关闭，捕获必为空），
    emit_step_screenshot 的 dialog 参数改用 pre_dialog_b64（若成功），否则 None（维持现状）
```

- `capture_dialog_png_b64`（`state.py:375+`）只找可见弹窗——动作前调用正好命中打开状态的弹窗，无需改其实现；
- popup 截图 meta 增加 `capturedAt:'before-close'`（`register_popup_screenshot` 已支持 meta 透传，`state.py:276-278`）；
- 兜底：若前置捕获失败（无弹窗/异常），行为与现状一致（无弹窗级截图，不影响动作执行）。

### 3.3 G3：close_notification 移出跳过名单（小改）

- 从 `_SKIP_SCREENSHOT_ACTIONS`（`state.py:28-41`）移除 `'close_notification'` → 包装器自动为其拍 before/after 整页图（通知可见于整页图）；
- 可选增强（一并做，改动小）：`capture_dialog_png_b64_from_page` 的 selector 列表追加 `'.el-notification:visible'`，标题 selector 追加 `'.el-notification__title'` —— 通知关闭前也能出裁剪图；
- 注意：close_notification 的 `_record_action` 仅在确有通知时记录（`_misc.py:260+`），无通知时不产生动作条目，不影响轨迹。

## 4. 验收

1. **characterization（源码断言风格，参照 characterize-batch-actions.py）**：
   - `_SKIP_SCREENSHOT_ACTIONS` 不含 `close_notification`；
   - `service.py` 含 close_dialog 前置弹窗捕获分支（`action_name == 'close_dialog'` + before 阶段调用 `capture_dialog_png_b64`）；
   - `session_runner.py` 在 `browser_context.close()` 前含 `register_current_page_screenshot` 调用；
   - `state.py` 的 `capture_dialog_png_b64_from_page` selector 含 `el-notification`（若做可选增强）。
2. **湿测**：
   - 录制一个含「打开弹窗 → 填字段 → close_dialog」的阶段 → 校验：close_dialog 步骤有 dialog 级截图（`capturedAt:'before-close'`）+ 整页 before（弹窗打开状态）+ after（关闭后）；
   - 阶段含 `close_notification` → 校验通知关闭前有整页 before 图（+ 通知裁剪图）；
   - 会话正常结束 → 最后页面有 `capturedAt:'session-end'` 页面级截图；
   - 人为制造异常（如 kill Python 前触发 error）→ 仍有最终截图（异常路径）。
3. **verify-all.sh** ALL GREEN（现有截图相关 characterization 回归：page-level、dialog、export-v3 等）。

## 5. 备选方案（否决记录）

| 方案 | 否决原因 |
|------|----------|
| A. 在 browser_use 层加导航前全局钩子 | 侵入框架内部（multi_act），升级即碎；现包装器已覆盖 controller 动作级，缺的只是关闭类特例 |
| B. 新事件类型/新 DB 字段存 session-end 图 | 页面级截图机制已支持（level_type=page，key 复用），加新事件反而要改 Node 消费面；复用现有事件零改动 |
| C. 所有弹窗动作都前置截弹窗图 | 打开弹窗后的 fill/select 场景，post 捕获能看到更新后的弹窗内容（更符合回放追溯）；只有关闭类动作需要前置 |

## 6. 风险与对策

- **异常路径截图可能失败**（页面已崩/连接断开）：try/except 包裹，失败静默，不阻塞关闭；
- **session-end 与 phase-end 同 key 覆盖**：同页面 key 后写覆盖先写（现有语义），meta 中 capturedAt 保留最新一次——不影响追溯；
- **close_dialog 前置捕获多一次浏览器调用**：仅 close_dialog 动作触发，频率极低，无性能影响；
- **通知裁剪选择器误匹配**：`.el-notification:visible` 仅当存在可见通知时命中，与现有弹窗选择器同级，风险低。

## 7. 关联

- 截图管线：`scripts/controller/service.py`、`scripts/state.py`、`scripts/session_runner.py`、`scripts/controller/actions/_misc.py`
- 落库链路（不改）：`src/services/trajectory/trajectory-recording-runner.js:148-185`（step_screenshot / page_level_screenshot 监听）→ persist-live → MinIO
- 实施注意：本 spec 改动全部在 `scripts/`（Python 子进程），按同步约定 CHANGELOG 建议条目（影响录制截图语义，Python 控制面无需迁移）；无 schema/WS 变更
