# Capability Cohesion Structural Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structural hard gate on `draft-traj/propose` so one atom cannot mix two independently acceptable page capabilities, and so `produces: [title]` cannot bypass the empty-field gate.
**Architecture:** A pure helper `capability-cohesion.js` parses `taskDraft` into step groups, classifies each group as locate / persist / other / multi / neutral using generic verb families (not scene lists), then `assertCapabilityCohesion` rejects `multi_capability_task_draft` or `produces_eq_title`. `propose.js` `materializeLlmAtom` calls it after `countPersistConfirms` and after `normalizeProduces`, before provenance / empty-produces / the depend graph. Fallback produce keys become `${title}产物`. Cache bumps 4→5.
**Tech Stack:** Node ESM, existing req-draft-traj propose pipeline, characterization pins

## Global Constraints

- No scene blacklists (no product-tree layer / button-name bans)
- New reject reasons locked: `multi_capability_task_draft`, `produces_eq_title`
- Keep `multi_persist_task_draft` first; do not rebrand multi-confirm as multi_capability
- PROPOSE_CACHE_VERSION must bump 4→5 in implementation
- Work on cloud worktree; wet test only on local LMY afterward
- TDD: failing characterization before implementation per task
- Spec source of truth: `docs/superpowers/specs/2026-09-16-capability-cohesion-structural-gate-design.md` — do **not** edit that file (reason strings are locked)
- Do **not** add `missing_locate_prep`; do **not** change `validateAtomDependGraph`; do **not** copy the verb-family table into the atomize prompt
- Closer-only persist (spec §4.3.5 / C6): haystack has `确定`/`保存`/`提交`, **no** other-family hit, **no** persist-as-capability hit. Surrounding prose such as `一次…成功` is allowed (prompt 正例). This is not a scene exception; it is the locked reading of “closer-only” so C6 is reachable
- Status-family `启用` must use the same `(?<![未已])启用` lookbehind as `isPersistBoundaryAction`. Naive `haystack.includes('启用')` would mark `未启用` as `other` and break C2-adjacent locate prose. This is the existing persist exclusion, not a scene blacklist
- Public function names locked for this plan: `parseTaskDraftStepGroups`, `classifyCapabilityGroup`, `inspectCapabilityGroup`, `assertCapabilityCohesion`, `synthesizeFallbackProduceKey`
- New `src/` exports need JSDoc `@param`/`@returns`; insert comments only; `npm run lint` must not add warnings
- Do not restore `save_section.py`; do not touch OpenCode 20:03 files (`trajectory-meta-service.js`, `trajectory-text-extract.js`)

---

## File map

| File | Role |
|------|------|
| **Create** `src/services/req-draft-traj/capability-cohesion.js` | Parse step groups, classify locate/persist/other/multi/neutral, `assertCapabilityCohesion`. Pure, no I/O. Import `isPersistBoundaryAction` from `flow-card-guide.js` only. |
| **Modify** `src/services/req-draft-traj/propose.js` | After `countPersistConfirms > 1` reject, after `normalizeProduces`, call `assertCapabilityCohesion`. Point `fallbackDependFields` at `synthesizeFallbackProduceKey`. |
| **Modify** `src/services/req-draft-traj/propose-cache.js` | `PROPOSE_CACHE_VERSION` 4 → 5. Comment: v5 = capability-cohesion structural gate + title-as-key reject. |
| **Create** `scripts/characterization/characterize-capability-cohesion.mjs` | Dedicated pins C1–C6 plus parse/classify extras. Prefer this file over extending persist-boundary / atom-depend. |
| **Modify** `scripts/characterization/characterize-req-draft-traj.mjs` | Pin `PROPOSE_CACHE_VERSION === 5` (today it asserts `=== 4`). |
| **Modify** `scripts/refactor/verify-all.sh` | Register `characterize-capability-cohesion` after `characterize-persist-boundary`. |
| **Modify** `scripts/prompts/req-draft-traj-atomize-prompt.md` | One sentence under `<split_rules>` item 9 (准备步骤仅限定位类). Keep existing `<bad reason="same-page multi-capability">` and `<bad reason="maintain missing locate/search/select prep">`. |
| **Modify** `docs/superpowers/prompt-engineering/atom-depend-split-samples.md` | One cross-ref sentence: structural-gate reason = `multi_capability_task_draft`. |
| **Modify** `src/dashboard/api-docs/groups/kb.js` | Optional one-line propose `notes[]` listing the two new reasons. (`catalog.js` composes groups; the propose endpoint copy lives here.) |
| **Modify** `docs/superpowers/agent-log.md` | Implementer 开/收工. Do not rewrite the spec. |
| Do **not** modify | `atom-depend.js`, `flow-card-guide.js` (import only), `docs/superpowers/specs/2026-09-16-capability-cohesion-structural-gate-design.md`, `index.js` (characterization imports the helper file directly, same as atom-depend). |

Do not put this gate inside `validateAtomDependGraph`.

---

### Task 1: Helper + C1 / C5 / C2 / C6 pure-unit pins (RED then GREEN)

**Files:**
- Create: `scripts/characterization/characterize-capability-cohesion.mjs`
- Create: `src/services/req-draft-traj/capability-cohesion.js`

**Interfaces:**
- Consumes: `isPersistBoundaryAction(action: unknown): boolean` from `src/services/req-draft-traj/flow-card-guide.js` (string haystack uses `PERSIST_BOUNDARY_RE`; do not reimplement `未启用`/`已启用` exclusion).
- Produces (this task must export these exact names):
  - `parseTaskDraftStepGroups(taskDraft: unknown): Array<{ raw: string, haystack: string }>`
  - `inspectCapabilityGroup(haystack: unknown): { role: 'locate'\|'persist'\|'other'\|'multi'\|'neutral', families: string[] }` — `families` is the other-family id set **before** unique persist-as-capability absorption (so C5 can see `maintain` + `reorder`)
  - `classifyCapabilityGroup(haystack: unknown): 'locate'\|'persist'\|'other'\|'multi'\|'neutral'` — `inspectCapabilityGroup(haystack).role`
  - `assertCapabilityCohesion({ title: unknown, taskDraft: unknown, produces: unknown }): { ok: true } \| { ok: false, reason: 'multi_capability_task_draft' \| 'produces_eq_title' }`
- `synthesizeFallbackProduceKey` is **Task 2**. Do not add it yet.
- `assertCapabilityCohesion` in this task only needs to run parse → classify → sequence. Title-as-key (`produces_eq_title`) is Task 2; if you already have the produces check stub, keep it spec-accurate (length === 1 and exact `=== String(title).trim()`) but do **not** write the C4 pin until Task 2.

- [x] **Step 1: Write the failing characterization (helper only; no propose.js yet)**

Create `scripts/characterization/characterize-capability-cohesion.mjs`:

