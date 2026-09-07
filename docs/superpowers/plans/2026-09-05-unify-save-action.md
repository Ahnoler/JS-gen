# 统一保存动作（click_save 吸收 save_section / click_button('保存')）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保存类操作收敛为唯一入口 `click_save`：吸收 save_section 的分区标题语义定位与 click_button('保存') 的图标 aria-label 匹配能力，save_section 降级为转发别名，click_button 禁止用于保存。

**Architecture:** JS 层给 `JS_CLICK_SAVE_BUTTON` 增加"分区标题→祖先容器"兜底定位（原 save_section 策略）与 aria-label 文本匹配；Python 层 save_section 一行转发到 click_save、click_button 加保存守卫；prompt 层删除三选一规则。落库形态统一为 `click_element_by_index`（带 section），传统引擎导出不再丢步骤；`_replay.py` 无需改动（save_section 注册仍存在，转发后自动走新引擎）。

**Tech Stack:** Python 3（playwright 控制器，`scripts/controller/actions/`）、内嵌 JS snippets、无新增依赖。

## Global Constraints

- 仓库：`D:\dev\JS-gen`（后端，分支 uara-V1.2-stable 或当前 dev 检出分支）
- **不自动 commit**：本项目约定用户明确说"提交"才提交；计划中 commit 步骤仅在实际执行时经用户确认后运行
- 不改动 `JS_SAVE_SECTION` 本体与其 `{ok, clicked, toast}` 返回结构（历史回放依赖 `_replay.py` 通用兜底 + `_result_ok`）
- `click_save` 对外签名不变：`click_save(button_text='保存', section='', region='')`（`section` 是 `region` 的 legacy 别名，`resolve_scope` 已处理）
- 保存 outcome 判定（JS_SCAN_SAVE_OUTCOME 四路）不改；分区兜底定位只解决"找到并点到按钮"，等待/校验仍由 Python 侧 outcome 轮询完成（20×150ms），所以 JS 兜底可以是同步函数
- 每个任务收尾用 `python -m py_compile <file>` 验证语法（仓库无 pytest 测试基建，验证 = 语法检查 + 静态 grep + 录制冒烟，见 Task 6）

---

### Task 1: JS_CLICK_SAVE_BUTTON 增强——分区标题兜底定位 + aria-label 文本匹配

**Files:**
- Modify: `scripts/controller/actions/js_snippets/save.py`（JS_CLICK_SAVE_BUTTON 常量内）

**Interfaces:**
- Produces: `JS_CLICK_SAVE_BUTTON(buttonArg)` 行为变化（签名不变，仍是 `[button_text, section]`）：
  - `btnText(el)` 在元素无可见文本时回退 `aria-label`（吸收 click_button 图标能力）
  - `wantNorm` 非空且扫描候选 `filtered` 为空时，走"分区标题→祖先容器→保存按钮"兜底定位（原 JS_SAVE_SECTION 策略），返回结构与主路径完全一致 `{ok:true, text, section, xpath, tag}`
- Consumes: 无（自包含 JS）

- [ ] **Step 1: 修改 btnText 支持 aria-label 回退**

在 `save.py` 中找到：

```python
  const btnText = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
```

替换为：

```python
  const btnText = (el) => {
    const t = String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (t) return t;
    // 图标按钮：回退 aria-label（由 JS_STAMP_ICON_ARIA_LABELS 预先盖章，见 Task 2）
    return String(el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
  };
```

- [ ] **Step 2: 在 not-found 分支前加入分区标题兜底定位**

在 `save.py` 中找到：

```python
  const filtered = wantNorm ? matches.filter(secMatches) : matches;
  if (filtered.length === 0) {
```

在 `const filtered = ...` 这一行之前插入兜底函数定义（放在 `toCandidate` 定义之后）：

