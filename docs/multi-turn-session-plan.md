# Multi-Turn Session 模式实现计划

## 目标

将长流程测试拆分为多个**独立小案例（case）**，利用智能体的**多轮对话能力**，由**人工介入**逐条触发执行：

- **长流程拆解**：将一次性执行的 20 阶段长流程拆分为独立的测试案例，每个案例对应独立测试场景
- **人工逐条触发**：执行时由用户按顺序或根据页面路由手动触发各案例，而非一次性提交全部指令
- **分批次输入**：利用智能体的多轮对话能力，将长文本的测试步骤分批次输入，每次只处理一步
- **全局共享浏览器**：所有 Session 共享单一 Python 进程 + 单一 Chrome 实例，浏览器跨 Session 保持
- **解决信息遗忘**：每个 step 创建新 Agent，指令简短，避免长文本下智能体对前文步骤的信息遗忘
- **案例级轨迹累积**：每个 step 的 ActionHistory 自动追加到 session 级累积文件，Save Trajectory 保存全量

---

## 实现状态

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/state.js` | ✅ 已完成 | `globalBrowser: {}` + `sessions: new Map()` + `executionRecords: []` |
| `scripts/browser-use-agent.py` | ✅ 已完成 | `run_session()` + `save_trajectory` + `cumulative_path` |
| `src/routes/browser-use-explore.js` | ✅ 已完成 | 8 个路由：session CRUD + execution records + global browser |
| `test-dashboard.html` | ✅ 已完成 | 双模式 UI：One-Shot Workflow + Multi-Turn Session |
| `test-dashboard.js` | ✅ 已完成 | 会话管理、阶段卡片、Load/Execute/Cancel/Archive、执行记录 Tab |
| `docs/multi-turn-session-plan.md` | ✅ 已完成 | 本文档 |

---

## 用户旅程（User Journey）

### 1. 创建会话

用户选择 Model → 点击 **New Session** → 系统复用全局浏览器或创建新的 → 返回 `sessionId`。

- New Session 只创建 session 记录，不解析阶段
- 所有 Session 共享同一个浏览器（全局单一 Python 进程）

### 2. 导入测试案例

用户在 textarea 中粘贴含 `【阶段N：名称】` 标记的测试案例 → 点击 **Load** → 系统自动执行：

1. **重置累积轨迹** — 调用 `reset_trajectory` 创建新的空累积文件，旧文件保留在 `/tmp/`
2. **解析阶段** — 从文本解析各阶段的名称和任务内容
3. **生成阶段卡片** — 每个卡片包含：
   - 阶段名称和任务描述
   - **Execute** 按钮
4. **合并已有执行状态** — 已执行的卡片（success/failed）保留不变，pending 的卡片依新文本替换

每个阶段执行时，Agent 收到的指令包含：
- 该阶段的纯步骤文本（**不含 URL 前缀** — URL 由后端在 Agent 创建前导航完成）
- 停止约束（仅完成上述步骤，不要执行未列明的操作）

### 3. 分步执行

```
Phase 1: 登录           [Execute ▶]     status: success
Phase 2: 导航到客户管理   [Execute ▶]     status: running
Phase 3: 准备工作         [Execute ▶]     status: pending
Phase 4: 新增客户         [Execute ▶]     status: pending
...
```

### 4. 按需生成轨迹

任意步骤完成后点击 **Save Trajectory** → 读取该 Session 累积的案例级轨迹文件 → 保存到 trajectory store（包含所有已执行阶段的完整 ActionHistory）。

### 5. 管理会话

| 按钮 | 作用 |
|------|------|
| **New Session** | 创建新 session，刷新 AI 上下文，防止长对话遗忘 |
| **Load** | 重置累积轨迹 → 解析测试案例为阶段卡片（含自动断言），保留已执行卡片 |
| **Execute Step** | 手动执行 textarea 中的指令（单步模式，仅用于非阶段式输入） |
| **Save Trajectory** | 保存案例级累积轨迹到 trajectory store（含所有已执行阶段的完整历史） |
| **Reset Traj** | 手动重置累积轨迹文件路径（Load 时自动执行，通常无需手动） |
| **Cancel** | 中止当前正在执行的 step（不归档） |
| **Archive** | 归档当前 session 到执行记录（不关浏览器） |
| **Close Browser** | 关闭全局 Chrome（所有 session 清除） |

### 6. 执行记录

Archive 后 session 进入 Execution Records Tab：
- **Review**：查看 session 元数据和步骤历史
- **Continue**：基于归档记录创建新 session
- **Delete**：永久删除

---

## 实现详情

### 1. `src/state.js`

```javascript
state.globalBrowser = {
  process: ChildProcess,    // 单一 Python 进程（全局共享）
  stdin: Writable,
  ready: false,
  busy: false,              // 全局锁，防止并发 step
  model: string,
  stepIndex: number,
};