```js
#!/usr/bin/env node
/**
 * Capability-cohesion structural gate pins (spec 2026-09-16).
 * Cold: no live LLM. Helper-first; propose wiring pins live in later runs of this file.
 *
 * Run:
 *   node scripts/characterization/characterize-capability-cohesion.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const HELPER_PATH = join(ROOT, 'src/services/req-draft-traj/capability-cohesion.js');
const mod = await import(pathToFileURL(HELPER_PATH).href);

let failed = 0;
async function run(name, fn) {
  try {
    await fn();
    console.log(`  ok - ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  FAIL - ${name}: ${e.message}`);
  }
}

const FALLBACK_THREE_GROUPS = [
  '1、新增一级分类，操作：【新增一级分类】→【确定】',
  '2、选中分类下新增子分类，操作：【新增分类】→【确定】',
  '3、分类下新增产品，操作：【新增产品】→【确定】',
  '',
  '来源：demo.docx / chapters/01-product-library.md',
  '',
].join('\n');

const PROMPT_GOOD_MAINTAIN = [
  '1、进入功能页，等待加载',
  '2、搜索/定位并选中已有对象',
  '3、打开该项能力对应的表单或页签，填写本能力字段',
  '4、一次【保存】成功',
  '',
  '来源：demo.docx / chapters/01-product-library.md',
  '',
  '关键数据',
  '已有对象：KB测对象',
  '已维护对象：KB测对象',
].join('\n');

const C1_MERGED_MAINTAIN_REORDER = [
  '1、进入功能页，等待加载',
  '2、搜索并选中已有对象',
  '3、维护基本信息并【保存】',
  '4、上移/下移该项',
].join('\n');

const C5_SINGLE_GROUP = '1、操作：维护基本信息后上移该项并【保存】';

console.log('characterize-capability-cohesion');

await run('parse: fallback 顿号 draft yields 3 groups; 来源 stripped', () => {
  const groups = mod.parseTaskDraftStepGroups(FALLBACK_THREE_GROUPS);
  assert.equal(groups.length, 3);
  assert.match(groups[0].haystack, /新增一级分类/);
  assert.doesNotMatch(groups.map((g) => g.raw).join('\n'), /来源：/);
});

await run('parse: dotted numbering plus 操作: halfwidth colon', () => {
  const groups = mod.parseTaskDraftStepGroups('1. 进入功能页\n2. 操作:【保存】');
  assert.equal(groups.length, 2);
  assert.match(groups[1].haystack, /【保存】/);
  assert.doesNotMatch(groups[1].haystack, /操作:/);
});

await run('parse: no numbered steps → one group of remaining body', () => {
  const groups = mod.parseTaskDraftStepGroups('进入功能页，等待加载\n来源：x');
  assert.equal(groups.length, 1);
  assert.match(groups[0].haystack, /进入功能页/);
});

await run('C5 classify: single haystack 维护+上移 → multi with both families', () => {
  const info = mod.inspectCapabilityGroup('维护基本信息后上移该项并【保存】');
  assert.equal(info.role, 'multi');
  assert.ok(info.families.includes('maintain'));
  assert.ok(info.families.includes('reorder'));
});

await run('classify: 填写+【保存】 same group is other not multi', () => {
  assert.equal(
    mod.classifyCapabilityGroup('打开该项能力对应的表单或页签，填写本能力字段并【保存】'),
    'other',
  );
});

await run('classify: 选中 then 启用 (unique persist-as-capability) is persist', () => {
  assert.equal(mod.classifyCapabilityGroup('选中对象后启用'), 'persist');
});

await run('classify: 未启用 is not persist-as-capability via 启用', () => {
  assert.equal(mod.classifyCapabilityGroup('状态为未启用，等待加载'), 'locate');
});

await run('classify: unknown prose is neutral', () => {
  assert.equal(mod.classifyCapabilityGroup('本笔只改名称字段的说明文字'), 'neutral');
});

await run('C1 helper: locate + maintain/save + reorder → multi_capability_task_draft', () => {
  const out = mod.assertCapabilityCohesion({
    title: '维护并排序',
    taskDraft: C1_MERGED_MAINTAIN_REORDER,
    produces: ['已维护对象'],
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'multi_capability_task_draft');
});

await run('C5 helper: one numbered step 维护+上移 → multi_capability_task_draft', () => {
  const out = mod.assertCapabilityCohesion({
    title: '维护',
    taskDraft: C5_SINGLE_GROUP,
    produces: ['已维护对象'],
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'multi_capability_task_draft');
});

await run('C2 helper: locate* → fill → one save passes', () => {
  const out = mod.assertCapabilityCohesion({
    title: '维护基本信息',
    taskDraft: PROMPT_GOOD_MAINTAIN,
    produces: ['已维护对象'],
  });
  assert.deepEqual(out, { ok: true });
});

await run('C6 helper: numbered fill then closer-only 【保存】 passes', () => {
  const out = mod.assertCapabilityCohesion({
    title: '维护基本信息',
    taskDraft: [
      '1、进入功能页，等待加载',
      '2、搜索并选中已有对象',
      '3、填写本能力字段',
      '4、一次【保存】成功',
    ].join('\n'),
    produces: ['已维护对象'],
  });
  assert.deepEqual(out, { ok: true });
});

await run('sequence: trailing locate after save still passes this gate', () => {
  const out = mod.assertCapabilityCohesion({
    title: '保存后查询说明',
    taskDraft: [
      '1、进入功能页',
      '2、【保存】',
      '3、查询列表确认',
    ].join('\n'),
    produces: ['已保存对象'],
  });
  assert.deepEqual(out, { ok: true });
});

await run('sequence: 维护 + 启用 is multi_capability_task_draft', () => {
  const out = mod.assertCapabilityCohesion({
    title: '维护并启用',
    taskDraft: '1、维护字段并【保存】\n2、启用该项',
    produces: ['已维护对象'],
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'multi_capability_task_draft');
});

await run('sequence: locate → persist → other is multi_capability_task_draft', () => {
  const out = mod.assertCapabilityCohesion({
    title: '保存后再维护',
    taskDraft: '1、进入功能页\n2、【保存】\n3、填写本能力字段',
    produces: ['已保存对象'],
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'multi_capability_task_draft');
});

await run('sequence: reorder then maintain+save is multi_capability_task_draft', () => {
  const out = mod.assertCapabilityCohesion({
    title: '先排序再维护',
    taskDraft: '1、上移该项\n2、维护字段并【保存】',
    produces: ['已维护对象'],
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'multi_capability_task_draft');
});

await run('helper source has no scene blacklist literals', () => {
  const src = readFileSync(HELPER_PATH, 'utf8');
  assert.equal(src.includes('维护基本信息'), false);
  assert.equal(src.includes('不得出现上移'), false);
  assert.equal(src.includes('一级分类'), false);
});

if (failed) process.exit(1);
console.log('all passed');
```

