# 需求文档导入 → KB 作业区 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 固化「模块级需求分册 → KB 作业区」：Agent Skill 编排切片 + 薄 API 登记/查询；不服务端切片、不写正式 flows、不 promote。

**Architecture:** `data/kb/req/<moduleKey>/` 为作业区契约；Node 只负责建目录与读写 `manifest.json`；章节/主链/草稿由 Agent 按 Skill 用 officecli 填充。扩展现有 `src/routes/v2/kb.js` 与 `GROUP_KB`，服务逻辑放独立 `src/services/kb-req-modules.js`。

**Tech Stack:** Express `/api/v2`、`sendOk`/`AppError`、`fs/promises`、characterization `.mjs` pin、Markdown Skill。

**Spec:** `docs/superpowers/specs/2026-09-05-req-doc-kb-import-design.md`

## Global Constraints

- 第一版 **只接受需求（req）**；手册/接口/案例/计划仅 spec §3.1 地图，不实现。
- **禁止**写入/覆盖 `data/kb/flows/**`；**禁止**调用 `scripts/kb/promote.py`；**禁止**写 `data/kb/staging/`。
- **禁止**服务端调用 officecli / LLM 做切片。
- `moduleKey` 必须匹配 `^[a-z0-9]+(-[a-z0-9]+)*$`。
- 一次一个模块；上传端点仅 stub（501 或明确未实现消息）。
- 响应信封用 `sendOk` / 现有 `AppError`（与其它 v2 一致）。
- 根目录 `data/kb/req/` **纳入 git**（至少 `.gitkeep`）；勿把整份 docx 强制拷进仓库。
- 改 `src/` 须遵守 JSDoc 规范（`docs/jsdoc-convention.md`）；新代码不引入 lint warning。
- 动代码前按 AGENTS.md 写 agent-log 开工声明并 commit；子智能体不 commit。
- 勿碰他线 WIP（客户查询/用信引擎等未声明文件）。

---

## File map

| Path | Role |
|------|------|
| `data/kb/req/.gitkeep` | 作业区根占位 |
| `scripts/prompts/skills/req-doc-to-kb/SKILL.md` | 编排 Skill（权威规程） |
| `src/services/kb-req-modules.js` | 登记/列表/详情纯文件系统服务 |
| `src/routes/v2/kb.js` | 挂载 req-modules 路由 |
| `src/dashboard/api-docs/groups/kb.js` | catalog 文档 |
| `scripts/characterization/characterize-kb-req-modules.mjs` | pin：校验 key、幂等、不碰 flows |
| `docs/superpowers/plans/2026-09-05-req-doc-kb-import.md` | 本计划 |

---

### Task 1: Skill 初稿 + 作业区根占位

**Files:**
- Create: `scripts/prompts/skills/req-doc-to-kb/SKILL.md`
- Create: `data/kb/req/.gitkeep`
- Modify: none required for AGENTS（可选一句入口，本任务可不改 AGENTS 以控范围）

**Interfaces:**
- Produces: Skill 文本契约（步骤 1–6、禁区、检查清单、目录树）；与 API 的 `moduleKey` / `status` 枚举一致：`registered` \| `sliced` \| `drafted`

- [ ] **Step 1: 创建 `data/kb/req/.gitkeep`**（空文件即可）

- [ ] **Step 2: 写 SKILL.md**

文件须含 YAML frontmatter（name/description）+ 正文，至少覆盖：