```python
  // 分区标题兜底定位（吸收自 JS_SAVE_SECTION，KB-I5 run11）：扫描块没认出的分区，
  // 按标题原文找元素 → 沿祖先向上找最小含目标按钮的容器 → 容器内取 enabled 按钮。
  const sectionFallback = () => {
    const findSectionTitleEls = (exact) => {
      const hits = [];
      for (const el of document.body.querySelectorAll('*')) {
        if (!isVisible(el)) continue;
        const t = normSec(el.textContent);
        if (!t || t.length > 60) continue;
        if (exact ? t !== wantNorm : t.indexOf(wantNorm) === -1) continue;
        const cls = String(el.className || '');
        const looksTitle = /header|title|tab|caption|legend|label/i.test(cls)
          || el.children.length === 0
          || [...el.children].every((c) => !normSec(c.textContent));
        if (looksTitle) hits.push(el);
      }
      return hits;
    };
    let titleEls = findSectionTitleEls(true);
    if (!titleEls.length) titleEls = findSectionTitleEls(false);
    if (!titleEls.length) return null;
    const btnEnabled = (b) => !(b.disabled || b.getAttribute('aria-disabled') === 'true'
      || /disableBtn|is-disabled/.test(String(b.className || '')));
    const saveBtnIn = (root) => {
      const enabled = [];
      for (const b of root.querySelectorAll('button, a, [role="button"], .el-button')) {
        if (!isVisible(b) || !btnEnabled(b)) continue;
        const t = btnText(b);
        if (t && (t === needle || t.indexOf(needle) !== -1)) enabled.push(b);
      }
      return enabled.length ? enabled[0] : null;
    };
    // 每个标题元素沿祖先上溯 ≤12 层，取"标题→按钮"层级最小（最贴合分区）的命中
    let bestBtn = null, bestTitle = '', bestDepth = Infinity;
    for (const tEl of titleEls) {
      let p = tEl, depth = 0;
      while (p && depth < 12) {
        const hit = saveBtnIn(p);
        if (hit) {
          if (depth < bestDepth) {
            bestBtn = hit; bestTitle = normSec(tEl.textContent); bestDepth = depth;
          }
          break;
        }
        p = p.parentElement; depth++;
      }
    }
    if (!bestBtn) return null;
    return { el: bestBtn, text: btnText(bestBtn), section: bestTitle };
  };
```

然后把原 not-found 分支：

```python
  const filtered = wantNorm ? matches.filter(secMatches) : matches;
  if (filtered.length === 0) {
    return JSON.stringify({
      ok: false,
      reason: 'not-found',
      needle,
      section: wantSec,
      candidates: matches.map(toCandidate),
    });
  }
```

替换为：

```python
  const filtered = wantNorm ? matches.filter(secMatches) : matches;
  if (filtered.length === 0) {
    // 兜底：分区标题→祖先容器定位（仅 wantNorm 时启用）
    if (wantNorm) {
      const fb = sectionFallback();
      if (fb) {
        try { fb.el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (e) {}
        fb.el.click();
        return JSON.stringify({
          ok: true,
          text: fb.text,
          section: fb.section,
          xpath: absXPath(fb.el),
          tag: (fb.el.tagName || '').toLowerCase(),
          via: 'section-title-fallback',
        });
      }
    }
    return JSON.stringify({
      ok: false,
      reason: 'not-found',
      needle,
      section: wantSec,
      candidates: matches.map(toCandidate),
    });
  }
```

- [ ] **Step 3: 语法验证**

Run: `python -m py_compile scripts/controller/actions/js_snippets/save.py`
Expected: 无输出（编译通过）。另用 `node -e` 抽查 JS 括号配平：

```bash
node -e "const s=require('fs').readFileSync('scripts/controller/actions/js_snippets/save.py','utf8');const m=s.match(/JS_CLICK_SAVE_BUTTON = r'''(.*?)'''/s);new Function(m[1]);console.log('JS-OK')"
```

Expected: `JS-OK`

- [ ] **Step 4: 用户确认后 commit**

```bash
git add scripts/controller/actions/js_snippets/save.py
git commit -m "feat(save): JS_CLICK_SAVE_BUTTON 分区标题兜底定位 + 图标 aria-label 匹配"
```

---

### Task 2: form_save.py 点击前盖章图标 aria-label

**Files:**
- Modify: `scripts/controller/actions/form_save.py`（click_save 内、`JS_CLICK_SAVE_BUTTON` evaluate 之前，约 :180-186）

**Interfaces:**
- Consumes: `JS_STAMP_ICON_ARIA_LABELS`（已由 `scripts/controller/actions/_js_snippets.py:32` 从 `js_snippets/icons.py` 导出）
- Produces: 无新接口；使 Task 1 的 aria-label 回退在 click_save 链路生效

- [ ] **Step 1: 加 import**

在 `form_save.py` 顶部现有 import 块（第 20 行附近，从 `_js_snippets` 导入处）追加 `JS_STAMP_ICON_ARIA_LABELS`：

```python
from ._js_snippets import (
    JS_CLICK_SAVE_BUTTON, JS_SCAN_SAVE_OUTCOME, JS_WATCH_SAVE_NOTIFICATIONS,
    JS_STAMP_ICON_ARIA_LABELS,
)
```

（保持与文件现有 import 括号风格一致，逐行确认原文件再改。）

- [ ] **Step 2: 在 `page.evaluate(JS_CLICK_SAVE_BUTTON, ...)` 之前插入盖章调用**

定位 `form_save.py:183` 附近：

```python
        raw = await page.evaluate(JS_CLICK_SAVE_BUTTON, [button_text or '保存', sec])
```