- [x] **Step 2: Run the characterization and confirm it fails (missing module)**

Run: `node scripts/characterization/characterize-capability-cohesion.mjs`

Expected: FAIL (ERR_MODULE_NOT_FOUND for `capability-cohesion.js`, or first pin `parseTaskDraftStepGroups is not a function`). Do not implement yet.

- [x] **Step 3: Implement the helper (minimal, spec-faithful)**

Create `src/services/req-draft-traj/capability-cohesion.js` with this body (JSDoc required on every export; do not add product button names):

```js
/**
 * Structural capability-cohesion gate for req→draft-traj propose.
 * Classifies taskDraft step groups by generic verb families; never scene lists.
 */
import { isPersistBoundaryAction } from './flow-card-guide.js';

/** @typedef {'locate'|'persist'|'other'|'multi'|'neutral'} CapabilityRole */

const OTHER_FAMILIES = {
  reorder: ['上移', '下移', '置顶', '置底', '排序'],
  maintain: ['维护', '修改', '编辑', '填写', '录入'],
  create: ['新增', '添加', '创建', '新建'],
  delete: ['删除', '移除'],
  export: ['导出', '下载'],
  import: ['导入', '上传'],
  status: ['启用', '禁用'],
  clone: ['克隆', '复制'],
};

const PERSIST_AS_CAP_FAMILIES = new Set(['delete', 'status', 'clone']);
const PERSIST_AS_CAP_RE = /(?<![未已])启用|禁用|克隆|删除|作废|撤销(?!查询)/;
const CLOSER_RE = /确定|保存|提交/;
const STEP_DUNHAO_RE = /^\s*\d+、/;
const STEP_DOT_RE = /^\s*\d+[\.．]\s+/;

/**
 * Drop trailing 来源： / 关键数据 metadata so classification sees only steps.
 * @param {string} text Raw taskDraft
 * @returns {string} Body without metadata blocks
 */
function stripMetadata(text) {
  const lines = String(text || '').split(/\r?\n/);
  const kept = [];
  let skipYuan = false;
  let skipKey = false;
  for (const line of lines) {
    if (/^\s*关键数据/.test(line)) {
      skipKey = true;
      skipYuan = false;
      continue;
    }
    if (/^\s*来源：/.test(line)) {
      skipYuan = true;
      continue;
    }
    if (skipKey) continue;
    if (skipYuan) continue;
    kept.push(line);
  }
  return kept.join('\n');
}

/**
 * True when haystack has a non-whitespace character.
 * @param {string} text Candidate
 * @returns {boolean} Visible
 */
function isVisible(text) {
  return String(text || '').replace(/\s+/g, '').length > 0;
}

/**
 * Haystack is text after 操作：/操作:, else the whole group.
 * @param {string} raw Group text
 * @returns {string} Classification haystack
 */
function extractHaystack(raw) {
  const src = String(raw || '');
  const idx = src.search(/操作[:：]/);
  if (idx >= 0) {
    const mark = src.slice(idx).match(/^操作[:：]/);
    return src.slice(idx + (mark ? mark[0].length : 0));
  }
  return src;
}

/**
 * Split a taskDraft into numbered step groups (spec §4.1).
 * @param {unknown} taskDraft Atom taskDraft text
 * @returns {Array<{ raw: string, haystack: string }>} Non-empty groups
 */
export function parseTaskDraftStepGroups(taskDraft) {
  const body = stripMetadata(String(taskDraft || ''));
  const lines = body.split(/\r?\n/);
  const starts = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (STEP_DUNHAO_RE.test(lines[i]) || STEP_DOT_RE.test(lines[i])) starts.push(i);
  }
  if (starts.length === 0) {
    const haystack = extractHaystack(body);
    if (!isVisible(haystack)) return [];
    return [{ raw: body, haystack }];
  }
  /** @type {Array<{ raw: string, haystack: string }>} */
  const groups = [];
  for (let g = 0; g < starts.length; g += 1) {
    const from = starts[g];
    const to = g + 1 < starts.length ? starts[g + 1] : lines.length;
    const raw = lines.slice(from, to).join('\n');
    const haystack = extractHaystack(raw);
    if (!isVisible(haystack)) continue;
    groups.push({ raw, haystack });
  }
  return groups;
}

/**
 * Other-family ids whose substrings hit haystack.
 * @param {string} haystack Group action text
 * @returns {Set<string>} Family ids
 */
function detectOtherFamilies(haystack) {
  /** @type {Set<string>} */
  const found = new Set();
  for (const [id, words] of Object.entries(OTHER_FAMILIES)) {
    if (id === 'status') {
      if (/(?<![未已])启用/.test(haystack) || haystack.includes('禁用')) found.add('status');
      continue;
    }
    if (words.some((w) => haystack.includes(w))) found.add(id);
  }
  return found;
}

/**
 * True when haystack has a persist-as-capability verb (not closer-only).
 * @param {string} haystack Group action text
 * @returns {boolean} Persist-as-capability
 */
function hasPersistAsCapability(haystack) {
  if (!isPersistBoundaryAction(haystack)) return false;
  return PERSIST_AS_CAP_RE.test(haystack);
}

/**
 * True when haystack is a closer tail: 确定/保存/提交, no other family, no persist-as-capability.
 * Prose around the closer (一次…成功) is allowed.
 * @param {string} haystack Group action text
 * @returns {boolean} Closer-only persist
 */
function isCloserOnlyPersistHaystack(haystack) {
  const src = String(haystack || '');
  if (!CLOSER_RE.test(src)) return false;
  if (detectOtherFamilies(src).size > 0) return false;
  if (hasPersistAsCapability(src)) return false;
  return true;
}

/**
 * Locate-prep whitelist (spec §4.2 A). `打开`/`进入` count only when no other-family hit.
 * @param {string} haystack Group action text
 * @param {boolean} hasOtherFamily Whether an other family already hit
 * @returns {boolean} Locate-prep
 */
function hasLocatePrep(haystack, hasOtherFamily) {
  const tokens = [
    '查询', '搜索', '过滤', '筛选', '选中',
    '点击行', '点击节点', '点行', '点选节点',
    '展开', '切换页签', '切页签',
    '等待加载', '等待', '加载', '刷新',
  ];
  if (tokens.some((w) => haystack.includes(w))) return true;
  for (const line of haystack.split(/\r?\n/)) {
    if (line.includes('点击') && (line.includes('行') || line.includes('节点'))) return true;
    if (line.includes('切换') && (line.includes('页签') || /tab/i.test(line))) return true;
  }
  if (!hasOtherFamily && (haystack.includes('打开') || haystack.includes('进入'))) return true;
  return false;
}

/**
 * Classify one group's haystack (spec §4.2).
 * @param {unknown} haystack Group action text
 * @returns {{ role: CapabilityRole, families: string[] }} Role plus pre-absorb family ids
 */
export function inspectCapabilityGroup(haystack) {
  const src = String(haystack || '');
  const families = detectOtherFamilies(src);
  const familyList = [...families];
  const closer = CLOSER_RE.test(src);
  const persistCap = hasPersistAsCapability(src);
  let working = new Set(families);
  if (working.size === 1) {
    const only = [...working][0];
    if (PERSIST_AS_CAP_FAMILIES.has(only) && persistCap) working = new Set();
  }
  /** @type {CapabilityRole} */
  let role;
  if (working.size >= 2) role = 'multi';
  else if (working.size === 1) role = 'other';
  else if (persistCap || closer) role = 'persist';
  else if (hasLocatePrep(src, familyList.length > 0)) role = 'locate';
  else role = 'neutral';
  return { role, families: familyList };
}

/**
 * Classify one group's haystack to a single role.
 * @param {unknown} haystack Group action text
 * @returns {CapabilityRole} Role
 */
export function classifyCapabilityGroup(haystack) {
  return inspectCapabilityGroup(haystack).role;
}

/**
 * Sequence rules (spec §4.3). Does not rewrite taskDraft.
 * @param {Array<{ haystack: string }>} groups Parsed groups
 * @returns {{ ok: true }|{ ok: false, reason: 'multi_capability_task_draft' }}
 */
function assertSequence(groups) {
  const roles = groups.map((g) => classifyCapabilityGroup(g.haystack));
  if (roles.some((r) => r === 'multi')) {
    return { ok: false, reason: 'multi_capability_task_draft' };
  }
  const otherIdx = [];
  for (let i = 0; i < roles.length; i += 1) {
    if (roles[i] === 'other') otherIdx.push(i);
  }
  if (otherIdx.length > 1) {
    return { ok: false, reason: 'multi_capability_task_draft' };
  }
  let mainIdx = otherIdx.length === 1
    ? otherIdx[0]
    : roles.findIndex((r) => r === 'persist');
  if (mainIdx < 0) return { ok: true };
  for (let i = 0; i < mainIdx; i += 1) {
    if (roles[i] !== 'locate' && roles[i] !== 'neutral') {
      return { ok: false, reason: 'multi_capability_task_draft' };
    }
  }
  const mainHay = groups[mainIdx].haystack;
  const mainIsPersistCap = hasPersistAsCapability(mainHay);
  let i = mainIdx + 1;
  if (i < roles.length && roles[i] === 'persist' && isCloserOnlyPersistHaystack(groups[i].haystack)) {
    const mainRole = roles[mainIdx];
    if (mainRole === 'other' || mainIsPersistCap) i += 1;
    else return { ok: false, reason: 'multi_capability_task_draft' };
  }
  for (; i < roles.length; i += 1) {
    if (roles[i] === 'locate' || roles[i] === 'neutral') continue;
    return { ok: false, reason: 'multi_capability_task_draft' };
  }
  return { ok: true };
}

/**
 * Hard-gate one materialized atom (spec §4). Does not rewrite taskDraft.
 * @param {{ title?: unknown, taskDraft?: unknown, produces?: unknown }} atom Title, draft, normalized produces
 * @returns {{ ok: true }|{ ok: false, reason: 'multi_capability_task_draft'|'produces_eq_title' }}
 */
export function assertCapabilityCohesion(atom) {
  const groups = parseTaskDraftStepGroups(atom?.taskDraft);
  const seq = assertSequence(groups);
  if (!seq.ok) return seq;
  return { ok: true };
}
```

