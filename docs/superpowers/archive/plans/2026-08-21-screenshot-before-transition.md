# 关键状态前置截图 · 实施计划

日期：2026-08-21 · 前置：spec `docs/superpowers/specs/2026-08-21-screenshot-before-transition-spec.md`（已评审通过）
范围：仅 `scripts/`（Python 子进程），无 schema / WS / Node 侧改动

## 目标

1. **G1**：会话/浏览器关闭前（含异常路径）必定有一次当前页面截图（`capturedAt:'session-end'`）；
2. **G2**：`close_dialog` 在关闭动作执行前捕获弹窗裁剪图（`capturedAt:'before-close'`）；
3. **G3**：`close_notification` 关闭前有截图（移出跳过名单 + 通知裁剪选择器）。

全程不改截图存储 schema / WS 协议（复用 `page_level_screenshot` 事件与 `trajectory_step`/页面级截图落库）。

---

## 任务拆分

### Task 1: G1 会话结束最终截图

文件：
- `scripts/state.py`
- `scripts/session_runner.py`

内容：
- `state.py:200-218` `register_current_page_screenshot(browser_context, *, png_b64=None)` 增加可选参数 `captured_at: str = 'phase-end'`：meta 的 `capturedAt` 改用该参数（`:215` 处 `'phase-end'` → `captured_at`），默认值保持现有调用方（phase 结束，`session_runner.py:328`）语义不变；
- `session_runner.py` 在 `browser_context.close()`（`:433`）**之前**插入最终截图（所有退出路径——正常/error/cancel/SystemExit——都会流经此处）：
```
try:
    from .state import register_current_page_screenshot
    await register_current_page_screenshot(browser_context, captured_at='session-end')
except Exception:
    pass  # 截图失败不阻塞关闭
```

验证：
- `py_compile scripts/state.py scripts/session_runner.py` 通过；
- 人工读码确认插入点在 `:433` close 之前、且在主循环之外（覆盖全部退出路径）。

---

### Task 2: G2 close_dialog 前置弹窗截图

文件：
- `scripts/controller/service.py`（`_wrap_action_with_screenshots`，`:43-121`）

内容：
- before 阶段（`:68` `capture_page_png_b64` 之后）增加：
```
pre_dialog_b64, pre_dialog_meta = None, None
if action_name == 'close_dialog':
    pre_dialog_b64, pre_dialog_meta = await capture_dialog_png_b64(browser_context)
    if pre_dialog_b64:
        pre_dialog_meta = dict(pre_dialog_meta or {})
        pre_dialog_meta['capturedAt'] = 'before-close'
        await register_popup_screenshot(
            browser_context,
            page_key=before_key or '',
            dialog_title=(pre_dialog_meta or {}).get('dialogTitle') or '',
            anchor_xpath=(pre_dialog_meta or {}).get('anchorXpath') or '',
            dialog_b64=pre_dialog_b64,
            dialog_meta=pre_dialog_meta,
        )
```
- 动作后（`:95-110`）：`close_dialog` 时**跳过** post 弹窗捕获（弹窗已关闭，必为空）；`emit_step_screenshot` 的 dialog 参数改用 `pre_dialog_b64`/`pre_dialog_meta`（成功时），失败则维持现状（None）；
- 兜底：`close_dialog` 前置捕获失败（无弹窗/异常）→ 行为与现状一致。

验证：
- `py_compile scripts/controller/service.py` 通过；
- 人工读码确认：① 前置分支只在 `action_name == 'close_dialog'` 时触发；② post 分支对 close_dialog 不再调 `capture_dialog_png_b64`；③ 非 close 动作行为不变。

---

### Task 3: G3 close_notification 移出跳过名单 + 通知裁剪

文件：
- `scripts/state.py`

内容：
- `_SKIP_SCREENSHOT_ACTIONS`（`:28-41`）移除 `'close_notification'`；
- `capture_dialog_png_b64_from_page`（`:308-358`）：selector 循环追加 `'.el-notification:visible'`；标题 selector（`:342`）追加 `'.el-notification__title'`；
- 说明：close_notification 无通知时不产生动作条目（`_misc.py:260+`），移出名单不影响轨迹。

验证：
- `py_compile scripts/state.py` 通过；
- 人工读码确认 `close_notification` 不再在跳过名单中、通知选择器已追加。

---

### Task 4: characterization

文件：
- 新增 `scripts/characterization/characterize-before-close-screenshots.py`（源码断言风格，参照 `characterize-batch-actions.py`）
- `scripts/refactor/verify-all.sh`（注册）

内容（断言）：
- `_SKIP_SCREENSHOT_ACTIONS` 不含 `close_notification`；
- `service.py` 含 `if action_name == 'close_dialog'` 前置分支（before 阶段 `capture_dialog_png_b64`）；
- `session_runner.py` 在 `browser_context.close()` 前含 `register_current_page_screenshot`（`captured_at='session-end'`）；
- `state.py` 的 `capture_dialog_png_b64_from_page` selector 含 `el-notification`；
- 回归锚点不动（现有截图相关 characterization 不受影响）。

验证：
- `python scripts/characterization/characterize-before-close-screenshots.py` 输出 `ok`；
- `node scripts/characterization/characterize-ctrl.mjs`、`characterize-dedup.mjs` 及截图相关回归（page-level/dialog/export-v3）全绿。

---

### Task 5: CHANGELOG

文件：
- `CHANGELOG.md`（`[Unreleased]` → `### Changed`）

内容：
- 条目：关键状态前置截图（会话结束 session-end 最终图、close_dialog 前置弹窗裁剪 before-close、close_notification 移出跳过名单）；影响范围：录制截图语义（新增 capturedAt 取值，消费方按可选字段处理）；文件清单；Python 同步提示（capturedAt 新增值、弹窗选择器扩展，控制面如需对齐按可选处理）。

---

### Task 6: 最终验证

1. `bash scripts/refactor/verify-all.sh` ALL GREEN（本地有 MySQL/Chromium 可全量；服务器环境可只跑新 characterization + 回归子集）；
2. 湿测（需浏览器环境）：
   - 录制「打开弹窗 → 填字段 → close_dialog」→ 校验 close_dialog 步骤有 dialog 级截图（`capturedAt:'before-close'`）+ 整页 before（弹窗打开）+ after（关闭后）；
   - 含 `close_notification` 的阶段 → 通知关闭前有整页 before 图 + 通知裁剪图；
   - 会话正常结束 → 最后页面 `capturedAt:'session-end'` 页面级截图；
   - 异常退出（error/cancel）→ 仍有最终截图；
3. 提交：`git add` 任务相关文件（scripts/ + CHANGELOG + characterization + verify-all）→ commit（feat/refactor 前缀，按仓库惯例），不 push。

---

## 约束

- 只动 Task 1-5 列出的文件；不触碰 phase/reviewer.py、characterize-phase-reviewer.py 及其它无关文件；
- 不改截图存储 schema / WS 协议 / Node 消费面；
- 每个 Python 改动后立即 `py_compile`，Task 4 后跑 characterization，全部完成后 verify-all；
- 实施后按 AGENTS.md 同步约定确认 CHANGELOG 条目格式。
