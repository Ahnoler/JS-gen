# Recording Coach Skill 四层收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `tools/recording-coach/skill/` 收成元数据 / LLM 指令 / 模板 / 三个薄脚手架四层包，服务功能湿测录制派发，不改录制引擎与 12 步管线语义。

**Architecture:** OpenCode 仍只加载 `skill/`。长文迁入 `references/`，填空迁入 `templates/`，`SKILL.md` 只留铁律。三个脚手架调现有 `createEvidenceDir` / `createTools` / `assertDispatchBrief`，并把目前藏在 `tools.mjs` 闭包里的 `assertBusinessTaskText` 抽到可复用模块。`src/` 管线工具不重写。

**Tech Stack:** Node ESM（`tools/recording-coach`）、现有 characterization cold pin（`node:assert/strict`）、`scripts/refactor/verify-all.sh` 登记。

**Spec:** [`../specs/2026-09-20-recording-coach-skill-pack-design.md`](../specs/2026-09-20-recording-coach-skill-pack-design.md)

**Source draft (read-only, do not write back):** [`../guides/2026-09-19-recording-coach-skill-draft.md`](../guides/2026-09-19-recording-coach-skill-draft.md)（仓库内副本；合约仓同名稿只读）

## Global Constraints

- 范围档 **B 偏瘦**：不大改 `src` 管线语义；不串联到 `start_record`。
- 加载面 **仅** `tools/recording-coach/skill/`；**禁止**新建 `.cursor/skills/` 副本。
- **禁止**改 Python 录制引擎、控制面产品 API、回写 `JS-gen-contract`。
- 脚手架失败非 0 退出；校验必须复用 `assertDispatchBrief` 与抽出后的 `assertBusinessTaskText`，禁止复制粘贴另一套规则。
- `preflight-probes` 的 `rating-credit` 路径表须标注「以 `/api/docs` 为准」；本版可先占位常量，错误仍走现有 `BLOCKED_前置未核`。
- 用户没要求就不要 commit。下面的 commit 步是检查点，默认跳过。
- 新 pin 注册到 `scripts/refactor/verify-all.sh` 中 `characterize-recording-coach-operator` 的下一行。
- 中文 commit message（若用户要求提交）。

## File map

| Path | Role |
|------|------|
| `tools/recording-coach/src/task-text.mjs` | **新建**：导出 `assertBusinessTaskText`（从 `tools.mjs` 抽出） |
| `tools/recording-coach/src/tools.mjs` | **修改**：改为 import `assertBusinessTaskText` |
| `tools/recording-coach/skill/SKILL.md` | **改写**：短指令 + frontmatter；指向 references/templates/scripts |
| `tools/recording-coach/skill/references/pipeline-pits.md` | **新建**：管线坑 |
| `tools/recording-coach/skill/references/acceptance.md` | **新建**：验收 / CREATED·REJECTED·BLOCKED |
| `tools/recording-coach/skill/references/stc-anchors.md` | **新建**：STC 实证锚点 |
| `tools/recording-coach/skill/templates/dispatch-brief.md` | **新建**：五段式模板（占位符） |
| `tools/recording-coach/skill/templates/task-text.md` | **新建**：业务门闩模板 |
| `tools/recording-coach/skill/templates/close.txt` | **新建**：五行 close 形态 |
| `tools/recording-coach/skill/templates/evidence-checklist.md` | **新建**：证据清单 |
| `tools/recording-coach/skill/scripts/init-evidence.mjs` | **新建**：建证据目录 |
| `tools/recording-coach/skill/scripts/scaffold-brief.mjs` | **新建**：填 brief + taskText |
| `tools/recording-coach/skill/scripts/preflight-probes.mjs` | **新建**：拼 probes，可选 `--run` |
| `tools/recording-coach/README.md` | **修改**：指向四层 |
| `tools/recording-coach/WET-CHECKLIST.md` | **修改**：指向四层 / 脚手架 |
| `scripts/characterization/cold/characterize-recording-coach-skill-pack.mjs` | **新建**：脚手架 + 抽出 assert + 文件存在 |
| `scripts/refactor/verify-all.sh` | **修改**：登记新 pin |