Leave `produces_eq_title` out of this function until Task 2 (C2 fixtures already pass a business key ≠ title). Do not add a `维护基本信息` string anywhere in this file — C1/C5 fixtures live only in the characterization file.

- [x] **Step 4: Re-run helper pins**

Run: `node scripts/characterization/characterize-capability-cohesion.mjs`

Expected: `all passed` (every pin `ok - …`). If C6 fails because closer-only was implemented as “haystack equals 保存 three characters”, switch to the locked reading in Global Constraints (prose around closer allowed; no other family; no persist-as-capability).

- [x] **Step 5: Commit**

```bash
git add scripts/characterization/characterize-capability-cohesion.mjs src/services/req-draft-traj/capability-cohesion.js
git commit -m "feat(req-draft-traj): add capability-cohesion helper with C1/C2/C5/C6 pins"
```

---

### Task 2: `produces_eq_title` (C4) + fallback synthesize key

**Files:**
- Modify: `src/services/req-draft-traj/capability-cohesion.js` — add `synthesizeFallbackProduceKey`; extend `assertCapabilityCohesion` with title-as-key after sequence
- Modify: `src/services/req-draft-traj/propose.js` — `fallbackDependFields` (currently lines 102–112) uses the synthesizer
- Modify: `scripts/characterization/characterize-capability-cohesion.mjs` — add C4 + synthesizer pins

**Interfaces:**
- Consumes: Task 1 `assertCapabilityCohesion` / parse / classify
- Produces:
  - `synthesizeFallbackProduceKey(title: unknown): string` — trim; empty → `'atom_output'`; else `` `${trimmed}产物` ``; must be `!== String(title).trim()` whenever title is non-empty; never return the raw title
  - `assertCapabilityCohesion` additional rule (after sequence pass): if `produces` is an array with `length === 1` and `produces[0] === String(title).trim()` → `{ ok: false, reason: 'produces_eq_title' }`. Empty `produces` does **not** use this reason (leave `missing_depend_fields` for later). Compare after caller has `normalizeProduces`; do not case-fold; do not substring-match; extra keys besides title → pass this rule

- [x] **Step 1: Write failing C4 + synthesizer pins**

Append to `scripts/characterization/characterize-capability-cohesion.mjs` (before `if (failed)`):

```js
await run('C4 helper: produces exact title → produces_eq_title even when draft is cohesive', () => {
  const out = mod.assertCapabilityCohesion({
    title: '维护基本信息',
    taskDraft: PROMPT_GOOD_MAINTAIN,
    produces: ['维护基本信息'],
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'produces_eq_title');
});

await run('C4 helper: produces title plus another key is not produces_eq_title', () => {
  const out = mod.assertCapabilityCohesion({
    title: '维护基本信息',
    taskDraft: PROMPT_GOOD_MAINTAIN,
    produces: ['维护基本信息', '已维护对象'],
  });
  assert.deepEqual(out, { ok: true });
});

await run('C4 helper: empty produces is not produces_eq_title', () => {
  const out = mod.assertCapabilityCohesion({
    title: '维护基本信息',
    taskDraft: PROMPT_GOOD_MAINTAIN,
    produces: [],
  });
  assert.deepEqual(out, { ok: true });
});

await run('synthesizeFallbackProduceKey never equals trimmed title', () => {
  assert.equal(typeof mod.synthesizeFallbackProduceKey, 'function');
  assert.equal(mod.synthesizeFallbackProduceKey('维护基本信息'), '维护基本信息产物');
  assert.notEqual(mod.synthesizeFallbackProduceKey('维护基本信息'), '维护基本信息');
  assert.equal(mod.synthesizeFallbackProduceKey(''), 'atom_output');
  assert.equal(mod.synthesizeFallbackProduceKey('  '), 'atom_output');
});
```