改为：

```python
        # 图标保存按钮：先盖 aria-label（click_button 同款），btnText 才能回退到图标标签
        try:
            await page.evaluate(JS_STAMP_ICON_ARIA_LABELS)
        except Exception:
            sys.stderr.write("[click_save] JS_STAMP_ICON_ARIA_LABELS failed (pre-click)\n")
            sys.stderr.flush()
        raw = await page.evaluate(JS_CLICK_SAVE_BUTTON, [button_text or '保存', sec])
```

- [ ] **Step 3: 语法验证**

Run: `python -m py_compile scripts/controller/actions/form_save.py`
Expected: 无输出

- [ ] **Step 4: 用户确认后 commit**

```bash
git add scripts/controller/actions/form_save.py
git commit -m "feat(save): click_save 点击前盖章图标 aria-label，支持图标保存按钮"
```

---

### Task 3: save_section 转发 click_save（保留注册名，历史回放不断）

**Files:**
- Modify: `scripts/controller/actions/_form.py:196-220`（save_section 注册块）

**Interfaces:**
- Consumes: 同文件已有的 `_save_engine`（`form_save.SaveEngine` 实例，第 148 行 `click_save` 委托即用它）
- Produces: `save_section(section_title)` 返回值 = `click_save('保存', section_title, '')` 的返回；`_record_action('save_section', ...)` 不再由本动作执行（click_save 内部自会落 `click_element_by_index` 步骤）

- [ ] **Step 1: 替换 save_section 函数体**

定位 `_form.py`：

```python
    async def save_section(section_title: str):
        page = await browser_context.get_current_page()
        result = await page.evaluate(JS_SAVE_SECTION, [section_title])
        # JS side already waits 2.5s for the save round-trip; small settle buffer.
        await page.wait_for_timeout(300)
        ok, payload = _workspace_result(result)
        if ok:
            _record_action('save_section', {'section_title': section_title}, payload)
            return _ok(payload)
        return payload
```

替换为：

```python
    async def save_section(section_title: str):
        # Legacy alias：转发到 click_save 统一引擎（分区标题走 region 语义定位 +
        # outcome 四路判定 + 落库为可导出的 click_element_by_index 步骤）。
        # JS_SAVE_SECTION 本体保留：_replay.py 历史步骤仍按原动作名直接执行它。
        return await _save_engine.click_save('保存', section_title, '')
```

- [ ] **Step 2: 清理残留 import（若 JS_SAVE_SECTION 不再被 _form.py 使用）**

Run: `grep -n "JS_SAVE_SECTION" scripts/controller/actions/_form.py scripts/controller/actions/_js_snippets.py`
若 `_form.py` 仅剩 import 行无使用处：从 `_form.py` 的 import 中删掉 `JS_SAVE_SECTION`（保留 `_js_snippets.py` 的 re-export，`js_snippets/save_section.py` 本体不动）。

- [ ] **Step 3: 语法验证 + 静态检查**

Run: `python -m py_compile scripts/controller/actions/_form.py && grep -n "save_section" scripts/controller/actions/_form.py`
Expected: 编译通过；save_section 仍被注册（函数名不变），函数体为单行转发

- [ ] **Step 4: 用户确认后 commit**

```bash
git add scripts/controller/actions/_form.py
git commit -m "refactor(save): save_section 降级为 click_save 转发别名"
```

---

### Task 4: click_button 保存守卫

**Files:**
- Modify: `scripts/controller/actions/_misc.py:388`（click_button 函数体开头）

**Interfaces:**
- Consumes: 同文件第 36 行已有 `_SUBMIT_BTN_RE = re.compile(r'^(保存|提交|确认|确定)(并.*)?$')` 与第 41 行的判断函数（实施时确认函数名，如 `_is_submit_text`，直接复用）
- Produces: `click_button('保存')` 返回 `err-use-click-save:<text> | Use click_save(button_text=...)` 引导 LLM 换动作；非保存类按钮行为完全不变

- [ ] **Step 1: 在 `async def click_button(button_text: str):` 函数体第一行插入守卫**

```python
    async def click_button(button_text: str):
        bt = str(button_text or '').strip()
        if _SUBMIT_BTN_RE.match(bt):
            # 统一保存入口：保存/提交类一律走 click_save（outcome 校验 + 可导出落库）
            return (
                f'err-use-click-save:{bt} | '
                f'"保存/提交/确认"类按钮请改用 click_save(button_text="{bt}")；'
                f'分区保存用 click_save(button_text="{bt}", region="<分区标题>")'
            )
        page = await browser_context.get_current_page()
        # Pre-strip stale dialog wrappers (tsscMutilDialog 关闭残留) so real
        ...
```

