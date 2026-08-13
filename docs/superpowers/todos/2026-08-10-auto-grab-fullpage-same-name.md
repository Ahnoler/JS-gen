# TODO: 自动抓取 → 全页可见可操作控件 + 同名消歧

**Date:** 2026-08-10  
**Status:** Implemented 2026-08-10 — 代码已实施（JS-gen Tasks 1–5 + Vue sibling）；表征 inventory + titlebox PASS。**湿测按需**（BiB 重载 + 多「新增」UI 冒烟未跑）。  
**Product surface:** 步骤弹窗「自动抓取」/ `POST .../resolve-element`  
**Backlog ID:** **AG-fullpage**（见 [backlog-visible-editable-controls](../backlog-visible-editable-controls.md)）

## 要做什么

1. **抓取范围升级**：自动抓取以**当前页全部可见、已分类、可操作控件**为池（与 [fullpage L2](../specs/2026-08-10-fullpage-visible-controls-scan-design.md) 同源）；`actionType` 与 label 文案均为**可选过滤**。
2. **无 label → 全量给用户看**（弹选择器）；有 label → 唯一直写 / 多匹配选择器。
3. **同名相同处理**：L1 + titlebox 碰撞细化 + `xpath_smart`。
4. **选中后若未选操作类型 → 按 `target_kind` 自动填写 actionType**（及文案 params）。

**Design：** [specs/2026-08-10-auto-grab-fullpage-inventory-design.md](../specs/2026-08-10-auto-grab-fullpage-inventory-design.md)（Implemented）  
**Plan：** [plans/2026-08-10-auto-grab-fullpage-inventory.md](../plans/2026-08-10-auto-grab-fullpage-inventory.md) 

## 已有可复用

| 能力 | 文档 / 代码 |
|------|-------------|
| 全页 L2 + L1 归位 | fullpage scan P0–P2 |
| 针搜歧义 + `region_*` | resolve ambiguous L1 preview |
| 同区碰撞 titlebox 细化 | collision finer L1 titlebox（`b207372`） |
| 保存保留 `xpath_smart` | Vue `buildElement` + `enrichLocatorFields` |

## 非目标（本 TODO）

- 清单触发 auto-fill  
- 用 `region_*` 替代 xpath 做回放主定位  
- 本刀不必上 L1c-LLM  

## 验收草案

- 自动抓取可列出（或过滤后列出）当前页可见可操作控件，含壳层 menu（若 fullpage 已含）。  
- 同名 ≥2：选择器行可区分（`region_label` / 锚定 xpath）；保存后 `xpath_smart` 不被裸 leaf 覆盖。  
- Characterization + 湿测：对公编辑页多「新增」与今日 picker 行为对齐或更优。