state.sessions = new Map();     // key: sessionId → metadata only
// value: {
//   sessionId, stepIndex, trajectories: [],
//   createdAt, model
// }

state.executionRecords = [];    // 归档记录
// { sessionId, model, stepIndex, steps, createdAt, archivedAt }
```

### 2. `scripts/browser-use-agent.py`

**stdin 消息循环（`run_session()`）：**

| 命令 | 说明 |
|------|------|
| `{"event":"step","data":{"instruction":"...","max_steps":40}}` | 执行一步指令，创建新 Agent，共享 browser_context |
| `{"event":"save_trajectory"}` | 按需保存轨迹：copy `cumulative_path`（案例级累积文件）到新文件 |
| `{"event":"reset_trajectory"}` | 重置累积文件路径，生成新 `case_{ts}.json`，旧文件保留在 `/tmp/` |
| `{"event":"close"}` | 关闭浏览器退出 |

**关键行为：**
- 每个 step 创建**新 Agent 实例**，但共享同一个 `browser_context`
- 全局 `cumulative_path` — 案例级累积轨迹文件。每步完成后读取 step 级文件，将 `history` 追加到累积文件，Save Trajectory 直接读取 `cumulative_path`
- 收到 `reset_trajectory` 命令时生成新时间戳的 `case_{ts}.json` 文件，重置录制起点
- **URL 剥离** — Python 从 Agent 的 `task` 中剥离 `【目标URL】http://...` 前缀，后端先完成导航，Agent 只看到纯步骤指令
- **全局导航** — `do_navigate` 不再限定 `step_index == 1`，只要指令含 URL 就导航，解决跨 session 导航丢失问题
- `build_recording_hooks(goal_tracker)` 支持外部传入 tracker，用于跨 step 的去重检测
- Agent 的 `close()` 不关闭共享的 browser_context

### 3. `src/routes/browser-use-explore.js`

**全局浏览器管理：**

| 方法 | 路径 | 说明 |
|------|------|------|
| — | `ensureGlobalBrowser(modelId)` | 懒启动/复用全局 Python 进程，等待 ready |

**路由表：**

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/browser/session` | 创建 session 记录（复用 globalBrowser） |
| POST | `/api/browser/session/:id/step` | 执行子任务（SSE 流式，读/写 global stdin/stdout） |
| DELETE | `/api/browser/session/:id` | **仅归档** session 到执行记录，不杀进程 |
| GET | `/api/browser/session/:id/trajectories` | 获取会话步骤列表 |
| POST | `/api/browser/session/:id/trajectory` | 按需生成轨迹（用户触发，读 global stdin/stdout） |
| POST | `/api/browser/session/:id/reset-trajectory` | 重置累积轨迹文件路径（重新录制，读 global stdin/stdout） |
| GET | `/api/browser/sessions` | 列出所有活跃 session |
| DELETE | `/api/browser/browser` | 关闭全局 Chrome（所有 session 清除） |
| GET | `/api/browser/session/execution-records` | 列出所有执行记录 |
| GET | `/api/browser/session/execution-record/:sessionId` | 查看单条执行记录详情 |
| DELETE | `/api/browser/session/execution-record/:sessionId` | 永久删除执行记录 |

### 4. 前端 UI

#### AI Explore Tab — 双模式

```
[One-Shot Workflow]  [Multi-Turn Session]     ← mode toggle

