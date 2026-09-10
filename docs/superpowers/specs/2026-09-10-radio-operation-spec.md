# click_radio（单选按钮）操作规格 — 交接文档

> 2026-09-10 · JS-gen 引擎线 → 执行引擎同事侧。
> 覆盖 Element UI 单选（el-radio）+ 同族复选（el-checkbox）的表单级选择动作 `click_radio`。
> 与 select:click / select:tree 交接包同构：JS 片段（DOM 操作）→ RadioEngine（录放同体）→ 回放接线（replay_form_action 分支）。全部内容真机实证。

---

## 0. 一句话架构

`click_radio(label_text, option_text, xpath_smart?)` 双路 JS：**有 xpath 走 `JS_CLICK_RADIO_BY_XPATH`（xpath 版，弹窗感知）→ 失败回退 `JS_CLICK_RADIO`（label 版）**；无 xpath 直接 label 版。录制与回放共用 `RadioEngine.click_radio(mode=record|replay)`。与 select/fill 不同：**radio 不做独立 dispatch**（用户裁决，直接 Phase B 引擎化）。

## 1. Element UI radio 的 DOM 结构与点击要点

```
.el-form-item
  ├─ .el-form-item__label        ← label 文本（含冒号/星号变体）
  └─ .el-radio-group
       └─ .el-radio              ← 点击目标（.el-radio__original input 不可直接点）
            ├─ .el-radio__input
            └─ .el-radio__label  ← 文案
```

**要点**：
1. **点 `.el-radio` 整体，不点内层 input/label**——Element UI 的 change 事件绑在组件根上；`radio.click()` 即可触发 Vue 状态更新。
2. **精确匹配优先**：`textContent.trim() === option`，全部未中再 `includes(option)`（两轮 pick，见 §3 xpath 版实现）。选中时跳过 `.is-disabled`。
3. **可见性过滤**：`offsetParent !== null`（隐藏组/隐藏弹窗里的同名 radio 不点）。
4. **点击前 scrollIntoView**（block:'center'）——Element UI radio 在视口外时点击偶发不生效。
5. **disabled 判定**：先看 input 的 disabled/read-only + form-item 级 `is-disabled` 类（`JS_FIELD_DISABLED` 共享判定），返回 `disabled` 终态**勿重试**。

## 2. label 版 JS_CLICK_RADIO（按 label 找字段）

位置：`js_snippets/select_tree.py:8`（与 select_tree 同文件，拼接 `JS_FIELD_DISABLED` + `JS_GET_CONTAINER`）。

流程：
1. `JS_GET_CONTAINER` 拿容器感知根（编辑/查询模式容器不同），在容器内按 **label 包含匹配**找 `.el-form-item`；
2. 找不到 → **补扫可见 `.el-dialog / .el-drawer`**（KB-I5：方案品种明细等弹窗内 form-item 不在页面容器里）；
3. `label-not-found` 短路；scrollIntoView；取 `input:not([type=hidden])` 判 disabled；
4. 遍历 `.el-radio`：跳过 `is-disabled`，`textContent.trim() === option` 且可见 → `radio.click()` → `ok`；
5. 未中 → `option-not-found`。

**限制**：label 匹配是 `includes`（非精确）——同前缀字段（"联系人"/"联系人手机"）靠 scan 缓存的 xpath 版先行兜住（见 §4 编排）。

## 3. xpath 版 JS_CLICK_RADIO_BY_XPATH（弹窗感知，首选）

位置：`js_snippets/fill_date.py:165`（与 fill 同文件；radio/checkbox 共用，选择器族通吃 `.el-radio`/`.el-checkbox`/表格单元格）。

关键实现点：
1. **xpath 解析 + 可见性回扫**：`ORDERED_NODE_SNAPSHOT` 从**最后一个**往前找可见节点（同 xpath 多命中时取 DOM 末个=最新渲染）；
2. **`[last()]` 弹窗修正**：xpath 含 `el-dialog|el-message-box|el-drawer` 且以 `[last()]` 结尾时，直接找**最后一个可见 dialog/drawer**（DOM last 常是关闭残留的隐藏实例），在其内用局部 xpath 重找——Element UI 弹窗反复开关后 `//dialog[last()]` 经常指到隐藏实例，这一步是湿测踩出来的修正；
3. **宿主解析**：命中节点向上找 `.el-radio-group` → `.el-checkbox-group` → `td/.el-table__cell` → `tr` → `.el-form-item`（兼容表格行内 radio 列）；
4. **两轮 pick**：组内先精确 `===` 后 `includes`，均跳 `is-disabled`、要求可见；
5. 返回码：`ok` / `option-not-found` / `xpath-not-found` / `xpath-empty`。

## 4. RadioEngine（radio_engine.py，录放同体）

`click_radio(label_text, option_text, xpath_smart="", mode="record"|"replay")`：

