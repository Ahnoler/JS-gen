# 前后端状态流转冲突修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 record_status v2 的前后端冲突：前端 UI 状态机升级为六态（含 occupy 纯观看占位、recorded/failed 独立态）+ aiActive 推导，后端步骤编辑/移动闸对齐「AI 活跃才 409」，并清理错文案与死代码。

**Architecture:** `recordStatusToUi(recordStatus, aiActive)` 一处映射后端五态 → 前端六态；`aiActive = tree.phases.some(p => p.status === 'running')`；StepsPanel/RemoteBrowser 按 UI 态渲染；后端 `assertNotBusyForStepEdit` 改 `isAiRecordingActive` 判定。

**Tech Stack:** Vue 3 + TS（vue-project 另仓）、Node ESM（JS-gen）、characterization 断言、vue-tsc。

**Spec:** `docs/superpowers/specs/2026-08-16-record-status-frontend-sync-fix-design.md`（6 条 Locked decisions 为准）。

## Global Constraints

- UI 六态（逐字）：`'idle' | 'occupy' | 'recording' | 'draft' | 'recorded' | 'confirmed' | 'failed'`——occupy=纯观看占位（recording 且非 AI 活跃）、recording=AI 真在录、recorded=待确认、confirmed=已确认、failed=录制异常、draft=未录制、idle=未知兜底。
- 映射（逐字）：`aiActive → 'recording'`；`recording && !aiActive → 'occupy'`；`draft→'draft'`；`failed→'failed'`；`recorded→'recorded'`；`completed→'confirmed'`；其它→`'idle'`。
- 组件规则（spec Component rules 表）：recorded 无「重新录制/开始录制」；draft 维持显示「人工确认」（Q2=B）；failed/occupy 无人工确认；occupy 可清空/编辑；仅 `ui==='recording'` 全锁。
- `aiActive = (tree.value?.phases || []).some(p => p?.status === 'running')`（TrajectoryPhase.status 类型存在）。
- 后端：`assertNotBusyForStepEdit` 改为「`recording` 且 AI 活跃」才 409（纯观看占位放开步骤编辑/移动）；文案「Cannot move steps while AI recording」不变；确认闸/推送闸/record-start 闸不动。
- **未提交他方改动保护**：`vue-project` 工作区存在另一会话未提交 hunk（StepsPanel.vue「空阶段添加步骤」、detail/index.vue 配合、另有 components.d.ts/sso.ts/vite.config.ts/yarn.lock）——一律不改写、不提交；实现子智能体只在目标文件内做自己的插入，报告里标明自己 hunk 的范围。
- 每任务 commit 由主线程执行；JS-gen 与 Vue 仓分别提交，不 push。
- 四件套：JS-gen 改 `src/services/` 需 CHANGELOG（Task 1 一并）；Vue 仓改动无需 JS-gen CHANGELOG。

## File Structure

| 文件 | 职责 |
|---|---|
| JS-gen `trajectory-step-service.js` | `assertNotBusyForStepEdit` 改 async + `isAiRecordingActive` |
| JS-gen `routes/v2/trajectory-record.js` | 两处注释勘正 |
| JS-gen `api-docs/groups/recording.js` | stop desc 勘正 |
| JS-gen `characterize-step-move.mjs` / `characterize-record-status-v2.mjs` | 钉子同步/新增 pin |
| JS-gen `CHANGELOG.md` | [Unreleased] 条目 |
| JS-gen v2 spec | 回放闸/step-move 闸条目勘正 |
| Vue `types/index.ts` | `RecordingStatus` 六态 |
| Vue `trajectory-tree.ts` | `recordStatusToUi` 新映射 |
| Vue `useRecordingStudio.ts` | `aiActive` computed、syncStatus、doStopRecord 同步 traj、toast 文案 |
| Vue `api/recording.ts` | L393 注释勘正 |
| Vue `StepsPanel.vue` | 底部操作区按 UI 态分支 |
| Vue `RemoteBrowser.vue` | 指示器按 UI 态分支 |
| Vue `useRecordingState.ts` | 删除（死代码） |

---

### Task 1: 后端闸门对齐 + 文案勘正 + 钉子 + CHANGELOG（JS-gen）

