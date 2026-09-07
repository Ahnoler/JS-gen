# 需求生成草稿向导（前端）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在录制列表提供「需求生成草稿」四步向导，对接已有 `draft-traj/propose|commit`，让用户勾选原子后仅创建 draft 交易。

**Architecture:** JS-gen 小补 `listReqModules` 带上 `hasThroughChains`；Vue 仓新增 `api/kb.ts` + 子路由向导页（单文件或薄拆分）+ 录制列表入口。状态机用页面内 `ref`（step 1–4），不引入新 store。`functionId` 来自 `appStore.selectedFunction`，经 `functionIdOverrides` 提交。

**Tech Stack:** Vue 3 + TypeScript + Element Plus + Pinia + Vue Router；控制面 `/api/v2/kb/*`；前端无 vitest——门闩为 `npm run build`（vue-tsc）+ 对接本机 4097 手工冒烟。

**Spec:** [`docs/superpowers/specs/2026-09-08-req-draft-wizard-ui-design.md`](../specs/2026-09-08-req-draft-wizard-ui-design.md)

## Global Constraints

- 按钮文案固定：**需求生成草稿**（非「交易生成」）
- 入口仅录制列表；**禁止**改系统树配置页
- 作业区语义 = `moduleKey`；**禁止**把系统树模块节点当作业区
- 默认原子 **全不选**；至少勾 1 条才可 commit
- `functionIdOverrides`：**每个**勾选 atomKey 都必须写入选定 functionId（不依赖 `suggestedFunctionId`）
- **禁止**调用 prepare / record/start / detach
- 本版 **不**做 chainIds UI（propose 不传 chainIds，仅 `maxAtoms`）；不映射系统树
- 双仓：Task 1 在 `D:/dev/JS-gen`；Task 2+ 在 `D:/dev/ui-auto-recording-agent-vue-master/vue-project`
- 每 Task 结束在**对应仓库**单独 commit；不混提无关 WIP

---

## File map

| 文件 | 职责 |
|------|------|
| `JS-gen/src/services/kb-req-modules.js` | `listReqModules` 附加 `hasThroughChains` |
| `JS-gen/src/dashboard/api-docs/groups/kb.js` | 列表响应示例补字段 |
| `JS-gen/scripts/characterization/`（小测或扩现有） | pin 列表含 `hasThroughChains` |
| `vue-project/src/api/kb.ts` | KB 类型 + list/get/propose/commit |
| `vue-project/src/router/index.ts` | 注册 `/ui-recording/req-draft-wizard` |
| `vue-project/src/views/ui-recording/req-draft-wizard/index.vue` | 四步向导主页面 |
| `vue-project/src/views/ui-recording/index.vue` | 顶栏入口按钮 |

---

### Task 1: 列表返回 `hasThroughChains`（JS-gen）

**Files:**
- Modify: `src/services/kb-req-modules.js`（`listReqModules`）
- Modify: `src/dashboard/api-docs/groups/kb.js`（GET list 示例）
- Create or Modify: `scripts/characterization/characterize-kb-req-modules-list.mjs`（若已有相关测则扩展）

**Interfaces:**
- Produces: `listReqModules()` 每行含 `hasThroughChains: boolean`（与 `getReqModule` 同语义：`through-chains.md` 是否存在）

- [ ] **Step 1: 改 `listReqModules`**

在读取每个 manifest 后探测文件：

```javascript
// inside listReqModules loop, after reading manifest:
rows.push({
  ...manifest,
  hasThroughChains: await pathExists(join(root, ent.name, 'through-chains.md')),
});
```

确保 `pathExists` 已在同文件可用（已有私有函数）。

- [ ] **Step 2: 更新 api-docs 示例**

`GET /api/v2/kb/req-modules` 的 `rows[]` 示例增加 `"hasThroughChains": true`。

- [ ] **Step 3: characterization**

最小断言：`listReqModules` 源码含 `hasThroughChains`，或对 fixture 目录跑 list（若现有 fixture 不便，则 source pin + `node --check`）。

Run: `node scripts/characterization/characterize-kb-req-modules-list.mjs`（或你新建的文件名）  
Expected: OK / exit 0

- [ ] **Step 4: Commit（仅 JS-gen）**

