# 同表单项多控件扫描分发与保存否定句 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同一 `.el-form-item` 里同类控件不少于两个时，扫描按控件拆条；填写/选择必须带 `xpath_smart`，否则报 `err-ambiguous-field-slot`；任务里的「不点保存」不再签成必须 `click_save`。

**Architecture:** 叶子枚举放进已有的 `page-locator-helpers.js`（与 `formFieldXpathSmartOf` / `fieldSlotLetter` 同作用域），扫描 Phase 1 改为逐条 `pushField`。分发用纯函数 `resolve_same_family_target` 决定写哪一枚，再接到 `fill_engine` / `select_engine`。保存终态在 `_has_save_terminal` 里先剥掉否定句，评审超时单独打 `phase_reviewer timeout`。

**Tech Stack:** 浏览器内 JS（`PAGE_LOCATOR_HELPERS`）、Python 录制引擎、Node characterization（Playwright）、Python characterization、`verify-all.sh` 域注册。

## Global Constraints

- `label` 仍是「保证金比例」，不把槽位拼进 `label_text`。
- 槽位按同类编号：输入 A/B，下拉 A/B。类的划分与 2026-09-16 设计一致（输入不含 `.el-select` 内的 input；下拉含包在 `.tssc-multi-select` 里的 `.el-select`）。
- 只有一个同类叶子的表单项保持一条字段，不带 `field_slot`，不带 `display_label`。
- 只传标签且该类多于一个：返回 `err-ambiguous-field-slot`，列出每个槽位的 `field_slot` 与 `xpath_smart`，不写入，不按调用次数往后排。
- 带了非空 `xpath_smart` 时只操作那一个控件。输入框不得因为兄弟是 Tssc 下拉而返回 `err-use-tssc-multi-select`。
- 禁用判断看被定位到的那一个控件，不看同一表单项里的兄弟。
- 否定句（`不点` / `不要` / `勿点` / `禁止` / `禁止点击`，可夹引号）里的「保存」「提交」「确认」「确定」不算终态。同一段里还有肯定句（`点击保存`、`保存成功`、`保存后`、`并保存` 等）时，肯定优先。
- 评审超时日志必须是 `phase_reviewer timeout`。
- 不改历史轨迹，不改模型 500，不改 10 分钟空闲看门狗，不处理跨表单项的同名标签。
- 禁止手改 `scripts/controller/actions/js_snippets/_locator_helpers_js.py`；改 `src/cdp/page-locator-helpers.js` 后跑 `node scripts/_gen_locator_helpers_py.mjs`。

---

### Task 1: 扫描按控件拆条

**Files:**
- Modify: `src/cdp/page-locator-helpers.js`（`fieldSlotLetter` 之后插入 `listFormItemScanFields`）
- Modify: `scripts/controller/actions/js_snippets/scan_form.py`（约 364–390 行，Phase 1 每个 `.el-form-item` 只 `pushField` 一次的循环）
- Generate: `scripts/controller/actions/js_snippets/_locator_helpers_js.py`（只通过生成脚本）
- Create: `scripts/characterization/cold/characterize-same-family-scan.mjs`
- Modify: `scripts/refactor/verify-all.sh`（`PINS_FORM` 里紧挨 `characterize-form-field-intra-slot` 加一行）

**Interfaces:**
- Consumes: 页内已有的 `formFieldXpathSmartOf(node, formLabel)`、`fieldSlotLetter(n)`、`normalizeControlText`。
- Produces: `listFormItemScanFields(item) -> Array<{label, kind, field_slot, display_label, xpath_smart}>`。`kind` 为 `input` 或 `tssc-multi-select` 或 `select`。单控件项返回长度 1 且 `field_slot` 为 `''`。

- [ ] **Step 1: 写会失败的扫描测试**

创建 `scripts/characterization/cold/characterize-same-family-scan.mjs`。夹具 HTML 复制 `characterize-form-field-intra-slot.mjs` 里的「保证金比例」四控件加「业务产品编号」单输入。在页面里注入 `PAGE_LOCATOR_HELPERS` 后执行：

```javascript
const item = document.getElementById('ratio-item');
const rows = listFormItemScanFields(item);
```

断言：