**Files:**
- Modify: `src/services/trajectory/trajectory-step-service.js`
- Modify: `src/routes/v2/trajectory-record.js:71,85`
- Modify: `src/dashboard/api-docs/groups/recording.js:77`
- Modify: `scripts/characterization/characterize-step-move.mjs`
- Modify: `scripts/characterization/characterize-record-status-v2.mjs`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `isAiRecordingActive`（`src/services/trajectory/trajectory-status-utils.js`，已存在）
- Produces: 步骤编辑/移动闸语义 = AI 活跃才 409（Task 3 前端与之一致）

- [ ] **Step 1: step-service 闸门改 async AI-active**

`src/services/trajectory/trajectory-step-service.js`：
1. 顶部 import 区（`getTrajectoryRuntime` 等 import 附近）加：

```js
import { isAiRecordingActive } from './trajectory-status-utils.js';
```

（该文件在 `src/services/trajectory/`，相对路径 `./trajectory-status-utils.js`；若既有 import 用 `../` 前缀以实际文件为准。）
2. `assertNotBusyForStepEdit`（约 L235-254）替换为：

```js
async function assertNotBusyForStepEdit(trajectoryId, traj) {
  const tid = Number(trajectoryId);
  if (traj?.recordStatus === 'recording' && (await isAiRecordingActive(tid))) {
    const err = new Error('Cannot move steps while AI recording');
    err.statusCode = 409;
    throw err;
  }
  const runtime = getTrajectoryRuntime(tid);
  if (runtime?.manualRecording) {
    const err = new Error('Cannot move steps while manual recording');
    err.statusCode = 409;
    throw err;
  }
  const session = runtime?.sessionId ? state.sessions.get(runtime.sessionId) : null;
  if (session?.busy) {
    const err = new Error('Cannot move steps while session is busy');
    err.statusCode = 409;
    throw err;
  }
}
```

3. 全部调用点补 `await`：grep `assertNotBusyForStepEdit(`，每个调用改为 `await assertNotBusyForStepEdit(`（`moveTrajectoryStep` 约 L269 至少一处；若 update/remove 步骤也调用，一并改——语义一致：纯观看占位放开编辑）。

- [ ] **Step 2: 两处路由注释 + api-docs stop 勘正**

1. `src/routes/v2/trajectory-record.js:71`：`Body: { success?: boolean } default true → recorded; false → draft` → `Body: { success?: boolean } default true → recorded; false → failed`
2. `src/routes/v2/trajectory-record.js:85`：`Body: { confirmed: boolean } — true → recordStatus=completed; false → draft.` → `Body: { confirmed: boolean } — true → recordStatus=completed; false → recorded.`
3. `src/dashboard/api-docs/groups/recording.js:77`：`desc: 'success=true → recordStatus=recorded；false → draft。…'` → `desc: 'success=true → recordStatus=recorded；false → failed。…'`（其余文字不动）。

- [ ] **Step 3: 钉子同步 + 新 pin**

1. `scripts/characterization/characterize-step-move.mjs`：先 read 全文，把所有断言「step 编辑/移动闸=recordStatus recording 直接 409」的部分改为与 async AI-active 闸一致（例如子串 `traj?.recordStatus === 'recording'` 的断言改为 `traj?.recordStatus === 'recording' && (await isAiRecordingActive(tid))`；若有直接调用该函数的断言，给调用点补 `await`）。保留对 409 文案「Cannot move steps while AI recording」的断言。
2. `scripts/characterization/characterize-record-status-v2.mjs`：在 `const failedCount = failed;` 之前追加：

```js
  run('step edit/move gate: AI-active only', () => {
    const svc = readFileSync(join(ROOT, 'src', 'services', 'trajectory', 'trajectory-step-service.js'), 'utf8');
    assert.ok(svc.includes("traj?.recordStatus === 'recording' && (await isAiRecordingActive(tid))"), 'gate uses AI-active check');
    assert.ok(svc.includes('await assertNotBusyForStepEdit('), 'call sites await the async guard');
  });
```

- [ ] **Step 4: CHANGELOG [Unreleased] Added 条目**

在 `CHANGELOG.md` `## [Unreleased]` 第一个 `### Added` 区顶部插入：

```markdown
- 2026-08-16: **步骤编辑/移动闸对齐 AI 活跃**：纯观看占位（recordStatus=recording 且非 AI 录制）放开步骤编辑/移动与清空；仅 AI 录制活跃（phase.status='running'）时 409。确认/推送/record-start 闸不变。
  影响范围：步骤编辑/移动/清空的闸门语义（对纯观看占位从 409 变为放行）。
  文件：src/services/trajectory/trajectory-step-service.js, src/routes/v2/trajectory-record.js, src/dashboard/api-docs/groups/recording.js, scripts/characterization/characterize-step-move.mjs, scripts/characterization/characterize-record-status-v2.mjs
  Python 同步提示：无 HTTP/schema。代理侧若实现步骤编辑闸，按「AI 录制活跃才 409」对齐（纯推流占用放行）。
```

