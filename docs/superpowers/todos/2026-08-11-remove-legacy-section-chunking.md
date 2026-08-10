# TODO: 移除旧分块判断

**Date:** 2026-08-11  
**Status:** Open  
**Backlog ID:** **legacy-section-retire**  
**Related:** [L1 region preview](../specs/2026-08-10-resolve-ambiguous-section-preview-design.md)（§ Relationship to older「分块」）; [dual-save section xpath](../specs/2026-08-10-dual-save-section-xpath-design.md); [phase section scope](../specs/2026-08-08-phase-section-scope-design.md); D3 `sectionOf` / `click_save(section)`

## 背景

历史上「分块」有两套并存：

| | **旧分块（D3 / Source C）** | **新 L1 区域** |
|--|---------------------------|----------------|
| 信号 | collapse / tab / card → `section_id` / `section_title` | `region_role` / `region_label`（+ titlebox） |
| 产品面 | `click_save(section=…)`、scan `buttons[].section`、TaskList 分节 | resolve inventory / 歧义 picker、fullpage 归位 |
| xpath | `sectionAnchorOf` / `sectionAnchorXPath` | region / titlebox / page-state 锚 |
| 壳层 | 基本忽略 | 一等公民 |

L1 / titlebox / page-state-gen 落地后，旧分块在 **消歧与展示** 上已不够用，却仍在 scan、pending gate、`click_save(section)`、Python/Vue 字段名里占一套词汇，造成双轨维护与「section vs region」混淆。

## 要做什么

1. **盘点调用面**：列出仍依赖旧分块判断的路径（`sectionOf` / `sectionAnchorOf` / `section_title` 匹配 / `resolve_phase_section` 启发式 / Vue `section` 字段）。
2. **定迁移映射**：哪些场景改读 `region_*`（或 titlebox），哪些仍保留「可折叠区块标题」作为 **xpath 锚前缀**（若与 L1 section-role 同源可合并实现，对外只留一套名）。
3. **砍掉重复判断**：删除或降级「仅靠旧 section 猜归属」的分支；禁止再新增第三套分节词汇。
4. **产品契约**：`click_save(section=)` / API docs / Vue 是否改名为 `region` 或长期别名兼容——单独开子刀，本 TODO 先冻结「只读旧字段、写路径只写 region_*」策略草案。

## 非目标（本 TODO）

- 本刀不重写回放主定位（仍 `xpath_smart`）。  
- 不顺手做 T7 全量 `control_*` 改名。  
- 不删 dual-save / wizard 已验证的 **锚 xpath 行为**（可换实现，不可丢验收）。

## 验收草案

- 歧义 / inventory / fullpage 归位 **只依赖** L1（+ titlebox / page-state），不再用旧 `sectionOf` 作为消歧主路径。  
- 文档与 backlog 标明旧分块：Deprecated → Removed。  
- 表征：相关 section/region chars 绿；至少一条「双保存 / 同名按钮」湿测或等价 char 不回归。

## 建议切入顺序

1. Grep 库存 + 一张「保留 / 改读 region / 删除」表（只读调研可先出）。  
2. resolve / inventory 读路径去旧 section 回退。  
3. Agent `click_save(section)` / TaskList 分节：兼容期双读 → 单写 region。  
4. 删除死代码与旧命名导出。

---

## 盘点（2026-08-11，只读）

### A. 旧分块核心（CDP / 锚 xpath）

| 符号 | 主要文件 | 建议 |
|------|----------|------|
| `sectionOf` / `sectionAnchorOf` / `sectionAnchorXPath` | `src/cdp/page-locator-helpers.js`（+ `_locator_helpers_js.py` 镜像） | **保留实现作 xpath 锚**（dual-save / collapse·tab·card）；对外消歧不再单独叫「分块」；可与 L1 `section` role 合并命名 |
| 表征 | `characterize-section-anchored-xpath.py`、`characterize-dual-save-section.py` | 行为保留；改名/文档对齐 region 后更新断言文案 |

### B. Agent / 录制「section=」产品面

| 符号 | 主要文件 | 建议 |
|------|----------|------|
| `resolve_phase_section` / `_phase_section` / `remember_phase_section` | `scripts/controller/actions/section_scope.py`、`_form.py`、`recorder.py`、`recorder_emitters.py`、`agent/service.py` | **短期保留**（`click_save(section=)` 仍合法）；中期：双读 `region_label` / section 标题；长期：参数别名 `region` |
| `preferred_submit_cue` / sticky section | `section_scope.py`、`form_scan_utils.py` | 与 dual-save 门禁绑定 → 随迁移改读 L1/titlebox 标题 |
| `section_title` / `section_id` on TaskItem / buttons | `form_scan_utils.py`、`scan_utils.py`、TaskList 模型、`scan_editable_summary` | **改读/双写**：摘要与 pending 优先 `region_*`；旧字段兼容只读 |
| 表征 | `characterize-phase-runtime.py`、`characterize-preferred-submit.py` | 迁移时同步 |

### C. 新 L1（已是消歧主路径 — 勿删）

| 符号 | 主要文件 | 建议 |
|------|----------|------|
| `assignRegion` / `region_role` / `region_label` | `page-locator-helpers.js`、`resolve-by-label.js`、lifecycle | **主路径** |
| titlebox / `titleboxAnchorXPath` | helpers + collision resolve | **主路径** |
| `pageStateOf` / `tryPageStateAnchor` | helpers（page-state-gen） | **主路径**（碰撞叶） |
| L1c `buildFeatureCard` / `classifyRegions` | helpers + `src/services/region-classify.js` | **主路径**（动态角色） |

### D. 文档 / Vue（需对拍）

| 面 | 说明 | 建议 |
|----|------|------|
| Spec「旧分块」对照表 | `resolve-ambiguous-section-preview-design.md` § Relationship | 退役完成后改为 Deprecated → Removed |
| Vue `section` / picker | 外部 Vue 仓 OperationDialog 等 | 读 `region_*` 优先（已有方向）；写回勿再只写 section |
| API docs `buttons[].section` | T4 summary | 兼容期双字段 → 只文档 region |

### E. 迁移映射（冻结草案）

| 场景 | 从 | 到 |
|------|----|----|
| 歧义 / inventory 展示 | `section_title` | `region_label`（+ role） |
| 同名按钮 xpath 消歧 | 仅 `sectionAnchor*` | titlebox → page-state → section 锚（实现可共用，**产品名统一 region/锚**） |
| `click_save(section=)` | 旧 section 字符串 | 兼容期内：section 或 region_label 归一；新代码只传一种 |
| Phase sticky / pending 分节 | `_phase_section` | 同标题字符串，来源改为 L1 扫描记忆 |
| 壳层 menu | 旧分块忽略 | 已由 L1 覆盖 — 无回归动作 |

### F. 本刀下一步（实现）

1. ~~盘点~~（本表）  
2. resolve/inventory：**断言不再 fallback 到仅 sectionOf 做 picker 文案**（若仍有）  
3. `scan_editable_summary` / TaskList：输出 `region_label`（section 只读别名）  
4. 再开子刀：删 `sectionOf` 独立产品语义 / 参数改名  

**不删：** dual-save / wizard / page-state 已验证 xpath 形状（可换函数名，不可丢验收）。