```markdown
---
name: req-doc-to-kb
description: >-
  模块级需求分册导入 KB 作业区：登记 data/kb/req/<moduleKey>、
  officecli 切片 chapters + through-chains、可选 drafts。
  禁止写 data/kb/flows、禁止 promote。
---

# 需求文档 → KB 作业区

## 何时使用
用户要求导入/切片某模块需求分册、建 req 作业区时。

## 步骤
1. POST /api/v2/kb/req-modules（或按契约手建目录）
2. officecli 读 sourcePath；剥 RQM_META 噪声
3. 填 chapters/（章节保真）
4. 写 through-chains.md（可贯通主链清单）
5. 仅当用户明示「出草稿卡」时写 drafts/*.json（draftFrom=req）
6. 更新 manifest.status → sliced 或 drafted；收工汇报

## 禁区
- 不写 data/kb/flows/**
- 不调用 promote.py / 不写 staging
- 不一次多模块；不做手册/接口/案例/计划导入（见 spec §3.1）

## 检查清单
- [ ] manifest 字段齐全
- [ ] chapters 非空或显式说明失败原因
- [ ] through-chains 有候选或「无闭环主链」
- [ ] 未触碰正式 flows
```

（可按 create-skill 习惯稍作展开，但不得削弱禁区。）

- [ ] **Step 3: 自检 Skill 含关键字**

Run:

```bash
rg -n "data/kb/flows|promote|chapters|through-chains|draftFrom" scripts/prompts/skills/req-doc-to-kb/SKILL.md
```

Expected: 均有命中；且出现「禁止」写 flows / promote。

- [ ] **Step 4: Commit**

```bash
git add data/kb/req/.gitkeep scripts/prompts/skills/req-doc-to-kb/SKILL.md
git commit -m "docs(skill): add req-doc-to-kb workflow under scripts/prompts/skills"
```

---

### Task 2: `kb-req-modules` 服务 + 失败 pin

**Files:**
- Create: `src/services/kb-req-modules.js`
- Create: `scripts/characterization/characterize-kb-req-modules.mjs`
- Test: 同上（fixture 用临时目录，注入 `rootDir`）

**Interfaces:**
- Produces:
  - `MODULE_KEY_RE` — `RegExp`
  - `assertModuleKey(key: string): void` — 非法抛错
  - `registerReqModule({ rootDir, moduleKey, moduleName, sourcePath, note?, reset? }): Promise<Manifest>`
  - `listReqModules({ rootDir }): Promise<ManifestSummary[]>`
  - `getReqModule({ rootDir, moduleKey }): Promise<Detail>`
- Manifest 形状：

```js
/**
 * @typedef {{
 *   moduleKey: string,
 *   moduleName: string,
 *   sourcePath: string,
 *   sourceKind: 'req',
 *   status: 'registered'|'sliced'|'drafted',
 *   note?: string,
 *   warnings: string[],
 *   createdAt: string,
 *   updatedAt: string
 * }} ReqModuleManifest
 */
```

- [ ] **Step 1: 写失败 pin（临时 root）**

`scripts/characterization/characterize-kb-req-modules.mjs` 骨架：

```js
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let passed = 0;
function run(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n${e.message}`); throw e; }
}