---

### Task 1: 抽出 `assertBusinessTaskText`

**Files:**
- Create: `tools/recording-coach/src/task-text.mjs`
- Modify: `tools/recording-coach/src/tools.mjs`（删除闭包内同名函数，改为 import）
- Test: 扩 `scripts/characterization/cold/characterize-recording-coach-operator.mjs`（本任务末尾断言；或先写入 Task 5 的新 pin——本任务在 operator pin 末尾、`console.log('OK')` 之前加断言）

**Interfaces:**
- Consumes: 无
- Produces: `export function assertBusinessTaskText(taskText: string): true` — 规则与今日 `tools.mjs` 一致：须含 `【硬性成功门闩`、`trim().length >= 80`、不得含 `POST /api/v2`、不得含 `curl`；否则 `throw new Error('taskText must be the business gate, not the operator runbook')`

- [ ] **Step 1: 在 operator pin 末尾写入失败断言（函数尚不存在于 `task-text.mjs`）**

在 `characterize-recording-coach-operator.mjs` 的最终 `console.log` 之前加入：

```js
import { assertBusinessTaskText } from '../../../tools/recording-coach/src/task-text.mjs';

assert.equal(
  assertBusinessTaskText('【硬性成功门闩——未满足不得 done】\n' + 'x'.repeat(80)),
  true,
);
assert.throws(() => assertBusinessTaskText('STC首行'), /taskText must be the business gate/);
assert.throws(
  () => assertBusinessTaskText('【硬性成功门闩】\n' + 'x'.repeat(80) + '\ncurl http://x'),
  /taskText must be the business gate/,
);
```

- [ ] **Step 2: 跑 pin 确认失败**

Run: `node scripts/characterization/cold/characterize-recording-coach-operator.mjs`  
Expected: FAIL（模块不存在或未导出）

- [ ] **Step 3: 实现 `task-text.mjs` 并改 `tools.mjs` import**

```js
// tools/recording-coach/src/task-text.mjs
/**
 * @param {string} taskText
 * @returns {true}
 */
export function assertBusinessTaskText(taskText) {
  const text = String(taskText || '').trim();
  if (
    !text.includes('【硬性成功门闩') ||
    text.length < 80 ||
    text.includes('POST /api/v2') ||
    text.includes('curl')
  ) {
    throw new Error('taskText must be the business gate, not the operator runbook');
  }
  return true;
}
```

`tools.mjs`：删除本地 `function assertBusinessTaskText`，顶部 `import { assertBusinessTaskText } from './task-text.mjs';`

- [ ] **Step 4: 再跑 pin**

Run: `node scripts/characterization/cold/characterize-recording-coach-operator.mjs`  
Expected: 打印 `OK`（或现有成功尾标）

- [ ] **Step 5: Commit（默认跳过）**

```bash
git add tools/recording-coach/src/task-text.mjs tools/recording-coach/src/tools.mjs scripts/characterization/cold/characterize-recording-coach-operator.mjs
git commit -m "refactor(coach): 抽出 assertBusinessTaskText 供脚手架复用"
```

---

### Task 2: references + templates 迁文

**Files:**
- Create: `tools/recording-coach/skill/references/{pipeline-pits,acceptance,stc-anchors}.md`
- Create: `tools/recording-coach/skill/templates/{dispatch-brief.md,task-text.md,close.txt,evidence-checklist.md}`
- Modify: 无（本任务不缩 SKILL，避免双真源窗口过长——Task 4 再缩）

**Interfaces:**
- Consumes: 现 `skill/SKILL.md`、仓库内 `docs/superpowers/guides/2026-09-19-recording-coach-skill-draft.md`
- Produces: 固定文件名如上；模板占位符统一用 `{{GOAL}}` `{{FUNCTION_ID}}` `{{SYSTEM_ACCOUNT_ID}}` `{{REF_TRAJ}}` `{{EVIDENCE_DIR}}` `{{BASE_URL}}` `{{PRODUCT_LABEL}}` `{{TASK_BODY}}`