- `rows.length === 4`
- `rows.map(r => r.kind)` 为 `['input', 'tssc-multi-select', 'tssc-multi-select', 'input']`
- `rows.map(r => r.field_slot)` 为 `['A', 'A', 'B', 'B']`
- 每条 `label === '保证金比例'`
- `rows[0].display_label === '保证金比例-A'`
- 四条 `xpath_smart` 互不相同，且各自 `document.evaluate` 只命中 1 个节点
- `rows[0]` 命中 `#in-a`，`rows[3]` 命中 `#in-b`
- 单控件 `#single-item`：长度 1，`field_slot === ''`，`kind === 'input'`，没有 `display_label` 或为空

- [ ] **Step 2: 跑测试，确认失败**

Run: `node scripts/characterization/cold/characterize-same-family-scan.mjs`  
Expected: FAIL，`listFormItemScanFields is not defined`

- [ ] **Step 3: 实现 `listFormItemScanFields` 并接到扫描**

在 `page-locator-helpers.js` 的 `fieldSlotLetter` 之后加入函数。叶子收集规则：

- 输入：`.el-form-item__content input:not([type="hidden"])`，且 `!el.closest('.el-select')`
- 下拉：`.el-form-item__content .el-select`，跳过 `.el-select-dropdown` 里的节点
- 下拉的 kind：`closest('.tssc-multi-select')` 则为 `tssc-multi-select`，否则 `select`
- 同类计数 `< 2` 的类不带 `field_slot`；`>= 2` 时用 `fieldSlotLetter(index+1)`
- `xpath_smart` 调用 `formFieldXpathSmartOf(leaf, label)`

`scan_form.py` Phase 1 在现有「一条 field」之前：

```javascript
const split = (typeof listFormItemScanFields === 'function')
    ? listFormItemScanFields(item) : null;
if (split && split.length) {
    for (const row of split) {
        const field = {
            label: row.label,
            kind: row.kind,
            currentValue: '',
            options: [],
            placeholder: row.placeholder || '',
            required: false,
            disabled: !!row.disabled,
            selected: false,
            hasButton: '',
            xpath_smart: row.xpath_smart || '',
            field_slot: row.field_slot || '',
            display_label: row.display_label || '',
        };
        pushField(field);
    }
    continue;
}
```

`listFormItemScanFields` 的 `disabled` 只看该叶子（`.is-disabled` 或该叶子上的 `input.disabled`），不把整个 form-item 交给 `isDisabled`。

然后：

```bash
node scripts/_gen_locator_helpers_py.mjs
```

- [ ] **Step 4: 测试通过并登记**

Run: `node scripts/characterization/cold/characterize-same-family-scan.mjs`  
Expected: 全部断言通过，进程退出码 0

在 `scripts/refactor/verify-all.sh` 的 `characterize-form-field-intra-slot` 下一行加入：

```
characterize-same-family-scan|node scripts/characterization/cold/characterize-same-family-scan.mjs
```

- [ ] **Step 5: Commit**

```bash
git add src/cdp/page-locator-helpers.js scripts/controller/actions/js_snippets/scan_form.py scripts/controller/actions/js_snippets/_locator_helpers_js.py scripts/characterization/cold/characterize-same-family-scan.mjs scripts/refactor/verify-all.sh
git commit -m "feat(scan): 同表单项同类控件按叶子拆条"
```

---

### Task 2: 填写和选择按定位分发

**Files:**
- Create: `scripts/controller/actions/same_family.py`
- Modify: `scripts/controller/actions/fill_engine.py`（`err-use-tssc-multi-select` 返回之前，约 241 行）
- Modify: `scripts/controller/actions/select_engine.py`（`_select_option_impl` 在 `resolve_select_dispatch` 之前）
- Create: `scripts/characterization/characterize-same-family-resolve.py`
- Modify: `scripts/refactor/verify-all.sh`（`PINS_FORM` 里紧挨 Task 1 的扫描 pin）

**Interfaces:**
- Consumes: Task 1 写入 `_scan_fields` 的 `label`、`kind`、`field_slot`、`xpath_smart`。
- Produces:

```python
def resolve_same_family_target(fields: list, *, label: str, xpath_smart: str, action: str) -> dict:
    """action 为 'fill' 或 'select'。
    成功: {'ok': True, 'xpath_smart': str, 'field_slot': str, 'kind': str}
    歧义: {'ok': False, 'error': 'err-ambiguous-field-slot', 'candidates': [{'field_slot', 'xpath_smart', 'kind'}, ...]}
    不相关: {'ok': True, 'xpath_smart': xpath_smart, 'field_slot': '', 'kind': ''}
    """
```