- [ ] **Step 5: 验证**

Run:
```
node --check src/services/trajectory/trajectory-step-service.js
node --check src/routes/v2/trajectory-record.js
node --check src/dashboard/api-docs/groups/recording.js
node scripts/characterization/characterize-record-status-v2.mjs
node scripts/characterization/characterize-step-move.mjs
node scripts/characterization/characterize-trajectory.mjs
& "C:\Program Files\Git\bin\bash.exe" scripts/refactor/verify-all.sh
```
Expected: 全部 exit 0 / ALL GREEN。任何失败先修再报。

- [ ] **Step 6: 报告**

报告写入 `.superpowers/sdd/2026-08-16-record-status-frontend-sync-fix/task-1-report.md`（主线程会先建目录）：每步改动前后、命令原始输出、偏差。

---

### Task 2: 前端状态核心（types / 映射 / composable）

**Files:**
- Modify: `vue-project/src/types/index.ts:33`
- Modify: `vue-project/src/utils/trajectory-tree.ts:147-155`
- Modify: `vue-project/src/composables/useRecordingStudio.ts`（syncStatus L89-98、doStopRecord L395-401、doStartAi toast L346）
- Modify: `vue-project/src/api/recording.ts:393`（注释）

**Interfaces:**
- Consumes: 后端五态 + `TrajectoryPhase.status`（已存在）
- Produces: `RecordingStatus` 六态、`recordStatusToUi(recordStatus, aiActive)`、`aiActive` computed（Task 3 消费）

- [ ] **Step 1: RecordingStatus 六态**

`vue-project/src/types/index.ts:33` 替换：

```ts
export type RecordingStatus = 'idle' | 'occupy' | 'recording' | 'draft' | 'recorded' | 'confirmed' | 'failed'
```

- [ ] **Step 2: recordStatusToUi 新映射**

`vue-project/src/utils/trajectory-tree.ts:147-155` 替换：

```ts
// 将后端录制状态转换为前端 UI 状态
// aiActive = 存在 running 阶段（AI 真在录）；纯观看占位（recording 且非 AI 活跃）→ occupy
export function recordStatusToUi(status: string | undefined, aiActive = false): RecordingStatus {
  if (aiActive) return 'recording'
  switch (status) {
    case 'recording': return 'occupy'
    case 'failed': return 'failed'
    case 'recorded': return 'recorded'
    case 'completed': return 'confirmed'
    case 'draft': return 'draft'
    default: return 'idle'
  }
}
```

- [ ] **Step 3: useRecordingStudio 的 aiActive + syncStatus + doStopRecord + toast**

`vue-project/src/composables/useRecordingStudio.ts`：
1. 在 `const recordingStatus = shallowRef<RecordingStatus>('idle')`（L69）之后加：

```ts
  /** 后端 AI 是否真在录制：tree 中存在 running 阶段（持久信号，跨会话/刷新准确） */
  const aiActive = computed(() =>
    (tree.value?.phases || []).some((p) => p?.status === 'running'),
  )
```

2. `syncStatus`（L89-98）替换为：

```ts
  // 根据当前手动/自动录制状态，同步 UI 展示的录制状态
  function syncStatus() {
    if (manualOn.value || aiBusy.value) {
      recordingStatus.value = 'recording'
      return
    }
    recordingStatus.value = recordStatusToUi(
      tree.value?.recordStatus || traj.value?.recordStatus,
      aiActive.value,
    )
  }
```

3. `doStopRecord`（L395-401）在 `tree.value = data.tree` 之后加 `traj` 同步（与 doConfirm/doClearSteps 模式一致）：

```ts
      tree.value = data.tree
      if (traj.value) {
        traj.value = { ...traj.value, recordStatus: data.recordStatus }
      }
```

4. `doStartAi` toast（L346）：`ElMessage.success('AI 录制完成')` → `ElMessage.success('AI 录制结束')`。

5. 确认 `computed` 已在该文件 import（顶部 `import { ref, shallowRef, computed } from 'vue'` 若无 `computed` 则补上——以实际 import 行为准）。