One-Shot:                                    Multi-Turn Session:
  Model select                                [New Session] [Load] [Close Browser]
  Task textarea                               Active: ses_xxx... ▼  Model | Max Steps
  [Start Exploration] [Cancel]                Test Case / Step Instruction textarea
                                              [Execute Step] [Save Traj] [Cancel] [Archive]
  Progress timeline                           ──────────────────
                                              Phase Plan (parsed by Load):
                                              ┌ Phase 1: 登录          [Execute] ┐
                                              └ Phase 2: 导航到客户管理 [Execute] ┘
                                              ...
  Logs (shared)                               Step Progress (timeline)
                                              Logs (shared)
```

#### Execution Records Tab

- 表格展示：Session ID、Model、Steps、Created、Archived
- Review：查看 session 详情和步骤历史
- Continue：基于归档记录创建新 session
- Delete：永久删除

---

## 关键设计点

### 全局浏览器生命周期

```
POST /api/browser/session (first)  → spawn Python → create Chrome → globalBrowser ready
POST /api/browser/session (second) → reuse globalBrowser → create session record only
POST /api/browser/session/:id/step → stdin write → execute → stdout read → busy=false
DELETE /api/browser/session/:id    → archive to executionRecords → session removed
DELETE /api/browser/browser        → stdin close → kill process → all cleared
```

Python 进程崩溃 → `process.on('exit')` 重置 `globalBrowser` 状态 → 下次创建 session 自动重 spawn。

### 架构对比：旧 vs 新

| 维度 | 旧架构（每 session 一进程） | 新架构（全局共享） |
|------|---------------------------|-------------------|
| 浏览器 | 每个 session 一个 Chrome | 所有 session 共享同一个 Chrome |
| Python 进程 | 每个 session spawn 一次 | 首次 spawn，后续复用 |
| session 删除 | 杀进程 + 归档 | 仅归档，进程保持 |
| 并发 step | 理论可行（多进程） | 串行（globalBrowser.busy 锁） |
| 模型 | 每个 session 独立 | 所有 session 共用首次指定的 model |
| 轨迹保存 | last_agent.history（不可靠） | cumulative_path（案例级累积文件，可靠） |

### SSE 事件流

Step 执行期间，SSE 推送的事件：
- `phase_start` — 开始执行指令
- `step` — Agent 每个子步骤进度
- `nav_step` — 页面导航进度
- `status` — 状态文字更新
- `phase_done` — 指令执行完成
- `done` — SSE 结束信号
- `error` — 错误信息

### 阶段卡片 Load 逻辑

点击 Load 时：
1. **重置轨迹** — 调用 `POST /api/browser/session/:id/reset-trajectory`，Python 创建新的 `case_{ts}.json`
2. **保存已执行卡片** — 保留所有 `success`/`failed` 状态的卡片 → `preservedMap`（按 phase num 索引）
3. **从 textarea 解析新阶段** — 每个阶段末尾追加停止约束
4. **合并** — 已执行的保留原样，新的导入为 `pending`，已执行但新文本中不存在的追加到末尾
5. **按 phase num 排序渲染**

### 错误处理

| 场景 | 处理 |
|------|------|
| Python 进程异常退出 | `process.on('exit')` 重置 globalBrowser，下次请求自动重 spawn |
| step 超时（Agent 卡住） | `wait_for_loading` 30s 兜底，Agent `max_failures=2` 后 done(false) |
| Ready 超时 | 15s 未收到 ready 事件 → kill 进程 + 返回 500 |
| save_trajectory 无数据 | 返回 `{success: false, message: "No trajectory data available"}` |
| 并发 step 请求 | globalBrowser.busy → 返回 409 |

### Agent 生命周期与轨迹保存时序

```
Executor: run_session() stdin loop

   for each step:
    ① Agent(task=instruction, register_done_callback=make_done_callback(output_path)) 创建
    ② await agent.run(max_steps, on_step_start, on_step_end)
         │
         ├─ Agent 执行中... history 逐步追加
         │
         ├─ agent.run() 正常结束
         │   └─ register_done_callback 触发（即 make_done_callback）
         │        └─ history_list.save_to_file(str(output_path))   ← ③ step 级文件落盘
         │
         └── 若 _done_fired 未触发，fallback:
              agent.history.save_to_file(str(output_path))         ← ③ step 级文件落盘
    ④ 读取 step 级文件 → 提取 history 追加到 cumulative_path      ← ④ 累积到案例级
    ⑤ emit_json({"event":"phase_done","trajectory_file":...})      ← 通知前端
    ⑥ Agent 变量被覆盖（生命周期结束）
    ⑦ 回到循环顶部，等待下一条指令
    
    时序保证: ③ → ④ → ⑤ → ⑥
    Save Trajectory 直接读取 cumulative_path，包含所有已执行阶段的完整 ActionHistory
