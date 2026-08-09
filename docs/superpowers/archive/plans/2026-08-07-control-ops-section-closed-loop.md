# Control ops 闭环（分块 + xpath 写全种类）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在当前 container 内，扫描带分块的可见可编辑控件（含 el-table 种类对齐）与按钮；字段 xpath-first 写全种类；`click_save` 按分块消歧同名按钮；扫描/助手摘要按 section 分组给模型。

**Architecture:** 在已落地的 control-first（Source A/B + xpath_smart）上扩展：模型加 `section_*`；扫描挂分块 + Source B 种类对齐 + `buttons[]`；新增 date/radio/checkbox 的 xpath 写助手；重写 `JS_CLICK_SAVE_BUTTON` 支持 `section`；Python 组装 `sections` / `ambiguous_buttons` 摘要。

**Tech Stack:** Python 3 agent（`scripts/actions`）、`_js_snippets.py` JS 字符串、Pydantic models、characterization、可选 CDP 9242 E2E。

**Spec:** `docs/superpowers/archive/specs/2026-08-07-control-ops-section-closed-loop-design.md`  
**E2E 基线:** `.superpowers/sdd/cdp-e2e-sections.json`（评级申请页 6 个 collapse、双「保存」、测算表 input/select）

## 分层总览（LV）

| 层 | 中文名 | 交付物 | 对应 Task |
|----|--------|--------|-----------|
| **L1** | 数据模型 | `section_id` / `section_title` 上字段与任务项；扫描结果 `buttons[]` | Task 1 |
| **L2** | 扫描发现 | 分块附着 + Source B 种类对齐 + 可见按钮清单 | Task 2 |
| **L3** | 字段写入 | date / radio / checkbox xpath-first（input/select 已有） | Task 3 |
| **L4** | 按钮消歧 | `click_save(button_text, section)` 分块内点击；多命中不盲点 | Task 4 |
| **L5** | 模型摘要 | `sections[]` + `ambiguous_buttons` 进 scan / assistant 返回 | Task 5 |
| **L6** | 文档验收 | CHANGELOG + 表征全绿；可选 CDP 冒烟 | Task 6 |

```
L1 模型 ──► L2 扫描(分块/种类/按钮) ──► L5 摘要
                │                        ▲
                ├──► L3 字段 xpath 写 ────┤
                └──► L4 click_save ───────┘
                              │
                              ▼
                           L6 CHANGELOG / E2E
```

## Global Constraints

- 操作闭环；**不改**对外 action 名（仍 `fill_form_field` / `scan_form_fields` / `click_save`）。
- 范围：当前 `JS_GET_CONTAINER` 内；不分整页。
- 字段去重键：相对 `xpath_smart`；`section_*` 仅展示/消歧，不进指纹（v1）。
- `fields[]` 不含按钮；按钮在 `buttons[]` + `sections[].buttons`。
- `click_save`：**无 section 且 ≥2 同名可见匹配 → 不点击**，返回候选。
- 不硬编码「暂存」=「保存」；用 `button_text='暂存'` + `section`。
- 不做：action 改名、非 el-table 网格、空行首表格 radio 命名补全；整页 **α 业务控件**清单 → **T4**（非本计划）。
- TDD：表征先红后绿；`docs/` gitignore，只提交 `scripts/` / `CHANGELOG.md` 等（用户要求时再 commit）。

## File map

| File | Role |
|------|------|
| `scripts/models/field.py` | `ScannedField.section_*`；`FormScanResult.buttons` / 可选 sections 辅助 |
| `scripts/models/task.py` | `TaskItem.section_*` 透传（可选，便于摘要） |
| `scripts/actions/_js_snippets.py` | sectionOf；Source B radio/date/checkbox；buttons；xpath date/radio；click_save(section) |
| `scripts/actions/_form.py` | 解析 buttons；摘要组装；xpath date/radio；`click_save(..., section='')` |
| `scripts/characterization/characterize-control-ops-closed-loop.py` | 新建表征门禁 |
| `CHANGELOG.md` | Unreleased 条目 |

---

### Task 1（L1）：模型 — `section_*` + 扫描结果 `buttons`