- [ ] **Step 4: api 注释勘正**

`vue-project/src/api/recording.ts:393` 注释里 `false → draft` 改为 `false → recorded（回待确认）`（先 read 该行确认原文，只改这一处措辞）。

- [ ] **Step 5: 类型检查**

Run: `cd D:\dev\ui-auto-recording-agent-vue-master\vue-project && npx vue-tsc --noEmit`
Expected: exit 0。既有 4 个未提交他方文件不碰不 stage。

- [ ] **Step 6: 报告**

报告写入 `.superpowers/sdd/2026-08-16-record-status-frontend-sync-fix/task-2-report.md`，并**列出自己每个 hunk 的行范围**（供主线程选择性 staging 参考）。

---

### Task 3: 前端组件渲染（StepsPanel / RemoteBrowser）

**Files:**
- Modify: `vue-project/src/views/ui-recording/detail/components/StepsPanel.vue`（底部操作区 L467-501+）
- Modify: `vue-project/src/views/ui-recording/detail/components/RemoteBrowser.vue`（指示器 L280-300）

**Interfaces:**
- Consumes: `RecordingStatus` 六态（Task 2）；`props.status` 现为 UI 六态、`props.recordStatus` 为后端原始值、`props.aiBusy/manualOn` 已有
- Produces: 按 UI 态渲染的按钮区（spec Component rules 表）

- [ ] **Step 1: StepsPanel 底部操作区按态分支**

`StepsPanel.vue` 的 `<!-- 底部操作区（重新录制/人工确认/清空步骤） -->` 块（L467-487 的 draft 模板部分）替换为：

```html
    <!-- 底部操作区（按 UI 态渲染） -->
    <div class="panel-footer">
      <template v-if="(props.status === 'draft' || props.status === 'occupy' || props.status === 'failed') && !isRecording">
        <el-button
          type="danger"
          plain
          :disabled="clearDisabled"
          @click="emit('clear-steps')"
        >
          {{ clearButtonLabel }}
        </el-button>
        <el-button @click="emit('re-record')">重新录制</el-button>
        <el-button
          v-if="props.status === 'draft'"
          type="primary"
          :disabled="!!aiBusy || !!manualOn"
          @click="emit('confirm')"
        >
          人工确认
        </el-button>
      </template>

      <template v-if="props.status === 'recorded'">
        <el-button
          type="danger"
          plain
          :disabled="clearDisabled"
          @click="emit('clear-steps')"
        >
          {{ clearButtonLabel }}
        </el-button>
        <el-button
          type="primary"
          :disabled="!!aiBusy || !!manualOn"
          @click="emit('confirm')"
        >
          人工确认
        </el-button>
      </template>
```

（说明：`isRecording`/`isDraft`/`isFailed`/`isConfirmed` computed 声明（L129-133）不动——`isRecording` 现在自动=仅 AI 活跃；`isConfirmed` 分支模板原样保留；`isDraft`/`isFailed` computed 若在新分支中不再使用会被 vue-tsc 报 unused 的话则删除对应声明，否则保留。`clearDisabled` 声明（L147-154）不动——`isRecording.value` 已等价于 AI 活跃。）

- [ ] **Step 2: 已确认文案 + 分支衔接**

1. L494 `已确认（录制完成）` → `已确认`。
2. 检查已确认分支 `v-if="isConfirmed"` 与其后 `</div>`/`</template>` 结构完整（新插入的两块 template 后接原 isConfirmed 块）。

- [ ] **Step 3: RemoteBrowser 指示器按态分支**

`RemoteBrowser.vue` L280-300 替换为：

```html
    <!-- 录制状态指示器（仅 AI 录制 tab） -->
<div class="recording-indicator">
      <template v-if="tab === 'ai' && status === 'recording'">
          <span class="status-dot recording"></span>
          <span class="status-text recording-text"  style="margin-right: 16px;" >录制中</span>

        <el-button class="record-status-btn" size="small" @click="emit('cancel-recording')">
          <IconfontButton name="icon-tingzhi" :size="12"></IconfontButton>
          <span style="margin-left: 2px;"> 取消录制</span>
        </el-button>
      </template>
      <template v-else-if="tab === 'ai' && (status === 'idle' || status === 'draft' || status === 'occupy' || status === 'failed')">
         <el-button
          class="record-status-btn" 
          @click="emit('start-recording')"
          size="small"
        >
          <IconfontButton name="icon-qiyong" :size="12"></IconfontButton>
          <span style="margin-left: 2px;"> 开始录制</span>
        </el-button>
      </template>
      <template v-else-if="tab === 'ai' && status === 'recorded'">
        <span class="status-dot success"></span>
        <span class="status-text" style="margin-right: 16px;">待确认</span>
      </template>
      <template v-else-if="tab === 'ai' && status === 'confirmed'">
        <span class="status-dot success"></span>
        <span class="status-text" style="margin-right: 16px;">已确认</span>
      </template>
    </div>
```