```bash
git add src/services/kb-req-modules.js src/dashboard/api-docs/groups/kb.js scripts/characterization/...
git commit -m "feat(kb): listReqModules includes hasThroughChains for draft wizard"
```

---

### Task 2: Vue API 封装 `src/api/kb.ts`

**Files:**
- Create: `src/api/kb.ts`（路径相对 vue-project）

**Interfaces:**
- Consumes: `@/api/request` 的 `get` / `post`（已解包 `res.data`）
- Produces:
  - `listReqModules(): Promise<{ rows: ReqModuleListItem[] }>`
  - `getReqModule(moduleKey: string): Promise<ReqModuleDetail>`
  - `proposeDraftTrajectories(moduleKey, body?): Promise<{ atoms: DraftAtom[]; rejected?: RejectedAtom[] }>`
  - `commitDraftTrajectories(moduleKey, body): Promise<{ created: CreatedDraft[]; skipped: SkippedDraft[] }>`

- [ ] **Step 1: 写入类型与函数**

```typescript
import { get, post } from './request'

export interface ReqModuleListItem {
  moduleKey: string
  moduleName: string
  sourcePath: string
  status: string
  hasThroughChains?: boolean
  warnings?: string[]
}

export interface DraftAtom {
  atomKey: string
  title: string
  suggestedFunctionId: number | null
  sourceDoc: string
  sourceChapter: string
  taskDraft: string
  phaseHints?: string[]
  wetTestHint?: string
}

export interface RejectedAtom {
  atomKey?: string
  reason: string
}

export interface CreatedDraft {
  trajectoryId: number
  atomKey: string
  name: string
}

export interface SkippedDraft {
  atomKey: string
  reason: string
}

export function listReqModules() {
  return get<{ rows: ReqModuleListItem[] }>('/v2/kb/req-modules')
}

export function getReqModule(moduleKey: string) {
  return get<ReqModuleListItem & { hasThroughChains: boolean; hasChapters: boolean; draftCount: number }>(
    `/v2/kb/req-modules/${encodeURIComponent(moduleKey)}`,
  )
}

export function proposeDraftTrajectories(
  moduleKey: string,
  body: { chainIds?: string[]; maxAtoms?: number } = {},
) {
  return post<{ atoms: DraftAtom[]; rejected?: RejectedAtom[] }>(
    `/v2/kb/req-modules/${encodeURIComponent(moduleKey)}/draft-traj/propose`,
    body,
    { timeout: 180000, timeoutLabel: '生成候选' },
  )
}

export function commitDraftTrajectories(
  moduleKey: string,
  body: {
    atomKeys: string[]
    systemAccountId?: number
    functionIdOverrides: Record<string, number>
    force?: boolean
  },
) {
  return post<{ created: CreatedDraft[]; skipped: SkippedDraft[] }>(
    `/v2/kb/req-modules/${encodeURIComponent(moduleKey)}/draft-traj/commit`,
    body,
    { timeout: 180000, timeoutLabel: '创建草稿' },
  )
}
```

（若项目 `get/post` 签名无 `timeoutLabel`，对照 `recording.ts` 现有 AI 调用写法对齐。）

- [ ] **Step 2: 类型检查**

Run: `npm run build`  
Expected: 无因 `kb.ts` 引起的 tsc 错误（可先只保证该文件被编译；整仓原有错误不在本任务范围则记下）。

- [ ] **Step 3: Commit（vue-project）**

```bash
git add src/api/kb.ts
git commit -m "feat(api): add kb req-modules draft-traj client"
```

---

### Task 3: 路由 + 向导壳（步骤条）

**Files:**
- Modify: `src/router/index.ts`
- Create: `src/views/ui-recording/req-draft-wizard/index.vue`

**Interfaces:**
- Produces: 命名路由 `ReqDraftWizard`，path `req-draft-wizard`（挂在 `/ui-recording` 下或与 detail 同级均可；推荐与 detail 同级以免列表 layout 侧栏干扰——**采用与 detail 相同的 Layout 模式，meta.layout 可用 `default` 保留侧栏以便读 selectedFunction**）

推荐路由片段：

```typescript
{
  path: '/ui-recording/req-draft-wizard',
  name: 'ReqDraftWizard',
  component: () => import('@/layouts/Layout.vue'),
  meta: { layout: 'default' },
  children: [
    {
      path: '',
      name: 'ReqDraftWizardPage',
      component: () => import('@/views/ui-recording/req-draft-wizard/index.vue'),
    },
  ],
},
```

