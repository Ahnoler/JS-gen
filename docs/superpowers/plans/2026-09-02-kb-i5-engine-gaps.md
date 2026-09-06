# KB-I5 引擎五缺口修复（2026-09-02）

- 依据：`docs/superpowers/research/2026-08-31-api-drive-chain.md` §12（交易 218/219 授信深链未闭环根因）
- 目标：Python Agent（scripts/）具备自主跑通授信向导深链的引擎能力（业务知识已由 20 卡覆盖）
- 实现方式：3 组并行子智能体（文件集不相交）+ 主线程验证/收口；**子智能体不 commit**

## 五缺口 → 文件 → 修复原则

| # | 缺口 | 文件（仅列本组可写） | 修复原则 |
|---|---|---|---|
| G1 | click_button 页面级同名遮蔽（抽屉内「查询」被主页面同名遮蔽） | `scripts/controller/actions/_misc.py`、`scripts/controller/actions/form_action_engines.py`、`scripts/controller/actions/js_snippets/icons.py` | 按钮点击先解析容器作用域（JS_IDENTIFY_CONTAINER：drawer/dialog 区域），容器内命中优先；容器无命中才回退页面级。保留现有 pin 字符串（characterize-icon-buttons.py），不得改名/删除被 pin 的常量与函数 |
| G2 | JS_IS_QUERY_TOOLBAR 误判向导抽屉（查询+下一步、无保存 → 判为 query UI → scan/save 被守卫拦） | `scripts/controller/actions/js_snippets/base.py`、`scripts/controller/actions/form_scan_utils.py`、`scripts/controller/actions/form_save.py` | JS_IS_QUERY_TOOLBAR 增加向导排除：可见 `.el-steps/.el-step` 或（「下一步」∧「上一步」）或「流程提交/意见」→ 非 query toolbar（return false）；纯查询工具栏用例保持 true。调用点语义不变（false=放行表单流程） |
| G3 | picker_dialog_select 回填空（changed:{}，表单未带回值静默失败） | `scripts/controller/actions/js_snippets/picker_confirm.py`、`scripts/controller/actions/_workspace.py` | SELECT 在确认后再等 1.5s 重读底层表单，仍空 → 返回 refill_verified:false+警告（不静默）；_workspace.py 调用点：refill_verified=false → 重读+按同 rowText 重选一次（≤1 次），仍空 → 返回 err-refill-not-verified 显式上报 |
| G4 | run_form_assistant intent gate（watcher 模式不编译 phase intent → err-form-assistant-forbidden） | `scripts/controller/actions/_phase_intent.py`、`scripts/controller/actions/form_scan_actions.py`（仅当需要）、`scripts/characterization/characterize-phase-intent.py` | contract_allows_form_assistant：无 phase contract 但 store 含 `_phase_intent_flag_locked=True` 且 `_phase_intent.mode∈{create,modify}`（播种，A6 实证可解）→ allow；无播种保持现有 deny 语义（**characterize-phase-intent.py:156 'assistant denied' pin 必须保持通过**）。在该 pin 脚本补正例断言（播种→allowed） |
| G5 | 孤儿 Chrome 复用（pickExecutorNode 偏好 idle CDP 浏览器，prepare login 落在已登录页必败） | `scripts/controller/actions/form_action_engines.py`（login 动作域） | login 动作前探针：localStorage._usertoken 存在且 hash=#/home → 比对当前用户（顶栏用户名/localStorage 用户号）与目标 username：一致 → 返回 ok-login（复用不重登）；不一致/孤儿 → localStorage.clear()+reload 后正常登录；token 缺失走原逻辑。保持 `_wait_for_login_form` 与 label-not-found 语义不变 |

## 分组（并行，文件集不相交）

- **S1 = G1+G3+G5**：`_misc.py`、`form_action_engines.py`、`js_snippets/icons.py`、`js_snippets/picker_confirm.py`、`_workspace.py` + 新 pin `scripts/characterization/characterize-click-scope-picker-login.py`
- **S2 = G2**：`js_snippets/base.py`、`form_scan_utils.py`、`form_save.py` + 新 pin `scripts/characterization/characterize-query-toolbar-snippet.py`
- **S3 = G4**：`_phase_intent.py`、`form_scan_actions.py`（仅如需）、`scripts/characterization/characterize-phase-intent.py`（扩展正例；现有断言不得破坏）

共享文件（禁改）：`_js_snippets.py`（只读聚合）、`_locator_helpers_js.py`（生成物）、`scripts/prompts/**`（主线程收口同步）、`src/**`（Node 侧本批不动）。

## 验证门禁（每子智能体必须回显）

1. 改后 `./python/python.exe -m py_compile <每个改动文件>` 0 错
2. 相关既有 pin 全部通过（S1: characterize-icon-buttons.py；S2: characterize-form-scan-control-first.py；S3: characterize-phase-intent.py + characterize-form-assistant.py）
3. 新增 pin 脚本自跑通过
4. 不新增 lint warning（Python 侧无 eslint，但别引入未使用 import 等明显废话）

## 收口（主线程）

- 串行复核 diff（只插入/最小改，禁删函数），统一跑 core smokes：`bash scripts/refactor/verify-all.sh`（如存量失败先记基线）
- prompts 同步（agent-tools-form.md：向导抽屉不再被当作查询 UI 的 cue + login 复用探针 + picker 回填补验）
- commit（feat(agent): KB-I5 五缺口修复…）+ agent-log + 记忆更新