- [ ] **Step 1: 写 `references/pipeline-pits.md`**

必须包含这些针（可用中文叙述）：`prepare` 超时 ≥600s 且只认 `ready===true`；`phaseIds` 必须是数据库数字 id；CDP 端口 `19242+slotIndex` 或 prepare 返回端口；`doneLogs` ~400 字截断 / `tailUnreliable`；`detach` 才释放槽位。

- [ ] **Step 2: 写 `references/acceptance.md`**

必须包含：看 `steps[]` 不看仅 `recordStatus`；假成功定义；`CREATED_` / `REJECTED_` / `BLOCKED_` / `ERROR`；诚实失败不得擅自重录；索引点击可能归一为 `click_table_row_radio`（看落库字段）。

- [ ] **Step 3: 写 `references/stc-anchors.md`**

从现 SKILL「STC 实证锚点」迁：`functionId` 9000000011、客户号示例、`row_text=first` + 结构 xpath、参考 traj 848/857/908；标明「示例，非万能 stamp」。

- [ ] **Step 4: 写四个 templates**

`dispatch-brief.md` 五个标题原文必须是：`固定参数` `业务目标` `风险预告` `管线步骤` `产出契约`（与 `assertDispatchBrief` 一致）。  
`task-text.md` 须以 `【硬性成功门闩` 开头骨架 + `{{TASK_BODY}}`。  
`close.txt` 五行：`结论：` / `报告：` / `证据1：` / `证据2：` / `证据3：`。  
`evidence-checklist.md`：列出 `workflow.json` `dispatch-brief.md` `poll-*.json` `traj-final.json` `close.txt` `through-report.md` 等。

- [ ] **Step 5: 冷检查文件存在**

Run:

```bash
node --input-type=module -e "import fs from 'fs'; const root='tools/recording-coach/skill'; for (const p of ['references/pipeline-pits.md','references/acceptance.md','references/stc-anchors.md','templates/dispatch-brief.md','templates/task-text.md','templates/close.txt','templates/evidence-checklist.md']) { if (!fs.existsSync(root+'/'+p)) { console.error('missing',p); process.exit(1);} } console.log('OK templates-references');"
```

Expected: `OK templates-references`

- [ ] **Step 6: Commit（默认跳过）**

```bash
git add tools/recording-coach/skill/references tools/recording-coach/skill/templates
git commit -m "docs(coach): skill references/templates 迁入四层包"
```

---

### Task 3: `init-evidence.mjs` + `scaffold-brief.mjs`

**Files:**
- Create: `tools/recording-coach/skill/scripts/init-evidence.mjs`
- Create: `tools/recording-coach/skill/scripts/scaffold-brief.mjs`
- Test: 本任务用临时目录手工命令；正式 pin 在 Task 5

**Interfaces:**
- Consumes: `createEvidenceDir` from `../../src/workflow.mjs`；`assertDispatchBrief`；`assertBusinessTaskText`；templates 目录（相对 `import.meta.url` 解析 `../templates`）
- Produces:
  - `init-evidence.mjs` CLI：`--repo` `--label` `--help`；stdout 含 `evidenceDir=`
  - `scaffold-brief.mjs` CLI：`--evidence` `--goal` `--function-id` `--account-id` `--ref-traj` `--task-file` `--product-label` `--apply` `--help`；stdout JSON `{ ok, evidenceDir, dispatchBriefPath, taskTextPath }`

- [ ] **Step 1: 实现 `init-evidence.mjs`**

解析 argv；`--help` 打印用法 exit 0。默认 `repo` = 从 `import.meta.url` 向上找到含 `tools/recording-coach` 的仓库根。调用 `createEvidenceDir(repo)`；若 `--label` 则写 `hypothesis.txt` 一行；拷贝 `../templates/evidence-checklist.md` 到证据目录（可选 rename 保持同名）。最后 `console.log('evidenceDir=' + evidenceDir)`。

