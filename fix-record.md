# Multi-Turn Session 模式修复记录

## 问题

Browser Use 集成后，Multi-Turn Session 模式完全不可用——通过 Dashboard 提交步骤任务无任何响应。

---

## 排查过程

### 第一步：环境检查

```
LLM 环境变量 → 未设置
Python → 3.12.13 browser_use 环境 OK
browser_use → langchain_openai, Agent, Controller 均可导入
```

**发现：** `LLM_BASE_URL` 和 `LLM_API_KEY` 环境变量缺失，`create_llm()` 直接 exit(1)。

### 第二步：Python 直连测试

```
python -m scripts.main --session --model GLM-5 --base-url ... --api-key ...
→ 发送 step 指令
→ Agent 打开百度 → 完成 → phase_done
```

**结论：** Python 侧代码正常，LLM 直连可达。

### 第三步：Node.js → Python 管道测试

```
node 启动 Python 子进程 → stdin 写 step → stdout 读事件
→ 收到 nav_step 后挂起 300 秒
→ 超时
```

**发现：** `enable_memory=True` 导致 mem0 在 Agent 构造时初始化，FAISS 加载 + embedding 连接失败，阻塞 Agent 创建。

### 第四步：修正后全链路测试

```
enable_memory=False → 17 秒完成
HTTP API: POST /session → POST /step → SSE 全事件流
```

---

## 修复内容

### 1. `enable_memory=False`（修复挂起根因）

**文件：** `scripts/session_runner.py`、`scripts/workflow_runner.py`

mem0 向量数据库初始化在本地环境发生 Connection error，且为阻塞式调用，导致 `Agent()` 构造函数永不返回。改为 `False` 后 Agent 立即完成初始化。

### 2. 重写 `OVERRIDE_SYSTEM_MESSAGE`（修复过早 done）

**文件：** `scripts/agent_utils.py`

旧的自定义 system prompt 完全替换了 browser_use 的默认 prompt，但缺少经过大量测试的"任务追踪"指令。新版本：

- 保留详细的完成规则：`"done() only when ALL task steps complete"`
- 加入登录场景示例：`"Login sequence is ALWAYS: select → fill username → fill password → click login → wait"`
- 所有自定义 action 的完整路由表
- 移除过于冗长的 Element UI 组件细节（移到 element-ui-knowledge.md）

### 3. 恢复 Agent 默认参数（修复单步即止）

**文件：** `scripts/session_runner.py`、`scripts/workflow_runner.py`

| 参数 | 旧值 | 新值 |
|------|------|------|
| `max_actions_per_step` | 1 | 10（默认） |
| `tool_calling_method` | `"raw"` | `"auto"`（默认） |
| `max_failures` | 2 | 5 |

`max_actions_per_step=1` 限制 Agent 每次只能输出一个 action，每次 action 后重新评估——导致 LLM 在完成一个 action 后就 done。默认 10 允许批量动作（如一次填用户名+密码+点击）。

### 4. 修复 Controller 两个 JS 运行时 Bug

**文件：** `scripts/controller.py`

**Bug A** `_checkSelects` / `_triggerSelect` / `_confirmSelect` 未定义

`JS_FIND_LABELED_SELECT` 引用了 `_checkSelects()`、`_triggerSelect()`、`_confirmSelect()` 三个函数，但它们定义在独立的 Python 字符串变量 `JS_CHECK_SELECTS`、`JS_TRIGGER_SELECT`、`JS_CONFIRM_SELECT` 中。`page.evaluate()` 执行时这些函数不存在于浏览器上下文。

**修复：** 将三个辅助函数内联到 `JS_FIND_LABELED_SELECT` 中。

**Bug B** `setterFn is not a function`

`JS_FILL_FORM_FIELD` 接收 `setterFn` 参数，但 Python 侧传入的是 JavaScript 代码字符串 `JS_NATIVE_SETTER`。`page.evaluate()` 将字符串作为字符串值传递，而非可调用函数。

**修复：** 将 native setter 逻辑内联到 `JS_FILL_FORM_FIELD` 中，移除 `setterFn` 参数。

### 5. `resolveModelId()` 模型 ID 格式修正

**文件：** `src/routes/explore-utils.js`

直连模式下（`STANDALONE_LLM=true`），`resolveModelId()` 返回 `providerID/modelID` 格式（如 `myprovider/GLM-5`），但上游 OpenAI 兼容 API 只认 `GLM-5`。

**修复：** 直连模式返回纯 `modelID`，代理模式保留 `providerID/modelID`。

### 6. 默认模型加载

**文件：** `server.mjs`

`STANDALONE_LLM=true` 时 `startOpencode()` 不执行，`state.defaultModel` 为空，`resolveModelId()` 回退到不存在的 `deepseek/deepseek-chat`。

**修复：** `main()` 启动时调用 `loadDefaultModel()`，从 `agent-api.config.json` 和 `opencode.json` 读取默认模型。

### 7. SSE Content-Type 指定 UTF-8

**文件：** `src/routes/explore-utils.js`、`test-run.js`、`sse.js`

`text/event-stream` 缺少 `charset=utf-8`。

### 8. `start.ps1` 更新

**文件：** `start.ps1`

添加 `STANDALONE_LLM=true`、`PYTHON_EXE` 环境变量，添加 Python 环境检查。

### 9. `element-ui-knowledge.md` 重写

**文件：** `scripts/element-ui-knowledge.md`

从 Element UI 组件交互指南 → 结构化 action 参考手册。覆盖全部 15 个自定义 action，每个 action 含参数说明、返回值含义表、示例。

---

## 验证结果

```
Node.js pipe 直连:    17s ✅ 打开百度完成
HTTP API 全链路:      SSE ✅ phase_start → step → phase_done → done
Python 登录测试:       ✅ 法人选择 → 填用户名 → 填密码 → 点击登录 → 等待跳转 → done（6/6 步全部完成）
```

---

## 关键教训

1. **mem0 不是免费的能力**——其向量数据库和 embedding 服务需要独立部署，否则阻塞启动
2. **browser_use 的默认参数经过充分测试**——`max_actions_per_step=10`、`tool_calling_method='auto'` 有原因
3. **自定义 system prompt 需要包含完整任务追踪规则**——不能只写 action 用法，要写场景化的"什么算完成"
4. **`page.evaluate()` 传参是序列化传值**——JS 函数不能作为参数传递，必须内联
5. **Windows 管道 buffer 有限**——stdout 必须及时读取，否则 Python 写入阻塞
