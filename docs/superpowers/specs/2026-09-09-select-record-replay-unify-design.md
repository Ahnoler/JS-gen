# Design: select 录制/回放分流统一（A→B）

**日期**：2026-09-09  
**状态**：待用户审阅（对话已口头批准方向 A→B；本文为落盘稿）  
**触发**：`log.txt` 回放「要素名称→部署方式」失败（`option-not-found:deplMod,…`），自愈经 `SelectEngine` 成功（`ok-p1:部署方式`）  
**相关**：[`2026-09-09-tssc-multi-select-v2-design.md`](./2026-09-09-tssc-multi-select-v2-design.md)（D6）、[`2026-09-05-engine-actions-contract.md`](./2026-09-05-engine-actions-contract.md) §2.4、hotfix `84a320a2`  
**用户裁决**：系统性收敛采用 **A→B 分阶段**（先共享路由器，再回放复用 SelectEngine）

---

## 1. 问题

### 1.1 表象

| 路径 | 行为 |
|---|---|
| 录制 / Agent / 单步自愈 | `SelectEngine.select_option` → `lookup_field_kind == tssc-multi-select` → `JS_TSSC_MULTI_SELECT` |
| 产品回放（hotfix 前） | `_replay_form_action` 对 `action_name=select_option` **默认** `JS_SELECT_OPTION`；仅 `action_name=tssc_multi_select` 才走 tssc |

D6 将落库动作名统一为 `select_option`（`target_kind` 仍可为 `form_tssc_multi_select`）后，回放按**动作名**分流失效 → 稳定「录得过、放不过」。

### 1.2 根因（系统性）

- **JS 常量可单源**（`JS_SELECT_OPTION` / `JS_TSSC_MULTI_SELECT`），**Python 编排是双线**：引擎 vs `_replay_form_action`。
- docstring「same JS path as `_execute_round`」描述的是意图/片段复用，**不是**共享分流契约。
- 凡在 `SelectEngine` 增加 handoff，若回放不同步，必再现同类洞。
- Hotfix（`84a320a2`）在回放侧补了 metadata + live 探测，**行为已对齐，分流逻辑仍双份**。

### 1.3 目标 / 非目标

**In**

1. Phase A：单一 `resolve_select_dispatch`，录制与回放都必须经此决定 `tssc | tree | el-select`。
2. Phase B：回放 `select_option`（及可选 tree）调用无录制副作用的 SelectEngine 入口，消灭主路径上的双编排。
3. cold pin + 契约短条款，防止再漏。
4. 保留 D6：agent 只暴露 `select_option`；历史 `action_type=tssc_multi_select` 兼容。

**Out**

- 不把整批 `_replay` 调度并进 controller。
- 本 spec **不**强制一次性统一 `fill_form_field` / 全点击双线（可另开）。
- 不改变产品回放「录制 `option_text` 权威、禁止用 options[] 替值」语义。
- 不撤回 hotfix；A 将其收敛为调用 router，避免三份探测。

---

## 2. 目标架构

```
                    ┌─────────────────────────────┐
                    │  resolve_select_dispatch     │
                    │  (唯一分流；可测、可 pin)      │
                    └─────────────┬───────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
         path=tssc          path=tree           path=el-select
         JS_TSSC_*          JS_SELECT_TREE_*    trigger + JS_SELECT_OPTION
              ▲                   ▲                   ▲
   Phase A: 两端各自 evaluate，但 path 必须来自 router
   Phase B: 仅 SelectEngine（replay mode）evaluate；回放只供参/注解
```

**分流输入优先级（钉死，两端一致）**

1. `element.target_kind`（回放 entry / 录制 capture）：`form_tssc_multi_select` → tssc；`form_tree_select` → tree；…
2. scan store：`lookup_field_kind` → `tssc-multi-select` / tree / select
3. live DOM：标签对应 `.el-form-item` 内 `.tssc-multi-select`（或既有 tree host 规则）
4. 兜底：`el-select`

输出：`{ path, reason, … }`；日志建议：`dispatch=tssc|reason=target_kind`。

---

## 3. Phase A — 共享路由器

### 3.1 交付物

| 项 | 说明 |
|---|---|
| 新模块 | `scripts/controller/actions/select_dispatch.py`（名可微调，职责不变） |
| API | `resolve_select_dispatch(*, label, element=None, field_kind=None, page=None) -> SelectDispatch` |
| 接线-引擎 | `_select_option_impl` 用 router 替代裸 `if kind == 'tssc-multi-select'` |
| 接线-回放 | `select_option` 分支先 router；`path=tssc` → 现有 `JS_TSSC` 路径；收敛 hotfix 内联探测 |
| 兼容 | `action_name == 'tssc_multi_select'` → 强制 `path=tssc`（或等价 reason=`legacy_action`） |
| 文档 | 更新 `engine-actions-contract` §2.4：`select_option` 注明「经 select_dispatch；可能 tssc」 |

### 3.2 回放外壳（A 阶段保留）

以下仍留在 `_replay_form_action`（B 再搬）：

- `reset_select_ui` 预检 / retrigger
- xpath_smart → label → xpath_full 定位阶梯
- 录制 option 权威、`option-mismatch`、sentinel `first` 处理
- `locate=` 注解

Router **只**决定调哪段 JS，不替代上述策略。

### 3.3 Phase A 验收

