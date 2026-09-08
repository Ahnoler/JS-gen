/**
 * Propose atomic draft trajectory candidates from req-module through-chains.
 */
import { readFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as systemDao from '../../dao/system-dao.js';
import { AppError } from '../../http/app-error.js';
import { callLLM as defaultCallLLM } from '../../llm-utils.js';
import { getReqModule, moduleDir } from '../kb-req-modules.js';
import { parseLlmJsonObject } from '../operation-component-signature.js';
import { buildAtomKey, parseThroughChainsMarkdown } from './parse-through-chains.js';
import {
  assertAtomProvenance,
  fillTaskDraftProvenancePlaceholders,
  loadSourceDoc,
  resolveChapterRef,
} from './provenance.js';
import { listFlowCardsDetailed } from '../kb-flow-cards.js';
import { matchFlowForAtom } from './flow-card-recall.js';
import { writeProposeCache } from './propose-cache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, '../../../scripts/prompts/req-draft-traj-atomize-prompt.md');
const MAX_CHAIN_PAYLOAD_CHARS = 28_000;

/**
 * @typedef {object} DraftAtom
 * @property {string} atomKey Stable atom key for idempotency
 * @property {string} title Human-readable atom title
 * @property {number|null} suggestedFunctionId Guessed function id or null
 * @property {string} sourceDoc Source document path
 * @property {string} sourceChapter Chapter reference under module
 * @property {string} taskDraft Task text for analyze
 * @property {string[]} phaseHints Short phase titles
 * @property {string} [wetTestHint] Optional wet-test hint
 * @property {string} [suggestedFlowRef] Matched kb flow card stem
 * @property {string} [suggestedNodeId] Matched flow card node id
 */

const WRITE_ACTION_RE = /新增|创建|录入|填写|新建|添加|校验|开立|修改|编辑|更新|维护|引入|选人|选择客户|保存|提交|启用|禁用|克隆|删除/;
const NAV_ACTION_RE = /进入|加载|刷树|打开|导航|切换|刷新/;

/**
 * Load atomize system prompt template from disk.
 * @returns {string} Prompt text
 */
function loadAtomizePrompt() {
  if (existsSync(PROMPT_PATH)) {
    return readFileSync(PROMPT_PATH, 'utf-8');
  }
  return '你是原子化交易拆解助手。输出严格 JSON：{"atoms":[...]}';
}

/**
 * True when a step action is a write/mutation operation.
 * @param {string} action Step action text
 * @returns {boolean} True when the step action is a write/mutation operation
 */
function isWriteStep(action) {
  return WRITE_ACTION_RE.test(String(action || ''));
}

/**
 * True when a step action is navigation-only (no write).
 * @param {string} action Step action text
 * @returns {boolean} True when the step action is navigation-only (no write)
 */
function isNavigationStep(action) {
  const text = String(action || '');
  return NAV_ACTION_RE.test(text) && !isWriteStep(text);
}

/**
 * Parse suggestedFunctionId from LLM output.
 * @param {unknown} value Raw value
 * @returns {number|null} Parsed function id or null when invalid
 */
function parseSuggestedFunctionId(value) {
  if (value == null || value === '') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build a minimal taskDraft template for deterministic fallback atoms.
 * @param {string[]} navPreamble Prior navigation step actions
 * @param {string} action Primary step action
 * @param {{ buttons?: string, page?: string }} step Step row
 * @param {string} sourceDoc Source document path
 * @returns {string} Task draft text
 */
function buildTemplateTaskDraft(navPreamble, action, step, sourceDoc) {
  const lines = [];
  let idx = 1;
  for (const nav of navPreamble) {
    lines.push(`${idx}、${nav}`);
    idx += 1;
  }
  const buttons = step.buttons ? `，操作：${step.buttons}` : '';
  const page = step.page ? `（${step.page}）` : '';
  lines.push(`${idx}、${action}${page}${buttons}`);
  lines.push('');
  lines.push(`来源：${sourceDoc}`);
  return `${lines.join('\n')}\n`;
}

/**
 * Deterministic fallback when LLM fails: one write step → one atom;
 * navigation-only steps merge into the next write atom's taskDraft preamble.
 * @param {import('./parse-through-chains.js').ThroughChain[]} chains Parsed chains
 * @param {string} sourceDoc Source document path for template
 * @returns {Array<{ chainId: string, stepIndexes: number[], title: string, taskDraft: string, phaseHints: string[], suggestedFunctionId: null }>} Fallback LLM-shaped atom list
 */
function buildFallbackLlmAtoms(chains, sourceDoc) {
  /** @type {Array<{ chainId: string, stepIndexes: number[], title: string, taskDraft: string, phaseHints: string[], suggestedFunctionId: null }>} */
  const atoms = [];

  for (const chain of chains) {
    const steps = chain.steps || [];
    /** @type {string[]} */
    let navPreamble = [];

    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      const action = String(step.action || '').trim();
      if (!action) {
        continue;
      }

      if (isNavigationStep(action)) {
        navPreamble.push(action);
        const hasLaterWrite = steps.slice(i + 1).some((s) => isWriteStep(s.action));
        if (!hasLaterWrite) {
          atoms.push({
            chainId: chain.chainId,
            stepIndexes: [step.index],
            title: action,
            taskDraft: buildTemplateTaskDraft([], action, step, sourceDoc),
            phaseHints: [action],
            suggestedFunctionId: null,
          });
          navPreamble = [];
        }
        continue;
      }

      if (isWriteStep(action)) {
        const preamble = navPreamble.slice();
        navPreamble = [];
        atoms.push({
          chainId: chain.chainId,
          stepIndexes: [step.index],
          title: action,
          taskDraft: buildTemplateTaskDraft(preamble, action, step, sourceDoc),
          phaseHints: preamble.length > 0 ? [...preamble, action] : [action],
          suggestedFunctionId: null,
        });
        continue;
      }

      navPreamble = [];
      atoms.push({
        chainId: chain.chainId,
        stepIndexes: [step.index],
        title: action,
        taskDraft: buildTemplateTaskDraft([], action, step, sourceDoc),
        phaseHints: [action],
        suggestedFunctionId: null,
      });
    }
  }

  return atoms;
}

/**
 * Serialize chains for LLM input, truncating when payload is huge.
 * @param {import('./parse-through-chains.js').ThroughChain[]} chains Chains to serialize
 * @returns {string} JSON string for user payload
 */
function serializeChainsForLlm(chains) {
  let payload = JSON.stringify({ chains }, null, 2);
  if (payload.length <= MAX_CHAIN_PAYLOAD_CHARS) {
    return payload;
  }
  const trimmed = chains.map((chain) => ({
    ...chain,
    steps: (chain.steps || []).map((step) => ({
      index: step.index,
      action: step.action,
      zjjk: step.zjjk,
      buttons: step.buttons,
    })),
  }));
  payload = JSON.stringify({ chains: trimmed, truncated: true }, null, 2);
  if (payload.length > MAX_CHAIN_PAYLOAD_CHARS) {
    return `${payload.slice(0, MAX_CHAIN_PAYLOAD_CHARS)}\n/* truncated */`;
  }
  return payload;
}

/**
 * Invoke LLM atomize prompt and parse atoms array.
 * @param {import('./parse-through-chains.js').ThroughChain[]} chains Filtered chains
 * @param {string} moduleKey Module key
 * @param {(text: string) => Promise<string>} llmFn Injectable LLM caller
 * @returns {Promise<Array<Record<string, unknown>>>} Raw LLM atom objects
 */
async function callAtomizeLlm(chains, moduleKey, llmFn) {
  const systemPrompt = loadAtomizePrompt();
  const userPayload = serializeChainsForLlm(chains);
  const prompt = `${systemPrompt}\n\n---\n\nmoduleKey: ${moduleKey}\n\n${userPayload}`;
  const raw = await llmFn(prompt);
  const parsed = parseLlmJsonObject(raw);
  if (!parsed || !Array.isArray(parsed.atoms)) {
    return null;
  }
  return parsed.atoms;
}

/**
 * Resolve a chain step by 1-based index.
 * @param {import('./parse-through-chains.js').ThroughChain} chain Chain
 * @param {number} stepIndex 1-based step index
 * @returns {import('./parse-through-chains.js').ThroughChainStep|undefined} Matching step or undefined
 */
function findStepByIndex(chain, stepIndex) {
  const direct = chain.steps.find((s) => s.index === stepIndex);
  if (direct) {
    return direct;
  }
  return chain.steps[stepIndex - 1];
}

/**
 * Count write-like steps referenced by 1-based step indexes.
 * @param {import('./parse-through-chains.js').ThroughChain} chain Chain
 * @param {number[]} stepIndexes 1-based step indexes
 * @returns {number} Number of write-like steps in the index list
 */
function countWriteStepsInIndexes(chain, stepIndexes) {
  let count = 0;
  for (const stepIndex of stepIndexes) {
    const step = findStepByIndex(chain, stepIndex);
    if (step && isWriteStep(step.action)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Pick the step index used in atomKey: first write-like step in stepIndexes, else first index.
 * @param {import('./parse-through-chains.js').ThroughChain} chain Chain
 * @param {number[]} stepIndexes 1-based step indexes from LLM atom
 * @returns {number} Step index for buildAtomKey
 */
function pickAtomKeyStepIndex(chain, stepIndexes) {
  for (const stepIndex of stepIndexes) {
    const step = findStepByIndex(chain, stepIndex);
    if (step && isWriteStep(step.action)) {
      return step.index;
    }
  }
  return stepIndexes[0] || chain.steps[0]?.index || 1;
}

/**
 * Materialize one LLM atom into a DraftAtom or rejection entry.
 * @param {Record<string, unknown>} llmAtom Raw LLM atom
 * @param {object} ctx Materialization context
 * @param {string} ctx.moduleKey Module key
 * @param {string} ctx.modDir Module directory
 * @param {import('./parse-through-chains.js').ThroughChain[]} ctx.chains Parsed chains
 * @param {string} ctx.sourceDoc Source document path
 * @returns {Promise<{ atom?: DraftAtom, rejected?: { atomKey?: string, reason: string } }>} Materialized atom or rejection
 */
async function materializeLlmAtom(llmAtom, { moduleKey, modDir, chains, sourceDoc }) {
  const chainId = String(llmAtom.chainId || '').trim();
  const chain = chains.find((c) => c.chainId === chainId);
  if (!chain) {
    return { rejected: { reason: 'unknown_chain_id' } };
  }

  const stepIndexes = Array.isArray(llmAtom.stepIndexes)
    ? llmAtom.stepIndexes.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  const primaryIndex = stepIndexes[0] || chain.steps[0]?.index || 1;
  const primaryStep = findStepByIndex(chain, primaryIndex) || chain.steps[0];
  const title = String(llmAtom.title || primaryStep?.action || '').trim();
  const stepIndex = primaryStep?.index || primaryIndex;

  const atomKeyStepIndex = stepIndexes.length > 0
    ? pickAtomKeyStepIndex(chain, stepIndexes)
    : stepIndex;

  const writeStepCount = stepIndexes.length > 0
    ? countWriteStepsInIndexes(chain, stepIndexes)
    : (primaryStep && isWriteStep(primaryStep.action) ? 1 : 0);
  if (writeStepCount > 1) {
    const atomKey = buildAtomKey({
      moduleKey,
      chainId: chain.chainId,
      stepIndex: atomKeyStepIndex,
      title,
    });
    return { rejected: { atomKey, reason: 'multi_write_atom' } };
  }

  const atomKey = buildAtomKey({
    moduleKey,
    chainId: chain.chainId,
    stepIndex: atomKeyStepIndex,
    title,
  });

  const provenanceStep = findStepByIndex(chain, atomKeyStepIndex) || primaryStep;
  const sourceChapter = await resolveChapterRef({
    chaptersDir: join(modDir, 'chapters'),
    chapterHint: chain.chapterHint,
    zjjk: provenanceStep?.zjjk || '',
    actionHint: title || provenanceStep?.action || '',
  });

  const resolvedChapter = sourceChapter || '';
  const rawTaskDraft = String(llmAtom.taskDraft || '').trim();
  const taskDraft = fillTaskDraftProvenancePlaceholders(rawTaskDraft, sourceDoc, resolvedChapter);

  /** @type {DraftAtom} */
  const atom = {
    atomKey,
    title,
    suggestedFunctionId: parseSuggestedFunctionId(llmAtom.suggestedFunctionId),
    sourceDoc,
    sourceChapter: resolvedChapter,
    taskDraft,
    phaseHints: Array.isArray(llmAtom.phaseHints)
      ? llmAtom.phaseHints.map((h) => String(h))
      : [],
  };

  if (llmAtom.wetTestHint != null && String(llmAtom.wetTestHint).trim()) {
    atom.wetTestHint = String(llmAtom.wetTestHint).trim();
  }

  const prov = assertAtomProvenance(atom);
  if (!prov.ok) {
    return { rejected: { atomKey, reason: prov.reason } };
  }

  return { atom };
}

/**
 * Validate atom suggestedFunctionId values against the system table and null
 * out ids that do not exist there (LLM may hallucinate ids — e.g. 90000107304 —
 * that would violate the trajectory function FK at commit time).
 * Fail-safe: when the DB lookup itself errors, warn and treat the id as valid
 * (skip validation) so a lookup outage never blocks the propose main flow.
 * @param {DraftAtom[]} atoms Atoms to normalize in place
 * @param {((id: number) => Promise<boolean>)|null} [existsFn] Optional injected
 *   existence check (offline characterization stubs); defaults to systemDao.
 * @returns {Promise<void>} Resolves after in-place normalization completes
 */
async function normalizeSuggestedFunctionIds(atoms, existsFn = null) {
  const ids = [...new Set(
    atoms.map((a) => a.suggestedFunctionId).filter((id) => id != null),
  )];
  if (ids.length === 0) {
    return;
  }
  const exists = existsFn || ((id) => systemDao.getById(id));
  const results = await Promise.all(ids.map(async (id) => {
    try {
      return { id, exists: Boolean(await exists(id)) };
    } catch (e) {
      console.warn('[req-draft-traj] suggested functionId %s check failed (%s) — skip validation', id, e.message);
      return { id, exists: true };
    }
  }));
  const unknown = new Set(results.filter((r) => !r.exists).map((r) => r.id));
  for (const id of unknown) {
    console.warn('[req-draft-traj] suggested functionId %s not found in system — nulled', id);
  }
  for (const atom of atoms) {
    if (atom.suggestedFunctionId != null && unknown.has(atom.suggestedFunctionId)) {
      atom.suggestedFunctionId = null;
    }
  }
}

/**
 * Propose atomic draft trajectory candidates for a req module.
 * @param {object} opts Propose options
 * @param {string} opts.moduleKey Req module key
 * @param {string} [opts.rootDir] Req modules root directory
 * @param {string[]} [opts.chainIds] Optional chain id filter
 * @param {number} [opts.maxAtoms] Max selectable atoms to return
 * @param {(text: string) => Promise<string>} [opts.callLLM] Injectable LLM caller (offline tests)
 * @param {(id: number) => Promise<boolean>} [opts.functionIdExists] Injectable function-id
 *   existence check (offline characterization stubs; defaults to system table lookup)
 * @returns {Promise<{ atoms: DraftAtom[], rejected: Array<{ atomKey?: string, reason: string }> }>} Accepted and rejected atoms
 */
export async function proposeDraftTrajectories({
  moduleKey,
  rootDir,
  chainIds,
  maxAtoms,
  callLLM,
  functionIdExists = null,
}) {
  const mod = await getReqModule({ rootDir, moduleKey });
  if (!mod.hasThroughChains) {
    throw new AppError('through-chains.md required', { code: 'VALIDATION' });
  }

  const modDir = moduleDir(moduleKey, rootDir);
  const md = await readFile(join(modDir, 'through-chains.md'), 'utf-8');
  const { chains: allChains } = parseThroughChainsMarkdown(md);

  const chainIdSet = Array.isArray(chainIds) && chainIds.length > 0
    ? new Set(chainIds.map(String))
    : null;
  const chains = chainIdSet
    ? allChains.filter((c) => chainIdSet.has(c.chainId))
    : allChains;

  const sourceDoc = await loadSourceDoc(modDir);
  const llmFn = callLLM || defaultCallLLM;

  let llmAtoms = null;
  try {
    llmAtoms = await callAtomizeLlm(chains, moduleKey, llmFn);
  } catch {
    llmAtoms = null;
  }

  // Empty array means LLM returned no atoms — still use deterministic fallback
  // (prose-only through-chains already filtered at list via canProposeAtoms).
  if (!llmAtoms || llmAtoms.length === 0) {
    // Deterministic fallback: each write step → one atom; nav merges into next write preamble.
    llmAtoms = buildFallbackLlmAtoms(chains, sourceDoc);
  }

  /** @type {DraftAtom[]} */
  const atoms = [];
  /** @type {Array<{ atomKey?: string, reason: string }>} */
  const rejected = [];

  for (const llmAtom of llmAtoms) {
    const result = await materializeLlmAtom(llmAtom, {
      moduleKey,
      modDir,
      chains,
      sourceDoc,
    });
    if (result.atom) {
      atoms.push(result.atom);
    } else if (result.rejected) {
      rejected.push(result.rejected);
    }
  }

  const capped = Number.isFinite(maxAtoms) && maxAtoms > 0
    ? atoms.slice(0, maxAtoms)
    : atoms;

  await normalizeSuggestedFunctionIds(capped, functionIdExists);

  const cards = await listFlowCardsDetailed({});
  for (const atom of capped) {
    const hit = matchFlowForAtom({
      title: atom.title,
      taskDraft: atom.taskDraft,
      cards,
    });
    if (hit.flowRef) atom.suggestedFlowRef = hit.flowRef;
    if (hit.nodeId) atom.suggestedNodeId = hit.nodeId;
  }

  await writeProposeCache(modDir, { atoms: capped, rejected });

  return { atoms: capped, rejected };
}