- [x] **Step 2: Run pins and confirm C4 / synthesizer fail**

Run: `node scripts/characterization/characterize-capability-cohesion.mjs`

Expected: FAIL on `C4 helper: produces exact title` (`ok: true` vs `false`) and/or `synthesizeFallbackProduceKey is not a function`. Earlier C1/C2/C5/C6 must still be `ok`.

- [x] **Step 3: Implement title-as-key + synthesizer; retarget fallback**

In `capability-cohesion.js`, add:

```js
/**
 * Deterministic fallback produce key that is never the raw title (spec §4.4).
 * @param {unknown} title Atom title
 * @returns {string} Non-empty key, !== trimmed title when title is non-empty
 */
export function synthesizeFallbackProduceKey(title) {
  const key = String(title || '').trim();
  if (!key) return 'atom_output';
  const synthesized = `${key}产物`;
  return synthesized === key ? `${key}_output` : synthesized;
}
```

Replace the end of `assertCapabilityCohesion` so sequence failure still wins, then title-as-key:

```js
export function assertCapabilityCohesion(atom) {
  const groups = parseTaskDraftStepGroups(atom?.taskDraft);
  const seq = assertSequence(groups);
  if (!seq.ok) return seq;
  const produces = Array.isArray(atom?.produces) ? atom.produces : [];
  const title = String(atom?.title ?? '').trim();
  if (produces.length === 1 && produces[0] === title) {
    return { ok: false, reason: 'produces_eq_title' };
  }
  return { ok: true };
}
```

In `src/services/req-draft-traj/propose.js`:

1. Add import next to the other `req-draft-traj` imports:

```js
import { synthesizeFallbackProduceKey } from './capability-cohesion.js';
```

2. Replace `fallbackDependFields` (keep the function; change only the key):

```js
/**
 * Deterministic fallback has no LLM depend graph. Synthesize a produce key
 * that is not the raw title so `produces_eq_title` does not drop fallback
 * atoms; `dataDependsOn` stays empty (no inferred upstream).
 * @param {string} title Atom title
 * @returns {{ produces: string[], dataDependsOn: [] }} Depend fields
 */
function fallbackDependFields(title) {
  return { produces: [synthesizeFallbackProduceKey(title)], dataDependsOn: [] };
}
```

Do **not** exempt fallback from the gate. Do **not** keep `produces: [title]`.

- [x] **Step 4: Re-run helper pins**

Run: `node scripts/characterization/characterize-capability-cohesion.mjs`

Expected: `all passed`.

Also run (must stay green; fallback writes still split, keys may now end with `产物`):

```bash
node scripts/characterization/characterize-persist-boundary.mjs
node scripts/characterization/characterize-atom-depend.mjs
```

Expected: both print `all passed` / existing ok lines; `multi_persist_task_draft` pin unchanged.

- [x] **Step 5: Commit**

```bash
git add src/services/req-draft-traj/capability-cohesion.js src/services/req-draft-traj/propose.js scripts/characterization/characterize-capability-cohesion.mjs
git commit -m "feat(req-draft-traj): reject produces_eq_title; synthesize fallback produce key"
```

---

### Task 3: Wire `materializeLlmAtom` order + C3 (`multi_persist` still first)

**Files:**
- Modify: `src/services/req-draft-traj/propose.js` — `materializeLlmAtom` (persist check ~676–678, produces normalize ~708–709, provenance ~724–730)
- Modify: `scripts/characterization/characterize-capability-cohesion.mjs` — propose-level C1 / C3 / rejected-does-not-enter-atoms; optional fallback produces ≠ title through `proposeDraftTrajectories`

**Interfaces:**
- Consumes: `assertCapabilityCohesion({ title, taskDraft, produces })` from Task 1–2; `countPersistConfirms`, `normalizeProduces`, `sanitizeTaskDraftKeyData`, `assertAtomProvenance`, `validateAtomDependGraph` (unchanged)
- Produces: `materializeLlmAtom` reject order after `sanitizeTaskDraftKeyData` (spec §7.2), **first reason wins**:
  1. `countPersistConfirms(cleanedDraft) > 1` → `multi_persist_task_draft` (existing; keep first)
  2. build atom; `atom.produces = normalizeProduces(llmAtom.produces)`; `assertCapabilityCohesion({ title, taskDraft: cleanedDraft, produces: atom.produces })` → `multi_capability_task_draft` or `produces_eq_title`
  3. `assertAtomProvenance` / `atom.produces.length === 0` → `missing_depend_fields`
  4. batch `validateAtomDependGraph` (existing, after the materialize loop) → `self_produce_depend` / `dangling_data_depend` / empty-produces double-check
- Rejected atoms from step 2 never push onto the `atoms` array, so they **must not** contribute `produces` to the batch graph (spec §4.5). Do not change `validateAtomDependGraph`.
- Payload stays `{ atomKey, reason }` on `rejected`. HTTP remains 200 + partial rejected. No new status codes.

- [x] **Step 1: Write failing propose-level pins**

Append to `scripts/characterization/characterize-capability-cohesion.mjs`. Add these imports at the top of the file (with the other imports):

```js
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
```

After helper import, add:

```js
process.env.KB_STAGING_DIR = mkdtempSync(join(tmpdir(), 'kb-observe-cohesion-'));
const { proposeDraftTrajectories } = await import(
  pathToFileURL(join(ROOT, 'src/services/req-draft-traj/propose.js')).href
);
const demoRoot = join(ROOT, 'scripts/characterization/fixtures/req-draft-traj/demo-mod');
const PRODUCT_LIBRARY_CARD = {
  _stem: 'product_library',
  flow: '产品库管理',
  keywords: ['新增一级分类', '新增产品'],
  menu_path: '产品管理→产品信息管理→产品库管理',
  preconditions: [],
  nodes: [{
    id: 'prod_add_dlg',
    page: '新增产品弹窗',
    enter: '从产品树新增',
    buttons: ['确定'],
    fields: ['名称'],
  }],
};

/**
 * @param {object} llmAtom One fake LLM atom (chainId/stepIndexes/title/taskDraft/…)
 * @returns {Promise<{ atoms: object[], rejected: object[] }>} Propose result
 */
async function proposeOne(llmAtom) {
  const tmp = mkdtempSync(join(tmpdir(), 'req-draft-cohesion-'));
  cpSync(demoRoot, join(tmp, 'demo-mod'), { recursive: true });
  const out = await proposeDraftTrajectories({
    moduleKey: 'demo-mod',
    rootDir: tmp,
    callLLM: async () => JSON.stringify({ atoms: [llmAtom] }),
    listSystemsFn: async () => [],
    listFlowCardsFn: async () => [PRODUCT_LIBRARY_CARD],
  });
  rmSync(tmp, { recursive: true, force: true });
  return out;
}
```