```
_wait_if_loading → _maybe_ensure_scanned → _resolve_control（scan 缓存解析 label+xpath）
→ _capture_element(target_kind='form_radio')
→ 有 xp: evaluate(JS_CLICK_RADIO_BY_XPATH, [xp, option])
     └ 结果非 ok 且非 absent → 回退 evaluate(JS_CLICK_RADIO, [label, option])
   无 xp: 直接 label 版
→ 结果分派（见 §5）
```

- **record**：ok → `_record_action('click_radio', {label_text, option_text}, result, element)`（stamp `form_radio` + xpath_smart）+ `_task_done_impl`；
- **replay**：`click_radio_for_replay(page, ...)` 类方法，`_ReplayPageAdapter` 构造引擎跑 `mode="replay"`（不落步骤表）；
- **硬约束**（契约 spec §2.4）：禁止只改引擎或只改 `replay_form_action`——两端必须同 commit 接线（select/fill 教训：「录得过、放不过」）。

## 5. 结果协议（Python 侧分派）

| 结果 | 录制 | 回放 |
|---|---|---|
| `ok*` | 落步骤 + task_done | 原样返回 |
| **absent 字段**（`is_absent_field_result`，如 `label-not-found`） | **skip OK**：非查询模式 `_task_done_impl` 标完成 + `_with_submit_cue` 提示语；**不报错**（级联场景该字段本就不存在，与 fill/select 的 label-not-found=skip 同契约） | stderr 记 skip + `absent_field_skip_result()` 继续 |
| `disabled` | 终态文案（勿重试） | 原样返回 |
| 其他（`option-not-found` / `xpath-not-found`） | 原样返回（LLM 决定下一步） | 原样返回（走 heal） |

**absent 语义是 radio 特有的坑**：级联表单（如授信向导选「信用」担保→无保证人区块）里字段不存在是**正常态**，报错会打断整链；按 skip 处理且**不盲目重试**。

## 6. 回放接线（replay_form_action.py:124）

```python
if action_name == 'click_radio':
    async def _radio():
        r = await RadioEngine.click_radio_for_replay(page, label, value, xpath_smart=xpath_smart or '')
        await page.wait_for_timeout(WAIT_300_MS)   # 点击后 300ms 沉降
        return r
    return await _with_xpath_first(_radio)
```

`_with_xpath_first`：先验证 `xpath_smart` 存储定位仍解析 → 跑 label JS（引擎内部已是 xpath 优先+label 兜底）→ ok 时按定位来源注记 `ok-xpath-smart` / `ok-xpath-full`。

## 7. 周边消费（谁在调 click_radio）

- **录制注册**：`_form.py:168` `click_radio` 动作（agent/LLM 显式调用面）；
- **autofill 三轮**（autofill_round.py:312/406/443）：`field_kind == 'radio'` 自动派 `click_radio`（自动填表主消费者）；
- **LLM 值映射**（_llm_values.py:379/443/458）：`kind == 'radio' → action='click_radio'`（LLM 从 scan 清单选值时生成动作）；
- **不在本包**：`click_table_row_radio`（表格行 radio，属 replay_table 族，DOM 结构不同——表格列场景另议）。

## 8. 文件清单（zip 内 py/）

| 文件 | 角色 |
|---|---|
| `radio_engine.py` | RadioEngine：click_radio 录放同体 + absent 分派 |
| `replay_form_action.py` | 回放路由（click_radio 分支 + _with_xpath_first） |
| `_form.py` | 动作注册面（click_radio → RadioEngine 接线） |
| `js_snippets/select_tree.py` | JS_CLICK_RADIO（label 版；与 select_tree 拼接同源） |
| `js_snippets/fill_date.py` | JS_CLICK_RADIO_BY_XPATH（xpath 版，弹窗感知） |
| `js_snippets/base.py` / `container.py` | JS_FIELD_DISABLED / JS_GET_CONTAINER（拼接依赖） |
| `_helpers.py` | _ok/_err/_is_ok_result/is_absent_field_result/absent_field_skip_result/_capture_element/stamp |
| `form_scan_utils.py` | _resolve_control / _is_query_mode / _with_submit_cue 等 |
| `form_engine_base.py` | 引擎基类（_maybe_ensure_scanned / Replay 适配器） |
| `task_completion.py` | _task_done_impl / _with_submit_cue |
| `_replay.py` / `replay_timing.py` | 回放直派基建 + 等待常量（WAIT_300_MS） |

## 9. 集成注意（给同事）

1. **双 JS 优先级**：有 scan xpath 先走 xpath 版（弹窗感知强、label 前缀歧义少），失败回退 label 版——不要只用 label 版，同前缀字段会点错。
2. **点整不点内**：点 `.el-radio` 根元素；点 input 原生控件会被 Element UI 双重触发或事件不冒泡。
3. **absent 不报错**：级联字段缺失=skip OK，这是录放两端一致的行为，改坏它会让授信向导这类级联链回放必断。
4. **沉降等待**：点击后 300ms（radio 是同步组件，比 select 的 500ms 短），再读状态/截图。
5. **radio+checkbox 共用**：xpath 版 pick 同时兼容 `.el-radio`/`.el-checkbox`；若同事侧复选是独立动作，可只取 radio 分支。
