# TODO: 拆分 `_form.py` 巨型注册仓

**Status:** Partial（2026-08-15/16 大幅推进；剩 `click_save` 与 scan/snapshot 壳未迁）
**Date:** 2026-08-11  
**Backlog ID:** **form-actions-split**  
**Related:** `scripts/controller/actions/_form.py`（2026-08-16 当前 ~990 行，原 ~2177）；已拆出的 `form_scan_utils.py` / `scan_summary.py` / `select_match.py` / `task_completion.py`、`form_autofill.py` / `autofill_round.py` / `autofill_pending.py`、`form_action_engines.py`、`section_scope.py`；表征 `characterize-form-engine-wiring` / `characterize-select-option-stamp` / `characterize-select-option-substring` / `characterize-phase-section-scope` / `characterize-dual-save-section`

## 背景

`_form.py` 里单个 `_register_form_actions` 闭包挂了几乎全部表单 Agent 工具，并内嵌：

| 块 | 大约位置 / 体量 | 职责 |
|----|-----------------|------|
| `_ensure_scanned` + rebuild | 前部 | 容器切换、首触扫描、TaskList |
| `_auto_fill_pending` / `_execute_round` | 中部数百行 | 助手批量填 + 分支录制 |
| `click_save` | ~400 行 | 闸门、歧义、toast、region/section |
| `select_option` | ~140 行 | xpath / first 盖章 / fuzzy / 落盘 |
| 其余动作 | 散落 | login / fill / scan / radio / tree / pending…

辅助逻辑已迁到 `form_scan_utils` / `section_scope`，但 **动作实现仍挤在闭包里**，导致：改一点要翻两千行、表征只能整文件断言、review / 并行改动冲突高。

**当前状态（2026-08-16 核对）：** 2026-08-15 重构已把 auto-fill、select/fill/login/radio/tree 引擎与 form_scan_utils 子模块迁出；2026-08-16 补齐 parity aliases 与门禁。`_form.py` 仍保留 `click_save`（约 400 行）和部分 scan/snapshot/sync 动作壳，尚未达验收线 ≲600。验证：`characterize-form-engine-wiring.py`、`characterize-select-option-substring.py` 等已绿并加入 `verify-all.sh`。

## 要做什么

1. **定拆分边界**：按「注册胶水 vs 动作实现」切开；共享状态通过显式参数 / 小 context 对象传入，避免再造全局单例。  
2. **按子刀迁出实现**（建议顺序见下），每刀后相关表征绿；`_form.py` 最终只保留 `_register_form_actions` + 薄 wrapper。  
3. **保持对外契约不变**：工具名、参数（含 `region=`/`section=`）、返回码、`_record_action` 形状、截图钩子——**行为零 diff**，只搬文件。  
4. **更新导入 / shim**：旧 `from …_form import X` 若有外部引用，兼容 re-export；characterization 改读新路径或稳定 re-export。

## 非目标（本 TODO）

- 不借机改 replay / CTRL / 产品 API。  
- 不重写 `click_save` / `select_option` 语义（含 option_text 盖章、dual-save）。  
- 不把 JS snippets 再拆一轮（已有 `js_snippets/`）。  
- 不顺手做 T7 `control_*` 改名。

## 验收草案

- `_form.py` 行数落到 **≲600**（或「仅注册 + 短委托」）；最大单动作文件可审计。  
- 既有 form / select / save / section-scope / dual-save / select-option-stamp 表征全绿。  
- `build_controller` 仍只调一个注册入口（或显式 `register_form_*` 一组，文档写清）。  
- 湿测可选：录制抽屉填表 → 保存 → 回放一条含 `select_option` 的轨迹不回归。

## 建议切入顺序（子刀）

| Slice | 迁出 | 落点草案 | 风险 |
|-------|------|----------|------|
| 0 | 只读：依赖图 + 闭包捕获清单（`case_data_store` / `_ensure_scanned` / page） | 本 TODO 附录 | 无 |
| 1 | `select_option`（+ 盖章 helper 已在 `form_scan_utils`） | `_form_select.py` 或 `form_select.py` | 中：录制落盘 |
| 2 | `click_save` | `_form_save.py` | 高：闸门/歧义 |
| 3 | `_auto_fill_pending` / `_execute_round` | `_form_autofill.py` | 高：助手路径 |
| 4 | scan / pending / summary 动作壳 | `_form_scan_actions.py`（实现已多在 utils） | 低 |
| 5 | fill / date / radio / tree / adjacent / login | `_form_fields.py` 等 | 中 |
| 6 | `_form.py` 只留注册；删死 import；backlog → Done | — | — |

每刀：**表征先绿或补一条 source/import 表征 → 搬迁 → 再绿**；禁止大爆炸一次搬完。

## 闭包捕获（Slice-0 须写清）

注册时常用捕获（迁出时改为显式注入）：

- `controller`, `browser_context`, `case_data_store`, `llm`
- 内嵌：`_ensure_scanned`, `_button_keywords`, `_auto_fill_pending`, `_select_by_xpath`, `_execute_round`
- 横切：`_record_action` / `record_action_with_screenshots` / `_ok`/`_err` / `_with_submit_cue`

## 实现记录

| Slice | 状态 | 说明 |
|------|------|------|
| 0 | ✅ 已完成 | 依赖/闭包捕获由 `FormAutofillEngine` + `form_action_engines` 的显式 engine 注入承接（`17b5a42` parity aliases 补齐） |
| 1 | ✅ 已完成 | `select_option` → `SelectEngine`（`bc97002`），盖章/匹配在 `select_match.py` |
| 2 | ⬜ 待做 | `click_save` 仍在 `_form.py`（闸门/歧义/toast/region/section） |
| 3 | ✅ 已完成 | `_auto_fill_pending` / `_execute_round` → `autofill_pending.py` / `autofill_round.py`（`83827f6`） |
| 4 | ⏳ 部分 | scan/pending/summary 实现已拆到 `scan_summary.py` / `task_completion.py`；动作壳仍在 `_form.py` |
| 5 | ✅ 已完成 | login/fill/radio/tree/adjacent → `form_action_engines.py`（`bc97002`） |
| 6 | ⬜ 待做 | `_form.py` 只留注册 + 删死 import；当前 ~990 行 |