- [ ] **Step 2: 干跑 init**

Run: `node tools/recording-coach/skill/scripts/init-evidence.mjs --label skill-pack-smoke`  
Expected: 打印 `evidenceDir=...`；该目录存在 `workflow.json`。

- [ ] **Step 3: 实现 `scaffold-brief.mjs`**

读 templates；用简单 `{{KEY}}` 替换生成 brief 与 task 文件（task 文件名 `task-text.md`）。调用 `assertDispatchBrief` / `assertBusinessTaskText`。默认不 `--apply`。`--apply` 时：`createTools({ evidenceDir, baseUrl })` → `save_dispatch_brief` → `mark_inputs_ready`（字段从 CLI 来；`businessProbeRequired: false` 除非另有 flag——本版不加 flag，固定 false）。

- [ ] **Step 4: 干跑 scaffold（无 HTTP apply）**

准备临时 task 文件（≥80 字含硬性门闩），对 Step 2 的 evidenceDir 跑 scaffold。  
Expected: exit 0；JSON `ok:true`；`assertDispatchBrief` 能通过读入的 brief。

- [ ] **Step 5: Commit（默认跳过）**

```bash
git add tools/recording-coach/skill/scripts/init-evidence.mjs tools/recording-coach/skill/scripts/scaffold-brief.mjs
git commit -m "feat(coach): skill 脚手架 init-evidence 与 scaffold-brief"
```

---

### Task 4: `preflight-probes.mjs` + 收缩 SKILL + README

**Files:**
- Create: `tools/recording-coach/skill/scripts/preflight-probes.mjs`
- Modify: `tools/recording-coach/skill/SKILL.md`（缩为短指令）
- Modify: `tools/recording-coach/README.md`
- Modify: `tools/recording-coach/WET-CHECKLIST.md`

**Interfaces:**
- Consumes: `createTools` → `preflight_readonly`；profiles：`none` | `rating-credit` | `custom`
- Produces: 写 `probes.json`；`--run` 时写 `preflight.json`

- [ ] **Step 1: 实现 `preflight-probes.mjs`**

```js
const PROFILES = {
  none: [],
  'rating-credit': [
    // 占位：实现时填 1～3 条真实只读 path，注释「以 http://localhost:4097/api/docs 为准」
    // 若暂无稳定 path，保持 [] 并在 --profile rating-credit 时 stderr 警告且 require --custom-json 或允许空但 businessProbeRequired 仍 false
  ],
};
```

Spec 允许占位：若 `rating-credit` 暂无稳定 GET，则实现为：选择该 profile 时 **必须** 同时给 `--custom-json`，否则 exit 2 并提示查 `/api/docs`；`none` 写 `probes: []`。

`--run`：`preflight_readonly({ probes })`。

- [ ] **Step 2: 干跑 profile none**

Run: `node tools/recording-coach/skill/scripts/preflight-probes.mjs --evidence <dir> --profile none`  
Expected: `probes.json` 为 `[]`；exit 0。

- [ ] **Step 3: 收缩 `SKILL.md`**

保留 YAML frontmatter（可微调 description 提到 references/scripts）。正文只保留：三角色、两份输入、12 步铁律表、派发前核查一句、值守一句、验收一句、诚实失败一句、close 五行一句、失败再试三条、何时用；每段加「详见 `references/….md`」。删掉已迁走的长坑与 STC 大表（改链接）。

- [ ] **Step 4: 更新 README / WET-CHECKLIST**

指向 `skill/` 四层与三个 `node skill/scripts/…` 示例命令；注明 OpenCode 加载 `skill/`；Cursor 用时口头指路径。

- [ ] **Step 5: Commit（默认跳过）**

```bash
git add tools/recording-coach/skill/scripts/preflight-probes.mjs tools/recording-coach/skill/SKILL.md tools/recording-coach/README.md tools/recording-coach/WET-CHECKLIST.md
git commit -m "feat(coach): preflight-probes 脚手架并收缩 skill 正文"
```