`fill` 只在 `kind == 'input'` 的同标签条目里选。`select` 只在 `kind` 为 `select` 或 `tssc-multi-select` 的同标签条目里选。

- [ ] **Step 1: 写会失败的纯函数测试**

`scripts/characterization/characterize-same-family-resolve.py`：

```python
fields = [
    {'label': '保证金比例', 'kind': 'input', 'field_slot': 'A', 'xpath_smart': '(//input)[1]'},
    {'label': '保证金比例', 'kind': 'tssc-multi-select', 'field_slot': 'A', 'xpath_smart': '(//select)[1]'},
    {'label': '保证金比例', 'kind': 'tssc-multi-select', 'field_slot': 'B', 'xpath_smart': '(//select)[2]'},
    {'label': '保证金比例', 'kind': 'input', 'field_slot': 'B', 'xpath_smart': '(//input)[2]'},
    {'label': '业务产品编号', 'kind': 'input', 'field_slot': '', 'xpath_smart': '//input[@id="biz"]'},
]
```

断言：

- `resolve_same_family_target(fields, label='保证金比例', xpath_smart='(//input)[1]', action='fill')['kind'] == 'input'`
- 同一调用 `action='select'` 且 xpath 是 `(//select)[1]` 时 `field_slot == 'A'`
- `xpath_smart=''` 且 `action='fill'` 时 `ok` 为假，`error == 'err-ambiguous-field-slot'`，`candidates` 长度为 2
- `label='业务产品编号'`、`xpath_smart=''`、`action='fill'` 时 `ok` 为真且 `xpath_smart == '//input[@id="biz"]'`
- 传入的 `xpath_smart` 不在列表中时 `ok` 为假，`error == 'err-ambiguous-field-slot'`

- [ ] **Step 2: 跑测试，确认失败**

Run: `python scripts/characterization/characterize-same-family-resolve.py`  
若本机没有 `python`，用仓库里实际的解释器（`where.exe python` / `py -3`）。  
Expected: FAIL，`ModuleNotFoundError` 或 `ImportError: resolve_same_family_target`

- [ ] **Step 3: 实现纯函数并接到两个引擎**

`same_family.py` 按上面的契约实现。标签比较前去掉首尾空白和尾部 `：` / `:`。

`fill_engine.py`：在判定 `kind == 'tssc-multi-select'` 并返回 `err-use-tssc-multi-select` **之前**调用 `resolve_same_family_target`。若 `ok` 为假，用 `err_with` 返回该 `error`，`next_action` 写出候选的 `field_slot` 与 `xpath_smart`。若 `ok` 且解析出的 `kind == 'input'`，把本次填写的目标 xpath 设为解析结果，**不要**再走 tssc 拒绝。若调用自带的 `xpath_smart` 指向 input，即使 store 里同标签的另一条是 `tssc-multi-select`，也按 input 填写。

`select_engine.py` 的 `_select_option_impl`：在 `resolve_select_dispatch` 之前同样调用，`action='select'`。歧义则直接返回 `err-ambiguous-field-slot`，不打开下拉。解析出 xpath 时，用该 xpath 作为后续 tssc/el-select 的目标，禁用检测只针对该节点。

- [ ] **Step 4: 测试通过并登记**

Run: `python scripts/characterization/characterize-same-family-resolve.py`  
Expected: 打印通过并退出码 0

`verify-all.sh` 的 `PINS_FORM` 加入：

```
characterize-same-family-resolve|"$PY" scripts/characterization/characterize-same-family-resolve.py
```

再跑：

```bash
node scripts/characterization/cold/characterize-same-family-scan.mjs
python scripts/characterization/characterize-tssc-route-conflict.py
```

Expected: 都通过。`err-use-tssc-multi-select` 对「整项只有下拉、没有兄弟输入框」的旧用例必须仍然拒绝文本填写。

- [ ] **Step 5: Commit**

```bash
git add scripts/controller/actions/same_family.py scripts/controller/actions/fill_engine.py scripts/controller/actions/select_engine.py scripts/characterization/characterize-same-family-resolve.py scripts/refactor/verify-all.sh
git commit -m "feat(fill): 同标签多控件必须带 xpath，否则报歧义"
```

---

### Task 3: 保存否定句与评审超时日志