- [ ] **Step 1: 注册路由**

- [ ] **Step 2: 创建向导壳**

`index.vue` 内状态：

```typescript
const step = ref<1 | 2 | 3 | 4>(1)
const moduleKey = ref('')
const moduleName = ref('')
const maxAtoms = ref(20)
const atoms = ref<DraftAtom[]>([])
const rejected = ref<RejectedAtom[]>([])
const selectedKeys = ref<string[]>([])
const force = ref(false)
const commitResult = ref<{ created: CreatedDraft[]; skipped: SkippedDraft[] } | null>(null)
```

模板：`el-steps` 四步标题「选作业区 / 生成候选 / 勾选确认 / 结果」；`v-show` 按 `step` 切换四个面板占位（下任务填满）。顶栏返回：`router.push('/ui-recording')`。

- [ ] **Step 3: `npm run build` 过路由与空页**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(ui-recording): scaffold req-draft-wizard route and shell"
```

---

### Task 4: 步骤① 选作业区

**Files:**
- Modify: `src/views/ui-recording/req-draft-wizard/index.vue`

**Interfaces:**
- Consumes: `listReqModules`
- Produces: 用户确认后设置 `moduleKey` / `moduleName`，`step = 2` 并触发 propose（或进入②再点生成——规格为①点「生成候选」即调 propose，可直接进入②并 loading）

- [ ] **Step 1: 实现① UI**

- `onMounted` → `listReqModules()`；空列表空态文案：「暂无已登记需求作业区；请先完成需求切片登记。」
- `el-table` 单选：`moduleName`、`moduleKey`、`hasThroughChains`（否 → 行 `selectable` false 或禁用 radio + tooltip「缺少贯通主链，无法生成」）
- 高级折叠：`maxAtoms` number input，默认 20
- 按钮「生成候选」：无选中或选中无 chains → disabled；点击后 `step=2`，调用 propose（见 Task 5 可同 commit 一并，或本步只设 key、② 内自动 propose）

推荐：① 点按钮 → `step=2` + 立即 `runPropose()`。

- [ ] **Step 2: 手工/类型检查**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(req-draft-wizard): step1 select req module"
```

---

### Task 5: 步骤② propose 表 + rejected

**Files:**
- Modify: `src/views/ui-recording/req-draft-wizard/index.vue`

- [ ] **Step 1: `runPropose`**

```typescript
async function runPropose() {
  proposing.value = true
  try {
    const data = await proposeDraftTrajectories(moduleKey.value, { maxAtoms: maxAtoms.value })
    atoms.value = data.atoms || []
    rejected.value = data.rejected || []
    selectedKeys.value = [] // 默认全不选
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '生成失败，请重试')
  } finally {
    proposing.value = false
  }
}
```

- 表格列：title、缩短 sourceChapter（`split('#')[0]` 或截断 40 字）、sourceDoc basename
- `el-table` expand：`taskDraft`（pre-wrap）、`phaseHints` tags
- rejected：`el-collapse` 只读
- 提示文案：「尚未创建交易；请进入下一步勾选后再确认。」
- 「重新生成」→ `runPropose`（loading 锁按钮）
- 「下一步」：`atoms.length === 0` 则 disabled；否则 `step = 3`

- [ ] **Step 2: build + 可选对接 4097 对 product-mgmt 冒烟 propose**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(req-draft-wizard): step2 propose atoms table"
```

---

### Task 6: 步骤③ 勾选 + functionId / 账号 / force

**Files:**
- Modify: `src/views/ui-recording/req-draft-wizard/index.vue`
- 可读参考: `src/views/ui-recording/components/RecordingDialog.vue`（账号/功能校验文案）
- Consumes: `useAppStore().selectedFunction`、`appStore.accounts`（列表页已有加载账号逻辑；向导 `onMounted` 若 accounts 空且已有 selectedSystem，则 `getSystemAccounts`）

- [ ] **Step 1: 勾选表**

- `el-table` `type="selection"`，`reserve-selection`；默认不选
- 「全选 / 清空」按钮操作 `selectedKeys`
- `functionId`：显示当前 `selectedFunction` 名称；若无，`ElMessage` + 禁用提交：「请先在左侧选择功能节点」
- 账号：`el-select` 绑定 `systemAccountId`，选项 `appStore.accounts`，默认可 `accounts[0]?.id`
- 高级：`el-switch` force，默认 false
- 「创建草稿交易」：校验 `selectedKeys.length >= 1` 且 `functionId` 有值 → 调 commit（Task 7）

- [ ] **Step 2: build**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(req-draft-wizard): step3 atom selection and function binding"
```