（`status-dot success` 类若不存在则用既有 `status-dot` 样式类；先 read 该组件 style 段确认类名，保持既有样式体系。）

- [ ] **Step 4: 类型检查**

Run: `cd D:\dev\ui-auto-recording-agent-vue-master\vue-project && npx vue-tsc --noEmit`
Expected: exit 0。他方未提交 hunk 不碰。

- [ ] **Step 5: 报告**

报告写入 `.superpowers/sdd/2026-08-16-record-status-frontend-sync-fix/task-3-report.md`，列出自己 hunk 行范围；**特别注明与另一会话「空阶段添加步骤」hunk 的相对位置**（是否相邻/重叠）。

---

### Task 4: 死代码删除 + v2 spec 勘正

**Files:**
- Delete: `vue-project/src/composables/useRecordingState.ts`
- Modify: `docs/superpowers/specs/2026-08-14-trajectory-record-status-v2-design.md`（回放闸/step-move 闸两条勘正）

**Interfaces:**
- Consumes: 无
- Produces: 文档与死代码清理

- [ ] **Step 1: 删除死代码（先最后确认无引用）**

Run（vue-project 目录）: `grep -rn "useRecordingState" src/ --include="*.ts" --include="*.vue"`
Expected: 仅命中 `src/composables/useRecordingState.ts` 自身。确认后删除该文件。若命中其它文件，停止并报告 BLOCKED。

- [ ] **Step 2: v2 spec 勘正两条**

`docs/superpowers/specs/2026-08-14-trajectory-record-status-v2-design.md`：
1. Transition matrix 的「回放闸」行（原 `| 回放闸 | live/recording 409 | recording 409（failed 可回放） | replay-service.js:36-45 |`）替换为：

```
| 回放闸 | live/recording 409 | assembled replay 栈已删（2026-08-16 勘正）：现行 steps/replay 无 recordStatus 闸——未 attach 400、session.busy(AI 录制中) 409 | trajectory-session-replay.js |
```

2. 「步骤移动闸」行替换为：

```
| 步骤编辑/移动闸 | recording 409 | **AI 录制活跃**（recording 且 phase running）→ 409；纯观看占位放开（2026-08-16 勘正） | trajectory-step-service.js assertNotBusyForStepEdit |
```

（先 read 该文件对应行确认原文格式，只替换这两行的语义部分。）

- [ ] **Step 3: 验证**

Run: `cd D:\dev\ui-auto-recording-agent-vue-master\vue-project && npx vue-tsc --noEmit`（确认删除无引用破坏）
Expected: exit 0。

- [ ] **Step 4: 报告**

报告写入 `.superpowers/sdd/2026-08-16-record-status-frontend-sync-fix/task-4-report.md`。

---

## 收尾（主线程）

- [ ] 按任务顺序审查 4 份报告；重跑 JS-gen `verify-all.sh` 与 Vue `vue-tsc`。
- [ ] 提交：JS-gen 分 Task 1 一组、Task 4 的 spec 一组；Vue 仓选择性 staging——只收 Task 2/3/4 自己的 hunk，**另一会话的未提交改动（StepsPanel 空阶段入口、detail/index.vue 配合、sso.ts/vite.config.ts/yarn.lock/components.d.ts）保持未提交**。若 StepsPanel/detail-index 的 hunk 无法与本次改动干净分离，按 Locked decision 5 先征询用户再提交。
- [ ] 手工冒烟清单（有环境时）：进详情页（prepare 占位）→ 显示「开始录制」；点开始 → 「录制中」全锁；停止标记失败 → 「录制异常」无人工确认按钮（traj 同步即时生效）；录制成功 → 「待确认」无重新录制；确认 → 「已确认」；取消确认 → 回「待确认」；占位态可清空/编辑步骤；AI 录制中步骤操作 409 toast。