**Files:**
- Modify: `scripts/controller/actions/phase/boundary_contract.py`（`_has_save_terminal`，约 82 行）
- Modify: `scripts/controller/actions/phase/reviewer.py`（约 515–517 行的 `except`）
- Modify: `scripts/characterization/cold/characterize-phase-boundary.py`
- Modify: `scripts/characterization/characterize-phase-reviewer.py`（源码针：日志字符串）

**Interfaces:**
- Consumes: 现有 `_SAVE_TERMINAL_RE`、`compile_boundary`。
- Produces: `_has_save_terminal(task_text) -> bool`。否定句剥掉后不再命中时返回 `False`。`compile_boundary('在保证金比例行填写数字。全程不点「保存」。')` 的 `success_when == []` 且 `'save_form' not in goals`。

- [ ] **Step 1: 写会失败的边界测试**

在 `characterize-phase-boundary.py` 增加：

```python
no_save = '在「保证金比例」同一行填写数字 9。全程不点「保存」或「启用」。预期结果：左数字显示 9。'
b_no = compile_boundary(no_save)
assert_true(b_no['success_when'] == [], '不点保存 → 无保存令牌')
assert_true('save_form' not in b_no['goals'], '不点保存 → goals 不含 save_form')

yes_save = '填写保证金比例后点击保存。预期结果：保存成功。'
b_yes = compile_boundary(yes_save)
assert_true('toast_ok' in b_yes['success_when'], '点击保存 → 仍要 toast_ok')
assert_true('save_form' in b_yes['goals'], '点击保存 → goals 含 save_form')

both = '不要点保存。填写后点击保存。'
b_both = compile_boundary(both)
assert_true('save_form' in b_both['goals'], '否定句与肯定句并存时肯定优先')
```

在 `characterize-phase-reviewer.py` 增加源码针：`reviewer.py` 含 `'[phase_reviewer] timeout'`，且 `TimeoutError` 分支早于通用 `except Exception`。

- [ ] **Step 2: 跑测试，确认失败**

Run: `python scripts/characterization/cold/characterize-phase-boundary.py`  
Expected: FAIL，`不点保存 → 无保存令牌`（当前 `success_when` 含 `toast_ok`）

- [ ] **Step 3: 剥掉否定句，并分开超时日志**

在 `_has_save_terminal` 内、调用 `_SAVE_TERMINAL_RE` 之前：

```python
_NEGATED_TERMINAL_RE = re.compile(
    r'(?:不要|不点|勿点|禁止(?:点击)?|勿)\s*[「“"\']?'
    r'(?:保存|提交|确认|确定)'
)

def _has_save_terminal(task_text: str) -> bool:
    raw = task_text or ''
    stripped = _NEGATED_TERMINAL_RE.sub('', raw)
    return bool(_SAVE_TERMINAL_RE.search(stripped))
```

`reviewer.py` 的 `except` 改为：

```python
except asyncio.TimeoutError:
    sys.stderr.write('[phase_reviewer] timeout\n')
    sys.stderr.flush()
    return None
except Exception as e:
    sys.stderr.write(f'[phase_reviewer] failed: {e}\n')
    sys.stderr.flush()
    return None
```

确认文件顶部已 `import asyncio`。没有则补上。

- [ ] **Step 4: 测试通过**

Run:

```bash
python scripts/characterization/cold/characterize-phase-boundary.py
python scripts/characterization/characterize-phase-reviewer.py
python scripts/characterization/characterize-phase-save-cue-promote.py
```

Expected: 三个都通过。`点击保存` 的旧断言不能变红。

- [ ] **Step 5: Commit**

```bash
git add scripts/controller/actions/phase/boundary_contract.py scripts/controller/actions/phase/reviewer.py scripts/characterization/cold/characterize-phase-boundary.py scripts/characterization/characterize-phase-reviewer.py
git commit -m "fix(phase): 不点保存不再签成必须保存"
```

---

## 计划自检

- 规格 §2 扫描四条、单控件不带槽位、xpath 唯一：Task 1。
- 规格 §2.2 带定位才写、歧义不写入、输入框不被 tssc 拒绝、禁用看单控件：Task 2。
- 规格 §3 否定句、肯定优先、超时日志：Task 3。
- 模型 500 与空闲看门狗：没有任务去改它们。
- 湿测留到三任务合并之后，不写进实现步骤。