Then pins (C1 here is the spec table row: rejected contains the reason **and** the atom is absent from `atoms`):

```js
await run('C1 propose: merged maintain+reorder rejected and not in atoms', async () => {
  const out = await proposeOne({
    chainId: 'chain-a',
    stepIndexes: [2],
    title: '维护并排序',
    flowRef: 'product_library',
    nodeId: 'prod_add_dlg',
    taskDraft: `${C1_MERGED_MAINTAIN_REORDER}\n\n来源：demo.docx / chapters/01-product-library.md\n`,
    produces: ['已维护对象'],
    dataDependsOn: [],
    phaseHints: ['维护'],
    suggestedFunctionId: null,
  });
  assert.equal(out.atoms.length, 0, `expected no atoms, got ${JSON.stringify(out.atoms)}`);
  assert.ok(
    out.rejected.some((r) => r.reason === 'multi_capability_task_draft'),
    `expected multi_capability_task_draft, got ${JSON.stringify(out.rejected)}`,
  );
});

await run('C3 propose: THREE_CONFIRM_DRAFT stays multi_persist_task_draft (not multi_capability)', async () => {
  const out = await proposeOne({
    chainId: 'chain-a',
    stepIndexes: [2],
    title: '新增一级分类',
    flowRef: 'product_library',
    nodeId: 'prod_add_dlg',
    taskDraft: FALLBACK_THREE_GROUPS,
    produces: ['一级分类'],
    dataDependsOn: [],
    phaseHints: ['新增一级分类'],
    suggestedFunctionId: null,
  });
  assert.ok(
    out.rejected.some((r) => r.reason === 'multi_persist_task_draft'),
    `expected multi_persist_task_draft, got ${JSON.stringify(out.rejected)}`,
  );
  assert.equal(
    out.rejected.filter((r) => r.reason === 'multi_capability_task_draft').length,
    0,
    'must not rebrand multi-confirm as multi_capability',
  );
});

await run('C4 propose: title-as-key cohesive draft → produces_eq_title, not in atoms', async () => {
  const out = await proposeOne({
    chainId: 'chain-a',
    stepIndexes: [2],
    title: '维护基本信息',
    flowRef: 'product_library',
    nodeId: 'prod_add_dlg',
    taskDraft: `${PROMPT_GOOD_MAINTAIN}`,
    produces: ['维护基本信息'],
    dataDependsOn: [],
    phaseHints: ['维护'],
    suggestedFunctionId: null,
  });
  assert.equal(out.atoms.length, 0);
  assert.ok(out.rejected.some((r) => r.reason === 'produces_eq_title'));
});

await run('C2 propose: cohesive maintain with business produce key is accepted', async () => {
  const out = await proposeOne({
    chainId: 'chain-a',
    stepIndexes: [2],
    title: '维护基本信息',
    flowRef: 'product_library',
    nodeId: 'prod_add_dlg',
    taskDraft: `${PROMPT_GOOD_MAINTAIN}`,
    produces: ['已维护对象'],
    dataDependsOn: [{ key: '已有对象', source: 'preset' }],
    phaseHints: ['维护'],
    suggestedFunctionId: null,
  });
  assert.ok(out.atoms.length >= 1, `expected atoms, rejected=${JSON.stringify(out.rejected)}`);
  assert.equal(out.rejected.filter((r) => r.reason === 'multi_capability_task_draft').length, 0);
});
```

- [x] **Step 2: Run and confirm propose pins fail (helper not wired)**

Run: `node scripts/characterization/characterize-capability-cohesion.mjs`

Expected: helper pins still `ok`; `C1 propose` FAIL because the merged draft is still accepted (atoms length 1) — cohesion is not called yet. `C3 propose` should already `ok` (persist gate already first). `C4 propose` FAIL (title-as-key still accepted until wired).

- [x] **Step 3: Wire `materializeLlmAtom`**

In `propose.js`:

1. Extend the Task 2 import:

```js
import { assertCapabilityCohesion, synthesizeFallbackProduceKey } from './capability-cohesion.js';
```

2. Inside `materializeLlmAtom`, **after** `atom.produces = normalizeProduces(...)` and `atom.dataDependsOn = ...` (today ~708–709) and **before** `assertAtomProvenance` (today ~724), insert:

```js
  const cohesion = assertCapabilityCohesion({
    title,
    taskDraft: cleanedDraft,
    produces: atom.produces,
  });
  if (!cohesion.ok) {
    return { rejected: { atomKey, reason: cohesion.reason } };
  }
```

Do **not** move or duplicate the `countPersistConfirms(cleanedDraft) > 1` block; it must remain the first reject after sanitize.

Do **not** call `assertCapabilityCohesion` inside `validateAtomDependGraph`.

- [x] **Step 4: Re-run cohesion + persist-boundary + atom-depend**

```bash
node scripts/characterization/characterize-capability-cohesion.mjs
node scripts/characterization/characterize-persist-boundary.mjs
node scripts/characterization/characterize-atom-depend.mjs
```

Expected: all three `all passed`. C3 reason remains `multi_persist_task_draft`. C1/C4 atoms length 0. Existing `未启用` persist-boundary pin untouched.

- [x] **Step 5: Commit**

```bash
git add src/services/req-draft-traj/propose.js scripts/characterization/characterize-capability-cohesion.mjs
git commit -m "feat(req-draft-traj): wire capability-cohesion after multi_persist gate"
```

---

### Task 4: Cache v5 + version pin + `verify-all` registration

**Files:**
- Modify: `src/services/req-draft-traj/propose-cache.js` line 18 (`PROPOSE_CACHE_VERSION = 4`) and the comment immediately above (lines 12–17)
- Modify: `scripts/characterization/characterize-req-draft-traj.mjs` around line 563 (`PROPOSE_CACHE_VERSION is 4 (missing_depend_fields hard reject)`)
- Modify: `scripts/refactor/verify-all.sh` after the `characterize-persist-boundary` `run` line (~176)