- cold pin：`form_action_engines.py` 与 `replay_form_action.py` 均 import/调用 `resolve_select_dispatch`（或约定符号名）。
- pin：hotfix 专用内联 live 探测字符串应从 replay 主路径消失（改由 router）。
- 单元/纯函数测：给定 fake element/kind，path 断言（无需浏览器）。
- 回归：`characterize-tssc-multi-select` / `characterize-select-state-boundary` GREEN。
- 湿测（可选但推荐）：复放「要素名称→部署方式」→ 成功且日志含 tssc dispatch。

### 3.4 Phase A 非目标

- 不删除 `_replay_form_action` 的 el-select 编排大段。
- 不引入 `SelectEngine` 的 `record=False`（留给 B）。

---

## 4. Phase B — 回放复用 SelectEngine

### 4.1 交付物

| 项 | 说明 |
|---|---|
| 引擎入口 | `select_option_for_replay(...)` **或** `select_option(..., mode='replay'\|'record')` |
| 回放主路径 | `select_option` → 解析 entry/params → 调引擎 replay 入口 → 注解结果 |
| 禁止 | 回放主路径直接 `page.evaluate(JS_SELECT_OPTION)` / `JS_TSSC_*`（除引擎内部） |
| 可选包 | `select_tree_option` 同步迁入；`click_radio` **默认本阶段不做**，除非实施时成本低 |

### 4.2 必须参数化的引擎副作用

| 副作用 | record | replay |
|---|---|---|
| `_record_action` / stamp 写库 | 开 | **关** |
| `_task_done_impl` / task_list | 开 | **关** |
| 依赖 `_ensure_scanned` / 全表 scan | 可 | **弱依赖**：无 store 时用 entry `target_kind` + live（经 router） |
| `err_with` agent 话术 envelope | 可 | 映射为纯 result 字符串（与现回放 `_result_ok` 兼容） |
| `exactOnly` / option 权威 | 录制可宽松 | **保持回放严格**（参数传入，禁止静默变松） |

### 4.3 Phase B 验收

- cold pin：`replay_form_action` 的 `select_option` 分支调用 `SelectEngine`（或共享 facade），主路径无直接 `JS_SELECT_OPTION` / `JS_TSSC_MULTI_SELECT` evaluate。
- 行为：要素名称中文 option、客户名称、普通 dict/el-select、历史 `tssc_multi_select` 行。
- `characterize-select-state-boundary` 等 reset/gate 顺序：若逻辑上移引擎，**更新 pin 指向新位置**，禁止删语义。

### 4.4 风险与回滚

- 风险：replay 独有 strict / reset 顺序迁入引擎时回归。缓解：先 A 稳定；B 用 `mode=` 显式分支；每步 characterization。
- 回滚：B 可 feature-flag 回退到 A 的「router + 回放自 evaluate」；A 的 router 保留。

---

## 5. 契约与协作约定

1. **新增 select 类 handoff**：只改 `select_dispatch` + 引擎实现；禁止只改 `SelectEngine` 或只改 `replay_form_action`。
2. **动作名合并（类 D6）**：落库名与回放分支名解耦——分流看 `target_kind` / kind / live，**不**把「独立 action_name」当唯一门控。
3. 更新 [`engine-actions-contract.md`](./2026-09-05-engine-actions-contract.md) §2.4 `select_option` 行与「新动作必须两处落地」条款，增加「select 分流必须经 select_dispatch」。
4. AGENTS.md 或本目录短链：一句指向本文，避免再写「录放同一 JS 路径」而不提 Python 分流。

---

## 6. 实施顺序

1. **Spec 审阅通过** → writing-plans → `docs/superpowers/plans/2026-09-09-select-record-replay-unify.md`
2. **Phase A** 实现 + pin +（推荐）湿测 → commit；可撤 replay 与 hotfix 重复探测
3. **Phase B** 另开任务单元；A 的 pin 升级为「经 Engine」，保留「经 dispatch」

Hotfix `84a320a2` 在 A 落地前继续有效；A 合并后视为被 router 吸收，不保留第三份 live 探测。

---

## 7. 成功标准（整体）

| ID | 标准 |
|---|---|
| S1 | 任意一端增加 tssc/tree 类 handoff，漏改另一端会被 cold pin 挡住 |
| S2 | D6 类「动作名合并」不再导致回放掉进错误 JS |
| S3 | Phase B 后：录制与回放 `select_option` 的 JS 选择由同一引擎路径发出 |
| S4 | 既有 select-state-boundary / tssc / stamp 表征不无故变绿失败 |

---

## 8. 开放问题（实施前可默认）

| # | 问题 | 默认 |
|---|---|---|
| O1 | Phase B 是否包含 `select_tree_option` | **包含**（与 select 同族）；`click_radio` 不含 |
| O2 | live 探测放在 Python 调小 JS 还是并入各 `JS_*` 头 | A：Python 侧小 probe（与现 hotfix 同级）；B：可并入引擎 |
| O3 | router 是否返回 JS 常量本身还是 path 枚举 | **path 枚举**；调用方取 JS，避免循环 import |

---

## 9. 自检

- [x] 无 TBD 占位实现细节冒充已决（开放问题已给默认）
- [x] 与 D6 / hotfix 无矛盾（吸收而非推翻）
- [x] A/B 边界清晰，B 不阻塞 A 单独合并
- [x] 范围不含 fill 全双线