async function main() {
  const svc = await import(pathToFileURL(join(ROOT, 'src/services/kb-req-modules.js')).href);
  const dir = mkdtempSync(join(tmpdir(), 'kb-req-'));
  try {
    run('reject bad moduleKey', () => {
      assert.throws(() => svc.assertModuleKey('Bad_Key'), /moduleKey/);
    });
    // more cases after implementation exists — first run may fail on import
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`OK ${passed}`);
}
main();
```

- [ ] **Step 2: Run pin — expect fail（模块不存在）**

```bash
node scripts/characterization/characterize-kb-req-modules.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` 或 assert 失败。

- [ ] **Step 3: 实现 `src/services/kb-req-modules.js`**

要点（完整实现须含 JSDoc）：

- 默认 `rootDir` = `path.join(repoRoot, 'data/kb/req')`；测试传入临时目录。
- `registerReqModule`：校验 key；`mkdir` module / chapters / drafts；写 `manifest.json` + `source.link.json`；`sourceKind` 固定 `'req'`；若 `sourcePath` 用 `fs.access` 失败则 `warnings.push('sourcePath not accessible from server')` 仍成功；`reset===true` 时删除并重建 chapters/drafts（保留或重建 manifest 按「清空切片产物」语义）。
- 幂等：已存在且 `!reset` → 更新 `sourcePath`/`moduleName`/`updatedAt`/`warnings`，**不删** chapters。
- `listReqModules`：读各子目录 manifest；跳过无 manifest 的项。
- `getReqModule`：不存在抛可映射 404 的错误；返回 manifest + `{ hasChapters, hasThroughChains, draftCount }`（`fs` 探测）。

- [ ] **Step 4: 补全 pin 用例**

至少：

1. `assertModuleKey` 拒 `Foo`、收 `product-mgmt`  
2. register 创建目录与文件  
3. 二次 register 同 key 不删 chapters（先手写一个 `chapters/a.md` 再 register）  
4. `reset: true` 后 chapters 文件消失  
5. list 含该模块  
6. get 详情字段  
7. **安全**：register 后 `data/kb/flows` 下文件数不变（对真实 flows 目录 `readdir` 前后对比，或断言服务从未 `writeFile` 到 flows——用临时 root 时改为：临时 root 外造一个 `flows` 哨兵文件，确认 mtime/内容不变）

- [ ] **Step 5: Run pin — expect pass**

```bash
node scripts/characterization/characterize-kb-req-modules.mjs
```

Expected: 全部 `✓`，结尾 `OK N`。

- [ ] **Step 6: Commit**

```bash
git add src/services/kb-req-modules.js scripts/characterization/characterize-kb-req-modules.mjs
git commit -m "feat(kb): req-module workspace service with characterization pins"
```

---

### Task 3: 路由 + api-docs

**Files:**
- Modify: `src/routes/v2/kb.js`
- Modify: `src/dashboard/api-docs/groups/kb.js`
- Consumes: `registerReqModule` / `listReqModules` / `getReqModule` from Task 2

**Interfaces:**
- `POST /api/v2/kb/req-modules` body: `{ moduleKey, moduleName, sourcePath, note?, reset? }`
- `GET /api/v2/kb/req-modules`
- `GET /api/v2/kb/req-modules/:moduleKey`
- `POST /api/v2/kb/req-modules/:moduleKey/source` → **501**（未实现上传）

- [ ] **Step 1: 扩展 `kb.js`**

在现有 `registerKbRoutes` 内追加（保持 cards/stale-cards 不动）：

```js
import { sendOk } from '../../http/api-response.js';
import { AppError } from '../../http/app-error.js';
import * as reqModules from '../../services/kb-req-modules.js';

// POST register
app.post('/api/v2/kb/req-modules', asyncHandler(async (req, res) => {
  const { moduleKey, moduleName, sourcePath, note, reset } = req.body || {};
  if (!moduleKey || !moduleName || !sourcePath) {
    throw new AppError('moduleKey, moduleName, sourcePath required', { status: 400 });
  }
  const manifest = await reqModules.registerReqModule({
    moduleKey, moduleName, sourcePath, note, reset: Boolean(reset),
  });
  sendOk(res, { moduleKey: manifest.moduleKey, dir: reqModules.moduleDir(manifest.moduleKey), manifest });
}));

app.get('/api/v2/kb/req-modules', asyncHandler(async (_req, res) => {
  sendOk(res, { rows: await reqModules.listReqModules() });
}));

app.get('/api/v2/kb/req-modules/:moduleKey', asyncHandler(async (req, res) => {
  sendOk(res, await reqModules.getReqModule({ moduleKey: req.params.moduleKey }));
}));