**Files:**
- Modify: `scripts/models/field.py`
- Modify: `scripts/models/task.py`（`TaskItem` 增加同名字段并 `from_scanned` 拷贝）
- Test: `scripts/characterization/characterize-control-ops-closed-loop.py`（创建）

**Interfaces:**
- Produces: `ScannedField.section_id: str = ""`, `section_title: str = ""`；`TaskItem` 同字段；`FormScanResult.buttons: list[ScannedButton]` 或等价 `list[dict]` 模型
- Consumes: 现有 `xpath_smart`

- [ ] **Step 1: 写失败表征**

创建 `scripts/characterization/characterize-control-ops-closed-loop.py`：

```python
#!/usr/bin/env python3
"""Characterize control-ops closed loop (section + buttons + save scope)."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.models.field import ScannedField, FormScanResult


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_models_section() -> None:
    f = ScannedField(
        label="资产负债率",
        xpath_smart="//tr[.//*[normalize-space()='资产负债率']]//input",
        section_id="评级等级测算",
        section_title="评级等级测算",
    )
    assert_true(f.section_title == "评级等级测算", "ScannedField.section_title")
    assert_true(hasattr(FormScanResult, "model_fields") and "buttons" in FormScanResult.model_fields,
                "FormScanResult.buttons")


def main() -> int:
    test_models_section()
    print("characterize-control-ops-closed-loop models: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: 跑表征 — 期望 FAIL**

Run: `python scripts/characterization/characterize-control-ops-closed-loop.py`  
Expected: FAIL（无 `section_title` / 无 `buttons`）

- [ ] **Step 3: 改模型**

在 `ScannedField` 增加：

```python
section_id: str = Field(default="", description="Stable section key")
section_title: str = Field(default="", description="Readable section title")
```

新增（同文件或紧邻）：

```python
class ScannedButton(BaseModel):
    label: str = ""
    xpath_smart: str = ""
    section_id: str = ""
    section_title: str = ""
    disabled: bool = False
```

`FormScanResult.buttons: list[ScannedButton] = Field(default_factory=list)`

`TaskItem`：同样加 `section_id` / `section_title`，`from_scanned` 从 dict 拷贝。

- [ ] **Step 4: 跑表征 — 期望 PASS**

- [ ] **Step 5: Commit**

```bash
git add scripts/models/field.py scripts/models/task.py scripts/characterization/characterize-control-ops-closed-loop.py
git commit -m "feat(models): section_* on scanned fields and scan buttons list"
```

---

### Task 2（L2）：扫描 — 分块附着 + Source B 种类 + buttons

**Files:**
- Modify: `scripts/actions/_js_snippets.py`（`JS_SCAN_FORM_FIELDS`）
- Modify: `scripts/actions/_form.py`（解析 `buttons` 进 store / 不进 TaskList pending）
- Test: 扩展 `characterize-control-ops-closed-loop.py` cue 测试

**Interfaces:**
- Consumes: Task 1 字段名
- Produces: 每个 field/button 带 `section_id`/`section_title`；Source B 可产出 `date`/`radio`/`checkbox`；返回 JSON 含 `buttons: []`

- [ ] **Step 1: 表征 cues（先红）**

在表征文件追加：

```python
def test_js_scan_section_and_source_b_kinds() -> None:
    js = (ROOT / "scripts/actions/_js_snippets.py").read_text(encoding="utf-8")
    assert_true("sectionOf" in js or "SECTION_ATTACH" in js, "section attach helper")
    assert_true("SCAN_SOURCE_C_BUTTONS" in js, "buttons source marker")
    # Source B must collect radio groups (not only skip input[type=radio])
    assert_true("el-radio" in js and "SCAN_SOURCE_B" in js, "table radio collection cues")