```

```python
# 核心代码（browser-use-agent.py run_session()）
agent = Agent(
    task=instruction,
    ...
    register_done_callback=make_done_callback(output_path),  # 注册回调
)

try:
    await agent.run(...)
    # 回调在 agent.run() 内部自动触发
    if not hasattr(agent, '_done_fired') and hasattr(agent, 'history'):
        agent.history.save_to_file(str(output_path))
except Exception as e:
    emit_json({"event": "phase_error", ...})

# 累积到案例级轨迹文件
if output_path.exists():
    with open(output_path, 'r') as f:
        step = json.load(f)
    step_history = step.get('history', [])
    if step_history:
        if cumulative_path.exists():
            with open(cumulative_path, 'r') as f:
                cum = json.load(f)
        else:
            cum = {'history': []}
        cum['history'].extend(step_history)
        with open(cumulative_path, 'w') as f:
            json.dump(cum, f)
    # cumulative_path 直接作为案例级轨迹文件，Save Trajectory 时无需间接引用

emit_json({"event": "phase_done", "data": {"trajectory_file": str(output_path), ...}})
# ↓ Agent 在下一次循环迭代中被覆盖（生命周期结束）
```

**Save Trajectory 的完整链路（用户触发时）：**

```
用户点击 [Save Trajectory]
  ↓
POST /api/browser/session/:id/trajectory
  ↓ Node.js 向 global stdin 写入 {"event":"save_trajectory"}
  ↓
Python run_session() 收到命令:
    shutil.copy(cumulative_path, trajectory_path)   ← copy 案例级累积文件
    with open(trajectory_path, 'r') as f:
        data = json.load(f)
        steps_count = len(data.get('history', []))  ← 全部已执行阶段的 ActionHistory 总数
    emit_json({"event":"save_trajectory_result", "data":{"trajectory_file": ...}})
  ↓
Node.js 收到结果:
    saveTrajectoryRecord({ sourcePath: trajectory_path, ... })
      → copy 到 scripts/trajectories/{trajectoryId}.json
      → 更新 index.json
      → 删除临时文件
  ↓
返回 trajectoryId 给前端
```

| 时机 | 做什么 | Agent 状态 |
|------|--------|-----------|
| `agent.run()` 执行中 | history 在内存中累积 | alive |
| `agent.run()` 完成 → 回调触发 | step 级文件写入 `/tmp/` | alive（即将销毁） |
| 累积阶段：读取 step 级文件 → 追加到 `cumulative_path` | 案例级文件更新 | alive |
| `emit_json(phase_done)` | 通知前端 | alive |
| 回到循环顶 `for` → `Agent(...)` | 创建新 Agent，旧 Agent 被 GC | **销毁** |
| 用户点击 Save Trajectory | copy `cumulative_path`（含所有阶段历史）到永久存储 | Agent 已销毁，但文件还在 |

**关键结论：** 每步的 ActionHistory 先落盘为 step 级临时文件，再追加到 `cumulative_path`（案例级累积文件）。Agent 销毁后累积文件仍在，Save Trajectory 保存的是完整案例轨迹，而非单步片段。

---

## API 汇总

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/browser/session` | 创建浏览器会话 |
| POST | `/api/browser/session/:id/step` | 执行子任务（SSE 流式） |
| DELETE | `/api/browser/session/:id` | 归档会话到执行记录 |
| GET | `/api/browser/session/:id/trajectories` | 获取会话步骤列表 |
| POST | `/api/browser/session/:id/trajectory` | 按需生成轨迹 |
| POST | `/api/browser/session/:id/reset-trajectory` | 重置累积轨迹文件路径（重新录制） |
| GET | `/api/browser/sessions` | 列出活跃 session |
| DELETE | `/api/browser/browser` | 关闭全局 Chrome |
| GET | `/api/browser/session/execution-records` | 列出执行记录 |
| GET | `/api/browser/session/execution-record/:sessionId` | 查看执行记录详情 |
| DELETE | `/api/browser/session/execution-record/:sessionId` | 删除执行记录 |