---

### Task 5: cold pin + verify-all 登记

**Files:**
- Create: `scripts/characterization/cold/characterize-recording-coach-skill-pack.mjs`
- Modify: `scripts/refactor/verify-all.sh`（在 `characterize-recording-coach-operator` 下一行登记）

**Interfaces:**
- Consumes: 三个脚本路径、`assertBusinessTaskText`、`assertDispatchBrief`、templates 五标题
- Produces: 打印 `OK recording-coach-skill-pack`

- [ ] **Step 1: 写 pin（文件存在 + help + assert + brief 模板含五标题）**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertBusinessTaskText } from '../../../tools/recording-coach/src/task-text.mjs';
import { assertDispatchBrief } from '../../../tools/recording-coach/src/dispatch-brief.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const skill = path.join(root, 'tools/recording-coach/skill');
for (const rel of [
  'references/pipeline-pits.md',
  'references/acceptance.md',
  'references/stc-anchors.md',
  'templates/dispatch-brief.md',
  'templates/task-text.md',
  'templates/close.txt',
  'templates/evidence-checklist.md',
  'scripts/init-evidence.mjs',
  'scripts/scaffold-brief.mjs',
  'scripts/preflight-probes.mjs',
]) {
  assert.ok(fs.existsSync(path.join(skill, rel)), rel);
}

assertDispatchBrief(fs.readFileSync(path.join(skill, 'templates/dispatch-brief.md'), 'utf8'));
assert.equal(
  assertBusinessTaskText('【硬性成功门闩——未满足不得 done】\n' + 'y'.repeat(80)),
  true,
);

for (const script of ['init-evidence.mjs', 'scaffold-brief.mjs', 'preflight-probes.mjs']) {
  const r = spawnSync(process.execPath, [path.join(skill, 'scripts', script), '--help'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, script + ' --help');
}

console.log('OK recording-coach-skill-pack');
```

- [ ] **Step 2: 跑 pin**

Run: `node scripts/characterization/cold/characterize-recording-coach-skill-pack.mjs`  
Expected: `OK recording-coach-skill-pack`

- [ ] **Step 3: 登记 verify-all.sh**

在 `characterize-recording-coach-operator` 行后插入：

```bash
run "characterize-recording-coach-skill-pack" node scripts/characterization/cold/characterize-recording-coach-skill-pack.mjs
```

- [ ] **Step 4: 回归既有 coach pin**

Run:

```bash
node scripts/characterization/cold/characterize-recording-coach-assert.mjs
node scripts/characterization/cold/characterize-recording-coach-operator.mjs
node scripts/characterization/cold/characterize-recording-coach-skill-pack.mjs
```

Expected: 三个均 OK

- [ ] **Step 5: Commit（默认跳过）**

```bash
git add scripts/characterization/cold/characterize-recording-coach-skill-pack.mjs scripts/refactor/verify-all.sh
git commit -m "test(coach): 登记 skill 四层包 cold pin"
```

---

## Spec coverage (self-review)

| Spec 节 | Task |
|---------|------|
| §4 目录四层 | 2, 3, 4 |
| §5 功能清单（指令/模板/脚本） | 2–4 |
| §6.1 init-evidence | 3 |
| §6.2 scaffold-brief | 3 |
| §6.3 preflight-probes | 4 |
| §6.4 共用约定 / 冷表征 | 5 |
| §7 成功判据 1–5 | 2–5 |
| §2 非目标 | Global Constraints |
| `assertBusinessTaskText` 复用 | 1 |

无 TBD；`rating-credit` 占位策略在 Task 4 Step 1 写死（无稳定 path 则强制 `--custom-json`）。

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-20-recording-coach-skill-pack.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — 每任务一个新子智能体，任务间审查，迭代快  
2. **Inline Execution** — 本会话按 executing-plans 批量执行并设检查点  

Which approach?