```

Run 期望 FAIL（缺 marker / sectionOf）。

- [ ] **Step 2: 在 `JS_SCAN_FORM_FIELDS` 内实现 `sectionOf(el)`**

逻辑（写入 snippets，靠近 scan 顶部 helpers）：

```javascript
const sectionOf = (el) => {
  const collapse = el.closest && el.closest('.el-collapse-item');
  if (collapse) {
    const header = collapse.querySelector('.el-collapse-item__header');
    let title = (header && (header.innerText || header.textContent) || '').replace(/\s+/g, ' ').trim();
    title = title.slice(0, 40);
    const id = title || '__collapse__';
    return { section_id: id, section_title: title };
  }
  // tab pane → matching tab label; el-card header; else __root__
  const pane = el.closest && el.closest('.el-tab-pane');
  if (pane) { /* resolve tab label; fallback __root__ */ }
  const card = el.closest && el.closest('.el-card');
  if (card) {
    const h = card.querySelector('.el-card__header');
    const title = (h && (h.innerText || '') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (title) return { section_id: title, section_title: title };
  }
  return { section_id: '__root__', section_title: '' };
};
```

对 Source A / B 每条 `pushField` 前：`Object.assign(field, sectionOf(operable || item))`。

同标题冲突：第二次起 `section_id = title + '#' + n`（用 Map 计数）。

- [ ] **Step 3: Source B 种类对齐**

在 `collectTableControls`（或等价处）：

- 收集 `.el-date-editor` → kind `date`（真正 push，不只 classify）
- 收集单元格内 `.el-radio` **组** → 一条 `kind=radio`，`options`=标签文本；xpath 指向组内可点节点
- 收集 `.el-checkbox` 组 → `checkbox`
- 继续排除 pager / hidden / 空行首（无 `rowText` 则 drop，与现规一致）

Marker：保持 `SCAN_SOURCE_B_EL_TABLE`；可加注释 `/* SOURCE_B_KIND_PARITY */`。

- [ ] **Step 4: Source C 按钮**

在 scan 末尾：

```javascript
/* SCAN_SOURCE_C_BUTTONS */
const buttons = [];
const btnSeen = new Set();
for (const el of container.querySelectorAll('button, .el-button')) {
  if (quick && !isVisible(el)) continue;
  if (el.disabled || el.classList.contains('is-disabled')) continue;
  const label = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  if (!label || label.length > 40) continue;
  const sec = sectionOf(el);
  const xpath_smart = /* relative smart xpath for button, reuse existing helpers if any */ '';
  const key = xpath_smart || (sec.section_id + '|' + label);
  if (btnSeen.has(key)) continue;
  btnSeen.add(key);
  buttons.push({ label, xpath_smart, section_id: sec.section_id, section_title: sec.section_title, disabled: false });
}
// return JSON includes buttons alongside fields
```

返回：`JSON.stringify({ container, fields, buttons, notification })`（保持现有字段）。

- [ ] **Step 5: `_form.py` 解析**

`scan_form_fields` / `_rebuild_task_list_from_dom`：读 `buttons`，写入 `case_data_store['_scan_buttons']`；**不要**把 buttons 喂给 `TaskList.from_scan`。

- [ ] **Step 6: 表征 PASS + Commit**

```bash
git add scripts/actions/_js_snippets.py scripts/actions/_form.py scripts/characterization/characterize-control-ops-closed-loop.py
git commit -m "feat(scan): section attach, Source B kind parity, buttons inventory"
```

---

### Task 3（L3）：字段写入 — date / radio / checkbox xpath-first

**Files:**
- Modify: `scripts/actions/_js_snippets.py` — 新增 `JS_FILL_DATE_BY_XPATH`、`JS_CLICK_RADIO_BY_XPATH`（checkbox 同理或共用）
- Modify: `scripts/actions/_form.py` — `fill_date_field` / `click_radio` / checkbox 路径；`_execute_round` 分支
- Test: 扩展表征（snippets 导出名 + `_form.py` 调用 cues）

**Interfaces:**
- Consumes: `xpath_smart` on task/scan
- Produces: 与 `JS_FILL_BY_XPATH` 同风格的 evaluate 字符串；助手 round 对 date/radio 走 xpath

- [ ] **Step 1: 失败表征**

```python
def test_xpath_date_radio_helpers() -> None:
    from scripts.actions import _js_snippets as sn
    assert_true(hasattr(sn, "JS_FILL_DATE_BY_XPATH"), "JS_FILL_DATE_BY_XPATH")
    assert_true(hasattr(sn, "JS_CLICK_RADIO_BY_XPATH"), "JS_CLICK_RADIO_BY_XPATH")
    form = (ROOT / "scripts/actions/_form.py").read_text(encoding="utf-8")
    assert_true("JS_FILL_DATE_BY_XPATH" in form, "fill_date uses xpath helper")
    assert_true("JS_CLICK_RADIO_BY_XPATH" in form, "click_radio uses xpath helper")
```

- [ ] **Step 2: 实现 helpers（最小可用）**

`JS_FILL_DATE_BY_XPATH`：`document.evaluate(xpath)` → 找 date input → native setter + input/change（对齐现有 `JS_FILL_DATE_FIELD` 写值部分，但定位用 xpath）。

`JS_CLICK_RADIO_BY_XPATH`：xpath 解析到 radio 组或触发器 → 按 `option` 文本点 `.el-radio`。

- [ ] **Step 3: 接线 `_form.py`**

- `fill_date_field`：若 `_task_xpath_smart(...)` 非空 → `JS_FILL_DATE_BY_XPATH`，否则旧 label 路径。
- `click_radio`：同上。
- `_execute_round`：`kind == 'date'|'radio'|'checkbox'` 时优先 xpath helpers。

- [ ] **Step 4: PASS + Commit**

```bash
git commit -m "feat(form): xpath-first date/radio/checkbox fill"
```

---

### Task 4（L4）：`click_save` 分块消歧

**Files:**
- Modify: `scripts/actions/_js_snippets.py` — `JS_CLICK_SAVE_BUTTON` 改为 `([buttonText, section])` 或对象参数
- Modify: `scripts/actions/_form.py` — `click_save(button_text='保存', section='')`
- Test: 表征 + 可选纯函数测「多候选不点击」逻辑（可用小型 JS 片段单元或 Python 侧解析返回 JSON）

**Interfaces:**
- Consumes: scan `section_title` / `section_id` 字符串匹配（规范化空白）
- Produces: 成功 JSON `{ok, text, section, xpath}`；失败 `{ok:false, reason:'ambiguous'|'not-found', candidates:[{section_title,text}]}`

- [ ] **Step 1: 失败表征**

```python
def test_click_save_section_api() -> None:
    js = (ROOT / "scripts/actions/_js_snippets.py").read_text(encoding="utf-8")
    assert_true("ambiguous" in js or "candidates" in js, "save returns candidates when ambiguous")
    form = (ROOT / "scripts/actions/_form.py").read_text(encoding="utf-8")
    assert_true("section" in form and "click_save" in form, "click_save accepts section")
    # Exact 暂存 must not be rejected when needle is 暂存
    assert_true("rejectRe" in js, "rejectRe still present for non-exact noise")
```

- [ ] **Step 2: 重写点击逻辑（规范顺序）**

伪代码写入 `JS_CLICK_SAVE_BUTTON`：

```javascript
([buttonText, section]) => {
  const needle = String(buttonText || '保存').trim() || '保存';
  const wantSec = String(section || '').trim();
  // collect visible matching buttons with sectionOf(el)
  const matches = [...];
  const filtered = wantSec
    ? matches.filter(m => m.section_id === wantSec || m.section_title === wantSec)
    : matches;
  if (filtered.length === 0) return JSON.stringify({ ok:false, reason:'not-found', needle, section: wantSec, candidates: matches.map(...) });
  if (!wantSec && filtered.length > 1) return JSON.stringify({ ok:false, reason:'ambiguous', candidates: filtered.map(...) });
  // click the single filtered[0] (or best score within filtered)
  ...
}
```

注意：现有 `rejectRe` 含「暂存」——仅当 `text !== needle` 时拒绝；`needle==='暂存'` 必须可点。

- [ ] **Step 3: Python `click_save`**

```python
async def click_save(button_text: str = '保存', section: str = ''):
    ...
    raw = await page.evaluate(JS_CLICK_SAVE_BUTTON, [button_text or '保存', section or ''])
    # if ambiguous: return err string with candidates for the agent — do not proceed to outcome scan
```

- [ ] **Step 4: PASS + Commit**

```bash
git commit -m "fix(form): scope click_save by section; refuse ambiguous multi-save"
```

---

### Task 5（L5）：模型摘要 — `sections` + `ambiguous_buttons`

**Files:**
- Modify: `scripts/actions/_form.py` — `_build_section_summary(fields, buttons) -> dict`
- 接线：`scan_form_fields` 返回 JSON、`run_form_assistant` 完成摘要附带 sections
- Test: 表征用纯 Python 构造 fields/buttons 断言分组

**Interfaces:**
- Consumes: `_scan_fields` + `_scan_buttons`
- Produces: 与 spec 一致的 summary 形状

- [ ] **Step 1: 表征**

```python
def test_section_summary_shape() -> None:
    from scripts.actions._form import _build_section_summary  # export helper
    fields = [
        {"label": "资产负债率", "disabled": False, "section_id": "评级等级测算", "section_title": "评级等级测算"},
        {"label": "评级", "disabled": False, "section_id": "系统评级结论", "section_title": "系统评级结论"},
    ]
    buttons = [
        {"label": "暂存", "section_id": "评级等级测算", "section_title": "评级等级测算"},
        {"label": "保存", "section_id": "系统评级结论", "section_title": "系统评级结论"},
        {"label": "保存", "section_id": "客户综合评价", "section_title": "客户综合评价"},
    ]
    s = _build_section_summary(fields, buttons, pending_labels={"资产负债率", "评级"})
    assert_true(any(x["section_title"] == "评级等级测算" for x in s["sections"]), "测算 section")
    amb = s.get("ambiguous_buttons") or []
    assert_true(any(a["text"] == "保存" and len(a["sections"]) >= 2 for a in amb), "ambiguous 保存")
```

先导出 `_build_section_summary`（若现为闭包内函数则提到模块级）。

- [ ] **Step 2: 实现分组**

按 `section_id` 聚合；`fields_sample` 取最多 5 个 label；`ambiguous_buttons`：同一 `label` 出现在 ≥2 个不同 `section_id`。

- [ ] **Step 3: 合并进 scan / assistant 返回**（保持摘要体积可控）

- [ ] **Step 4: PASS + Commit**

```bash
git commit -m "feat(form): section-grouped scan summary and ambiguous_buttons"
```

---

### Task 6（L6）：CHANGELOG + 回归表征 + 可选 CDP

**Files:**
- Modify: `CHANGELOG.md`
- Run: 相关 characterize 脚本
- Optional: CDP 9242 冒烟（不阻塞 commit）

- [ ] **Step 1: CHANGELOG `[Unreleased]`**

Changed / Fixed 条目说明：

- 扫描挂 `section_*`；Source B 对齐 date/radio/checkbox；返回 `buttons` / `sections` / `ambiguous_buttons`
- 字段 date/radio/checkbox xpath-first
- `click_save(..., section=)`；多「保存」无 section 不盲点  
注明：scripts 侧变更；Python 控制面无 schema 强制同步（若仅 scripts，按 AGENTS 可不写——但本仓惯例对行为变更写简短 Unreleased）。

- [ ] **Step 2: 跑表征**

```bash
python scripts/characterization/characterize-control-ops-closed-loop.py
python scripts/characterization/characterize-form-scan-control-first.py
python scripts/characterization/characterize-form-assistant.py
python scripts/characterization/characterize-xpath-fill-select.py
```

Expected: 全部 OK

- [ ] **Step 3（可选 CDP）:** 复用 9242，对评级页验证：

1. evaluate `JS_SCAN_FORM_FIELDS` → 测算块 fields ≫ 3；`buttons` 含两处「保存」不同 section  
2. `click_save('保存','')` → `ambiguous`  
3. `click_save('保存','系统评级结论')` → ok  

- [ ] **Step 4: Commit CHANGELOG**

```bash
git commit -m "docs: CHANGELOG for control-ops section closed loop"
```

- [ ] **Step 5: 更新 spec Status → Implemented**（本地 `docs/`，不提交）

---

## Spec coverage（自检）

| Spec 要求 | Task |
|-----------|------|
| section_* 数据模型 | T1 |
| Source B 种类对齐 | T2 |
| buttons[] 与 fields 分离 | T1+T2 |
| 分块附着规则 | T2 |
| date/radio/checkbox xpath 写 | T3 |
| click_save section / ambiguous | T4 |
| sections + ambiguous_buttons 摘要 | T5 |
| CDP/表征验收 | T6 |
| 非目标（改名/整页/空行命名） | 未实现（正确） |

## Placeholder / 一致性

- 无 TBD；`sectionOf` / `JS_*_BY_XPATH` / `_build_section_summary` 命名在 Tasks 间一致。
- `click_save` 参数名统一 `section`（匹配 `section_id` 或 `section_title`）。