---

### Task 7: 步骤④ commit 结果页

**Files:**
- Modify: `src/views/ui-recording/req-draft-wizard/index.vue`

- [ ] **Step 1: `runCommit`**

```typescript
async function runCommit() {
  const fnId = appStore.selectedFunction?.id
  if (!fnId) {
    ElMessage.warning('请先在左侧选择功能节点')
    return
  }
  if (!selectedKeys.value.length) {
    ElMessage.warning('请至少勾选一个原子')
    return
  }
  const functionIdOverrides: Record<string, number> = {}
  for (const key of selectedKeys.value) {
    functionIdOverrides[key] = fnId
  }
  committing.value = true
  try {
    const data = await commitDraftTrajectories(moduleKey.value, {
      atomKeys: selectedKeys.value,
      systemAccountId: systemAccountId.value || undefined,
      functionIdOverrides,
      force: force.value,
    })
    commitResult.value = data
    step.value = 4
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '创建失败')
  } finally {
    committing.value = false
  }
}
```

- ④ UI：created 表格（name、trajectoryId、按钮 `router.push(\`/ui-recording/detail/${id}\`)`）；skipped 表格（atomKey、中文原因映射：`duplicate_draft`→「已存在同原子草稿」等）
- 「返回录制列表」→ `/ui-recording`
- 「继续生成」→ 重置状态 `step=1`，清空 atoms/selection/result

- [ ] **Step 2: build**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(req-draft-wizard): step4 commit drafts and result view"
```

---

### Task 8: 录制列表入口按钮

**Files:**
- Modify: `src/views/ui-recording/index.vue`（`list-actions` 区域，约 L388–401）

- [ ] **Step 1: 加按钮**

在「添加交易录制」旁（或其后）：

```vue
<el-button @click="router.push('/ui-recording/req-draft-wizard')">
  需求生成草稿
</el-button>
```

（按现有按钮风格可加 Iconfont；文案不可改。）

- [ ] **Step 2: build**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(ui-recording): entry button for req draft wizard"
```

---

### Task 9: 端到端冒烟（手工，写进报告）

**Files:**
- Create（可选）: `vue-project` 或 JS-gen `tmp/req-draft-traj/through-report-wizard-ui.md`

- [ ] **Step 1: 前置**

控制面 4097 已加载含 Task 1 的代码；前端 `npm run dev`；左侧树选中产品库功能节点（如 9000000740）；账号可用。

- [ ] **Step 2: 走通**

1. 录制列表点「需求生成草稿」
2. 选 `product-mgmt` → 生成候选 → 见 atoms，无概述挂错抽查
3. 不勾选时创建按钮不可用
4. 勾 1～2 条 → 创建 → ④ 有 trajectoryId → 打开详情为 draft
5. DevTools 网络：**无** prepare/record

- [ ] **Step 3: 更新 JS-gen todo ⑧「SPA 勾选」为已交付（若入口已上）并 commit 文档（JS-gen）

---

## Spec coverage (self-review)

| Spec 项 | Task |
|---------|------|
| 录制列表入口文案 | 8 |
| 四步向导 | 3–7 |
| list + hasThroughChains 禁用 | 1, 4 |
| propose / rejected / 默认不选 | 5–6 |
| functionIdOverrides 全覆盖 | 7 |
| force / 账号 | 6–7 |
| 结果 created/skipped / 打开详情 | 7 |
| 不调录制 API | 7（代码路径无调用）+ 9 验证 |
| 不做系统树入口 / chainIds UI | Global Constraints |
| 空态文案 | 4 |

## Placeholder scan

无 TBD；chainIds UI 明确本版不做。

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-09-08-req-draft-wizard-ui.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每 Task 新开子智能体，Task 间审查  
2. **Inline Execution** — 本会话按 executing-plans 连续做

**Which approach?**