**Interfaces:**
- Consumes: existing `writeProposeCache` / `readProposeCache` / `commit.js` stale check (`cache.cacheVersion !== PROPOSE_CACHE_VERSION` → `STALE_PROPOSE_CACHE`)
- Produces: `PROPOSE_CACHE_VERSION === 5`. Comment must say v5 = capability-cohesion structural gate + title-as-key reject. Wet machines that skip the bump would keep committing v4 merged drafts.

- [x] **Step 1: Write the failing version pin (edit only the characterization assertion first)**

In `scripts/characterization/characterize-req-draft-traj.mjs` replace the existing version pin with:

```js
  run('PROPOSE_CACHE_VERSION is 5 (capability-cohesion + title-as-key reject)', () => {
    assert.equal(PROPOSE_CACHE_VERSION, 5);
  });
```

Do not change `propose-cache.js` yet.

- [x] **Step 2: Run and confirm it fails**

Run: `node scripts/characterization/characterize-req-draft-traj.mjs`

Expected: FAIL `PROPOSE_CACHE_VERSION is 5` with actual `4`. Stop; then bump the constant.

- [x] **Step 3: Bump cache version and register verify-all**

`src/services/req-draft-traj/propose-cache.js`:

```js
/**
 * Cache format version — bump on breaking cache shape **or** persist-boundary
 * semantics that invalidate previously proposed atoms; commit rejects caches
 * whose version differs (STALE_PROPOSE_CACHE). v5: capability-cohesion
 * structural gate (`multi_capability_task_draft`) + title-as-key reject
 * (`produces_eq_title`).
 */
export const PROPOSE_CACHE_VERSION = 5;
```

In `scripts/refactor/verify-all.sh`, immediately after:

```bash
run "characterize-persist-boundary" node scripts/characterization/characterize-persist-boundary.mjs
```

insert:

```bash
run "characterize-capability-cohesion" node scripts/characterization/characterize-capability-cohesion.mjs
```

- [x] **Step 4: Re-run version pin + new pin + core related smokes**

```bash
node scripts/characterization/characterize-req-draft-traj.mjs
node scripts/characterization/characterize-capability-cohesion.mjs
node scripts/characterization/characterize-persist-boundary.mjs
node scripts/characterization/characterize-atom-depend.mjs
```

Expected: all pass. Then:

```bash
npx eslint src/services/req-draft-traj/capability-cohesion.js src/services/req-draft-traj/propose.js src/services/req-draft-traj/propose-cache.js
```

Expected: exit 0, no new warnings.

Optional full gate (if time): `bash scripts/refactor/verify-all.sh` — `characterize-capability-cohesion` must appear and pass. Known unrelated reds on some clouds (step-highlight / layer-tree / confirm-notification / network-capture) are not this task; do not “fix” them here.

- [x] **Step 5: Commit**

```bash
git add src/services/req-draft-traj/propose-cache.js scripts/characterization/characterize-req-draft-traj.mjs scripts/refactor/verify-all.sh
git commit -m "chore(req-draft-traj): bump propose cache to v5 and gate cohesion pins"
```

---

### Task 5: Prompt one-liner + samples cross-ref + api-docs + agent-log

**Files:**
- Modify: `scripts/prompts/req-draft-traj-atomize-prompt.md` — `<split_rules>` item 9 (today lines 50–53)
- Modify: `docs/superpowers/prompt-engineering/atom-depend-split-samples.md` — intro or B1
- Modify: `src/dashboard/api-docs/groups/kb.js` — propose endpoint `notes` array (~175–186)
- Modify: `docs/superpowers/agent-log.md` — implementer 收工 (and 开工 if not already committed)

**Interfaces:**
- Consumes: spec §5 exact sentence; existing `<bad reason="same-page multi-capability">` and `<bad reason="maintain missing locate/search/select prep">`
- Produces: prompt + samples + one docs line. Code gate remains the source of truth. Do **not** paste the other-family table into the prompt. Do **not** add `<bad>` entries that name product-tree layers or button proper names.

- [x] **Step 1: Add a characterization pin that the prompt contains the locate-prep sentence**

Append to `scripts/characterization/characterize-capability-cohesion.mjs`:

```js
await run('atomize prompt locates prep to locate-class only', () => {
  const prompt = readFileSync(
    join(ROOT, 'scripts/prompts/req-draft-traj-atomize-prompt.md'),
    'utf8',
  );
  assert.match(prompt, /仅限定位类/);
  assert.match(prompt, /查询\/搜索\/过滤\/选中/);
  assert.match(prompt, /same-page multi-capability/);
  assert.match(prompt, /maintain missing locate\/search\/select prep/);
  assert.doesNotMatch(prompt, /不得出现上移/);
});
```

- [x] **Step 2: Run and confirm the new pin fails**

Run: `node scripts/characterization/characterize-capability-cohesion.mjs`

Expected: FAIL `atomize prompt locates prep to locate-class only` (`仅限定位类` missing). Do not weaken the pin.

- [x] **Step 3: Edit prompt, samples, api-docs**

In `scripts/prompts/req-draft-traj-atomize-prompt.md`, replace the item-9 bullet that currently reads `准备步骤从属于该能力：仅当服务于本笔能力时允许并入。` with:

```
   - 准备步骤从属于该能力：允许并入主能力的准备步骤仅限定位类（查询/搜索/过滤/选中/点行或节点/打开或进入目标/展开/切换页签）。准备步骤不得夹带另一项可独立验收的能力。
```

Keep the other two item-9 bullets. Do not add a product-tree `<bad>`.

In `docs/superpowers/prompt-engineering/atom-depend-split-samples.md`, after the B1 “问题：” paragraph (the paragraph that starts `不要因为两项能力出现在同一页面`), add this sentence:

```
结构闸 reason = `multi_capability_task_draft`（实现见 `src/services/req-draft-traj/capability-cohesion.js`；多次【确定】仍走既有 `multi_persist_task_draft`）。
```

In `src/dashboard/api-docs/groups/kb.js`, append one string to the propose endpoint `notes` array:

```js
        'taskDraft 同笔多项能力 → rejected multi_capability_task_draft；produces 规范化后精确等于 title → rejected produces_eq_title；多次落库确认仍为 multi_persist_task_draft（先于新闸）',
```

- [x] **Step 4: Re-run cohesion pins + eslint on kb.js**

```bash
node scripts/characterization/characterize-capability-cohesion.mjs
npx eslint src/dashboard/api-docs/groups/kb.js
```

Expected: `all passed`; eslint exit 0.

- [x] **Step 5: Agent-log 收工 + commit**

Insert at the top of `docs/superpowers/agent-log.md` (below the protocol/header) a 收工 entry that links the implementer’s 开工: helper+pins commit hashes, cache v5, prompt sentence, C1–C6 evidence (`node scripts/characterization/characterize-capability-cohesion.mjs` all passed), leftover = wet W1–W4 on local LMY.