（守卫只拦截整词"保存/提交/确认/确定"；`_SUBMIT_BTN_RE` 不含"查询/返回"等，普通按钮不受影响。）

- [ ] **Step 2: 语法验证**

Run: `python -m py_compile scripts/controller/actions/_misc.py`
Expected: 无输出

- [ ] **Step 3: 用户确认后 commit**

```bash
git add scripts/controller/actions/_misc.py
git commit -m "feat(save): click_button 拦截保存/提交类按钮，引导改用 click_save"
```

---

### Task 5: Prompt 规则统一

**Files:**
- Modify: `scripts/prompts/agent-tools-form.md`（约 131-142 行：保存规则 + 模块分区保存规则）

**Interfaces:**
- Consumes: Task 3/4 的动作行为（save_section=转发别名、click_button 拒绝保存类）

- [ ] **Step 1: 改写保存规则段**

定位「# 🚨 模块分区保存规则」（`agent-tools-form.md:137` 附近）与主表单保存规则（第 2-3、8、13、15 行），将"分区一律 save_section"改为：

```markdown
# 🚨 保存规则（统一入口）

- 所有保存（主表单 / 弹窗 / 抽屉 / **分区**）一律 `click_save(button_text=…)`：
  - 分区保存：`click_save(button_text="保存", region="<分区标题原文>")`——标题来自
    semantic_snapshot，勿臆造；引擎会按标题找最近容器内的 enabled 保存按钮。
  - 保存后紧跟 `read_xhr_log(url_filter='saveOrUpdate')` 核对请求体关键字段（见 common）。
  - `err-save-validation` → 修字段再 click_save；`err-section-not-found` →
    从 semantic_snapshot 核对分区标题原文重试，最多 1 次。
- `save_section(...)` 已并入 click_save，仅为兼容保留：调用会被转发，新录制勿再使用。
- 禁止用 `click_button` / `click_element_by_index` / `real_click` 点"保存/提交"——
  click_button 现在会直接返回 err-use-click-save 引导。
```

同步删除原文中"模块分区保存一律用 save_section"的旧段落，保持 `agent-tools-common.md:132` 的 read_xhr_log 配对说明不变（文案里"配合 save_section"改为"配合 click_save"）。

- [ ] **Step 2: 检查其它 prompt 引用**

Run: `grep -rn "save_section" scripts/prompts/`
Expected: 仅剩 legacy 备注或零命中；把仍指引"优先 save_section"的句子改为指向 click_save(region=…)

- [ ] **Step 3: 用户确认后 commit**

```bash
git add scripts/prompts/agent-tools-form.md scripts/prompts/agent-tools-common.md
git commit -m "docs(prompts): 保存规则统一到 click_save，save_section 标记为兼容别名"
```

---

### Task 6: 冒烟验证（用户配合，不改代码）

**Files:** 无（验证任务）

- [ ] **Step 1: 语法总检**

Run: `python -m py_compile scripts/controller/actions/js_snippets/save.py scripts/controller/actions/form_save.py scripts/controller/actions/_form.py scripts/controller/actions/_misc.py`
Expected: 全部通过

- [ ] **Step 2: 重启录制执行机（用户自己启动）**，在信贷系统跑一条含分区保存的录制（如对公用信"引入"流程），验证：
  1. prompt 引导下 LLM 调用 `click_save(region=分区标题)`，分区兜底定位命中（stderr 可见 `[click_save] clicked ...`）
  2. `trajectory_step` 新步骤 `action_type=click_element_by_index` 且 `params_json.section` 为分区标题（不再新增 `save_section` 类型步骤）
  3. 传统引擎导出（legacy-engine-export）包含该保存步骤
  4. 历史含 `save_section` 步骤的旧轨迹仍可回放（`_replay.py` 通用兜底 + `JS_SAVE_SECTION` 本体未动）
- [ ] **Step 3: 结果回报用户**，由用户决定是否切线上发版

---

## Self-Review 记录

- 规格覆盖：三分支合并（JS 定位 / Python 转发+守卫 / prompt 规则）→ Task 1-5；回放兼容 → Task 3 说明 + Task 6 Step 2-4；前端无需改动（save_section 标签已注册、新形态 click_element_by_index 本就注册），确认无任务缺口。
- 占位符：无 TBD/TODO；Task 1 的 `sectionFallback` 代码块已自包含（findSectionTitleEls / saveBtnIn / 上溯逻辑均在块内定义），移植自 `js_snippets/save_section.py:16-87` 原实现。
- 类型一致性：`click_save(button_text, section, region)` 签名、`JS_CLICK_SAVE_BUTTON` 返回 JSON 键（ok/text/section/xpath/tag）、`_SUBMIT_BTN_RE` 名称均与现仓库一致。