app.post('/api/v2/kb/req-modules/:moduleKey/source', asyncHandler(async (_req, res) => {
  throw new AppError('multipart upload not implemented in v1', { status: 501 });
}));
```

（`moduleDir` 若未导出，改为在 data 里带相对路径 `data/kb/req/${key}`。）

非法 `moduleKey`：服务层抛错 → 路由转为 400。

- [ ] **Step 2: 更新 `groups/kb.js`**

- description 改为同时覆盖「洞察只读 + 需求作业区登记」  
- 追加 4 个 endpoint 的 summary / reqExample / respExample / notes（上传注明 501）

- [ ] **Step 3: 手工烟测（控制面需已启动）**

```bash
curl -s -X POST http://localhost:4097/api/v2/kb/req-modules -H "Content-Type: application/json" -d "{\"moduleKey\":\"smoke-req\",\"moduleName\":\"烟测模块\",\"sourcePath\":\"C:/nonexistent/demo.docx\"}"
curl -s http://localhost:4097/api/v2/kb/req-modules
curl -s http://localhost:4097/api/v2/kb/req-modules/smoke-req
```

Expected: POST/GET `code=200`；manifest.warnings 可含路径不可达；磁盘存在 `data/kb/req/smoke-req/manifest.json`。

上传：

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:4097/api/v2/kb/req-modules/smoke-req/source
```

Expected: `501`（或业务信封 code 非 200）。

- [ ] **Step 4: 清理烟测目录（可选）** — 删 `data/kb/req/smoke-req` 勿提交垃圾。

- [ ] **Step 5: Commit**

```bash
git add src/routes/v2/kb.js src/dashboard/api-docs/groups/kb.js
git commit -m "feat(api): register/list/get kb req-modules; upload stub 501"
```

---

### Task 4: 跟跑验收说明 + spec/plan 勾选

**Files:**
- Create: `tmp/kb-req-import/README.md`（gitignore 下可接受；或写在 `docs/superpowers/plans/` 验收附录——优先 **本计划文末勾选** + 短 `tmp` 说明）
- Modify: `docs/superpowers/specs/2026-09-05-req-doc-kb-import-design.md` §10 指向本计划已就绪（一行）
- Modify: 本计划 Tasks 勾选

**Interfaces:** 无新代码 API。

- [ ] **Step 1: 用真实或样例路径登记 `product-mgmt`（若桌面分册仍在）**

```bash
curl -s -X POST http://localhost:4097/api/v2/kb/req-modules -H "Content-Type: application/json" --data-binary "@-" <<'EOF'
{"moduleKey":"product-mgmt","moduleName":"产品管理","sourcePath":"C:/Users/water/Desktop/K01天阳信贷管理系统-产品管理需求分册.docx"}
EOF
```

（Windows 可用 PowerShell `ConvertTo-Json` / `Invoke-RestMethod`。）

- [ ] **Step 2: 人工/Agent 按 Skill 跑切片（不强制本任务自动化）**

最低验收：**登记成功** + Skill 文件存在 + pin 绿。完整 `sliced` 跟跑可作为 Lead 手工项记录在 agent-log。

- [ ] **Step 3: 确认未改 `data/kb/flows`**

```bash
git status --short data/kb/flows
```

Expected: 空（无本任务改动）。

- [ ] **Step 4: Commit 文档勾选与 spec 回链**

```bash
git add docs/superpowers/specs/2026-09-05-req-doc-kb-import-design.md docs/superpowers/plans/2026-09-05-req-doc-kb-import.md
git commit -m "docs: mark req-doc kb-import plan ready; link from spec"
```

---

## Spec coverage（自检）

| Spec 项 | Task |
|---------|------|
| Skill @ scripts/prompts/skills/req-doc-to-kb | T1 |
| 目录契约 data/kb/req | T1–T2 |
| POST/GET req-modules | T3 |
| 上传占位 | T3 |
| 双视图由 Agent 填（非服务端切片） | T1 Skill + T4 跟跑 |
| 禁 flows/promote | T1 禁区 + T2 pin |
| §3.1 其它资料类型 Out | T1 Skill 写明；无实现任务 |
| catalog | T3 |
| 草稿规则 | T1 Skill（实现不强制生成草稿） |

## Placeholder scan

无 TBD / 「类似 Task N」占位；命令与文件路径已写死。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-05-req-doc-kb-import.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每任务新子代理，任务间审查  
2. **Inline Execution** — 本会话按 executing-plans 连续做  

Which approach?