```bash
git add scripts/prompts/req-draft-traj-atomize-prompt.md docs/superpowers/prompt-engineering/atom-depend-split-samples.md src/dashboard/api-docs/groups/kb.js scripts/characterization/characterize-capability-cohesion.mjs docs/superpowers/agent-log.md
git commit -m "docs(req-draft-traj): echo cohesion gate in atomize prompt, samples, api-docs"
```

---

### Task 6: Self-check, falsify C1, wet checklist W1–W4 (manual / local; not blocking unit pins)

**Files:**
- Modify: this plan’s checkboxes as tasks complete
- No further product code unless a pin is red
- Wet: **local LMY only** (Global Constraints). Cloud worktree does not run product-mgmt re-propose against a live control plane.

**Interfaces:**
- Consumes: Tasks 1–5 outputs; spec §6 / §8
- Produces: a green unit report + a wet checklist for the human on LMY. Wet failures do not block merging the characterization PR; they block calling the feature “wet-accepted”.

- [x] **Step 1: Spec coverage checklist (implementer walks this, no extra code)**

Confirm each spec row has a pin or an explicit non-goal:

| Spec | Where |
|------|--------|
| §4.1 parse 顿号 / dotted / no-number / strip 来源+关键数据 | Task 1 parse pins |
| §4.2 locate whitelist, persist closer vs persist-as-capability, other families, unique 启用 absorb, 未启用 | Task 1 classify pins |
| §4.2 group `维护+上移` → multi | C5 |
| §4.3 sequence, closer tail C6, trailing locate pass, 维护+启用 / save-then-other / reorder-then-maintain reject | Task 1 |
| §4.4 title-as-key exact, extra key pass, empty ≠ this reason | C4 Task 2 |
| §4.4 fallback `${title}产物` never === title, no exemption | Task 2 synthesizer + `fallbackDependFields` |
| §4.5 rejected atoms do not enter `atoms` / graph | Task 3 C1/C4 `atoms.length === 0` |
| §7.2 persist first | C3 |
| §7.3 cache 4→5 | Task 4 |
| §5 prompt one sentence, keep two `<bad>`s, no scene `<bad>` | Task 5 |
| §2.2 / §6 no `missing_locate_prep` | grep the PR: that string must not appear under `src/` |
| §8 do not regress atom-depend empty produces / persist-boundary `未启用` / req-draft-traj cache pin | Task 4 commands |
| W1–W4 | this task, local LMY |

- [x] **Step 2: Falsify C1 (required by spec §8)**

```bash
node scripts/characterization/characterize-capability-cohesion.mjs
git stash push -u -m "cohesion-falsify" -- src/services/req-draft-traj/capability-cohesion.js
node scripts/characterization/characterize-capability-cohesion.mjs
git stash pop
```

Expected: first run `all passed`; stashed run FAIL (module missing or C1 red); after pop, `all passed` again. If C1 stays green with the helper stashed, the pin is not actually testing the helper — fix the pin, do not skip.

- [x] **Step 3: Final local commands (cloud)**

```bash
node scripts/characterization/characterize-capability-cohesion.mjs
node scripts/characterization/characterize-persist-boundary.mjs
node scripts/characterization/characterize-atom-depend.mjs
node scripts/characterization/characterize-req-draft-traj.mjs
npx eslint src/services/req-draft-traj/capability-cohesion.js src/services/req-draft-traj/propose.js src/services/req-draft-traj/propose-cache.js src/dashboard/api-docs/groups/kb.js
```

Expected: characterization files `all passed`; eslint 0 warnings. `PROPOSE_CACHE_VERSION` pin text is 5.

- [ ] **Step 4: Wet checklist (local LMY; not run on cloud)**

Control plane must load **cache v5**. Must **re-propose** (do not reuse v4 cache). Module: product-mgmt.

| # | Scene | Expect |
|---|--------|--------|
| W1 | Model writes 维护基本信息 and 上移/下移 into one `taskDraft` | That candidate is absent from `atoms`; `rejected[].reason === "multi_capability_task_draft"` |
| W2 | Maintain an existing object | Passing maintain atoms include locate-prep (查询/搜索/选中) **or** split into locate+maintain by existing standards. **Do not** invent `missing_locate_prep`. Missing locate still relies on prompt `<bad>`; merged capabilities use W1 |
| W3 | `locate* →` one `【保存】`/`【确定】` and no second capability | Must pass this gate (and empty-produces / depend graph if fields are legal) |
| W4 | Multiple persist confirms | Still `multi_persist_task_draft`, **not** `multi_capability_task_draft` as the primary reason |
| title-as-key | Any atom with `produces: [title]` | `produces_eq_title`; must not enter `atoms` by renaming around the empty-field gate |

- [x] **Step 5: PR description (implementer fills hashes)**

Use this body (replace hashes after commits exist):

```markdown
Implements docs/superpowers/specs/2026-09-16-capability-cohesion-structural-gate-design.md
via docs/superpowers/plans/2026-09-16-capability-cohesion-structural-gate.md

## What
- Pure helper `capability-cohesion.js` (parse / classify / assert)
- `materializeLlmAtom`: `multi_persist_task_draft` first, then cohesion, then empty produces / depend graph
- Fallback produce key `${title}产物` (never raw title)
- `PROPOSE_CACHE_VERSION` 4 → 5
- Atomize prompt one-liner; samples + api-docs reason line

## Pins
`node scripts/characterization/characterize-capability-cohesion.mjs` (C1–C6)
Existing: persist-boundary, atom-depend, req-draft-traj cache v5
Falsify: stash helper → C1 red

## Wet (local LMY, not this cloud PR)
- [ ] W1 multi_capability on maintain+reorder merge
- [ ] W2 maintain locate-prep via prompt (no new reason)
- [ ] W3 locate* + one save passes
- [ ] W4 multi_persist still primary on multi-confirm

## Out of scope
Scene blacklists, validate-retry, missing_locate_prep, flow-card topology rewrite, produces semantic dictionary.
```

Commit any checkbox ticks on this plan file:

```bash
git add docs/superpowers/plans/2026-09-16-capability-cohesion-structural-gate.md
git commit -m "docs(plan): tick capability-cohesion tasks after implementation"
```

---

## Execution notes for the next agent

1. Branch from `uara_V1.2` **after** the spec PR (#43) is merged, or from `cursor/capability-cohesion-structural-gate-design-bb60` if #43 is still open — the spec file must exist.
2. Isolated worktree at execution time (`using-git-worktrees`). Cloud implements Tasks 1–5 + Task 6 unit/falsify. Wet W1–W4 wait for local LMY.
3. Subagent-driven: one task per subagent, disjoint files as in the map; subagents do not commit; main session verifies then commits.
4. If a pin and the spec disagree, **stop and ask Lead** — do not silently invent a third reason string.
