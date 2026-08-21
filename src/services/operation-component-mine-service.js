/**
 * Offline mine: scan trajectory phases, signature-cluster, LLM-name new drafts.
 * Existing (system_id, signature) components: add occurrences only — never overwrite copy.
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { callLLM } from '../llm-utils.js';
import * as componentDao from '../dao/operation-component-dao.js';
import * as occurrenceDao from '../dao/operation-component-occurrence-dao.js';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../dao/trajectory-phase-dao.js';
import {
  computePhaseSignature,
  stepsToSnapshot,
  parseLlmJsonObject,
} from './operation-component-signature.js';
import {
  collectFunctionIdsForSystem,
  loadPhaseSteps,
  refreshOccurrenceCount,
  resolveSystemIdForTrajectory,
  resolveSystemIdFromNode,
} from './operation-component-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = path.resolve(__dirname, '../../scripts/prompts/component-mine-prompt.md');

function svcError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function loadPromptTemplate() {
  if (existsSync(PROMPT_PATH)) {
    return readFileSync(PROMPT_PATH, 'utf-8');
  }
  return [
    '你是业务流程组件命名助手。',
    '根据阶段描述与规范化步骤摘要，输出严格 JSON：',
    '{"name":"...","key":"...","description":"...","paramSchema":null,"confidence":0.0}',
  ].join('\n');
}

async function listAllTrajectoryIdsByFunction(functionId) {
  const ids = [];
  let page = 1;
  const pageSize = 200;
  for (;;) {
    const list = await trajectoryDao.listByFunction(functionId, { page, pageSize });
    const rows = list.rows || [];
    for (const t of rows) ids.push(Number(t.id));
    if (rows.length < pageSize || ids.length >= Number(list.total || 0)) break;
    page += 1;
    if (page > 100) break;
  }
  return ids;
}

/**
 * @param {object} body
 * @returns {Promise<{trajectoryIds: number[], systemIdHint: number|null}>}
 */
async function resolveMineScope(body = {}) {
  const trajectoryIdsRaw = body.trajectoryIds ?? body.trajectory_ids;
  if (Array.isArray(trajectoryIdsRaw) && trajectoryIdsRaw.length) {
    const ids = [...new Set(trajectoryIdsRaw.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
    if (!ids.length) throw svcError('trajectoryIds empty', 400);
    return { trajectoryIds: ids, systemIdHint: body.systemId != null ? Number(body.systemId) : null };
  }

  if (body.functionId != null || body.function_id != null) {
    const functionId = Number(body.functionId ?? body.function_id);
    if (!Number.isFinite(functionId) || functionId <= 0) throw svcError('Invalid functionId', 400);
    const ids = await listAllTrajectoryIdsByFunction(functionId);
    const systemIdHint = await resolveSystemIdFromNode(functionId);
    return { trajectoryIds: ids, systemIdHint };
  }

  if (body.systemId != null || body.system_id != null) {
    const systemId = Number(body.systemId ?? body.system_id);
    if (!Number.isFinite(systemId) || systemId <= 0) throw svcError('Invalid systemId', 400);
    const functionIds = await collectFunctionIdsForSystem(systemId);
    const ids = [];
    for (const fid of functionIds) {
      const part = await listAllTrajectoryIdsByFunction(fid);
      ids.push(...part);
    }
    return { trajectoryIds: [...new Set(ids)], systemIdHint: systemId };
  }

  throw svcError('systemId, functionId, or trajectoryIds is required', 400);
}

function buildLlmPrompt(template, { phaseDescription, fragments, stepCount }) {
  const summary = fragments.map((f, i) => {
    const sem = f.semantics && Object.keys(f.semantics).length
      ? ` semantics=${JSON.stringify(f.semantics)}`
      : '';
    return `${i + 1}. ${f.actionType} keys=[${(f.paramKeys || []).join(',')}]${sem}`;
  }).join('\n');

  return [
    template.trim(),
    '',
    `阶段描述：${phaseDescription || '(无)'}`,
    `步骤数：${stepCount}`,
    '规范化步骤摘要：',
    summary || '(空)',
    '',
    '请只输出一个 JSON 对象，不要 Markdown。',
  ].join('\n');
}

async function nameClusterWithLlm({ phaseDescription, fragments, stepCount, model }) {
  const template = loadPromptTemplate();
  const prompt = buildLlmPrompt(template, { phaseDescription, fragments, stepCount });
  const modelId = model || 'Qwen/Qwen3.5-35B-A3B';
  try {
    const content = await callLLM(prompt, modelId);
    const obj = parseLlmJsonObject(content);
    if (!obj) return { llmFailed: true, name: null, key: null, description: null, paramSchema: null, confidence: null };
    return {
      llmFailed: false,
      name: obj.name != null ? String(obj.name).trim() : null,
      key: obj.key != null ? String(obj.key).trim() : null,
      description: obj.description != null ? String(obj.description).trim() : null,
      paramSchema: obj.paramSchema ?? obj.param_schema ?? null,
      confidence: obj.confidence != null ? Number(obj.confidence) : null,
    };
  } catch {
    return { llmFailed: true, name: null, key: null, description: null, paramSchema: null, confidence: null };
  }
}

/**
 * Mine repetitive phases into operation_component drafts.
 */
export async function mineOperationComponents(body = {}) {
  const { trajectoryIds, systemIdHint } = await resolveMineScope(body);
  if (!trajectoryIds.length) {
    return { created: [], updated: [], skippedSingletons: 0, scannedPhases: 0, trajectoryCount: 0 };
  }

  /** @type {Map<string, { systemId: number, signature: string, members: object[] }>} */
  const clusters = new Map();
  let scannedPhases = 0;

  for (const tid of trajectoryIds) {
    const traj = await trajectoryDao.getById(tid);
    if (!traj) continue;
    const systemId = systemIdHint || await resolveSystemIdForTrajectory(traj);
    if (!systemId) continue;

    const phases = await trajectoryPhaseDao.listByTrajectory(tid);
    for (const phase of phases) {
      const steps = await loadPhaseSteps(phase.id);
      if (!steps.length) continue;
      scannedPhases += 1;
      const { signature, fragments } = computePhaseSignature(steps);
      const key = `${systemId}::${signature}`;
      let cluster = clusters.get(key);
      if (!cluster) {
        cluster = { systemId, signature, members: [] };
        clusters.set(key, cluster);
      }
      cluster.members.push({
        traj,
        phase,
        steps,
        fragments,
        snapshot: stepsToSnapshot(steps),
      });
    }
  }

  const created = [];
  const updated = [];
  let skippedSingletons = 0;
  const model = body.model || undefined;

  for (const cluster of clusters.values()) {
    if (cluster.members.length < 2) {
      skippedSingletons += 1;
      continue;
    }

    // Pick longest snapshot as representative
    const sorted = cluster.members.slice().sort((a, b) => b.snapshot.length - a.snapshot.length);
    const rep = sorted[0];
    const existing = await componentDao.getBySystemAndSignature(cluster.systemId, cluster.signature);

    if (existing) {
      for (const m of cluster.members) {
        await occurrenceDao.create({
          componentId: existing.id,
          trajectoryId: m.traj.id,
          trajectoryPhaseId: m.phase.id,
          similarity: 1,
        });
      }
      const refreshed = await refreshOccurrenceCount(existing.id);
      updated.push(refreshed);
      continue;
    }

    const named = await nameClusterWithLlm({
      phaseDescription: rep.phase.description,
      fragments: rep.fragments,
      stepCount: rep.snapshot.length,
      model,
    });

    const name = named.name
      || String(rep.phase.description || '').trim().slice(0, 80)
      || `component-${cluster.signature.slice(0, 8)}`;

    const createdRow = await componentDao.create({
      name,
      key: named.key || null,
      description: named.description || rep.phase.description || null,
      grain: 'phase',
      systemId: cluster.systemId,
      status: 'draft',
      paramSchema: named.paramSchema,
      stepsJson: rep.snapshot,
      signature: cluster.signature,
      sourceTrajectoryId: rep.traj.id,
      sourcePhaseId: rep.phase.id,
      occurrenceCount: 0,
      confidence: Number.isFinite(named.confidence) ? named.confidence : null,
    });

    for (const m of cluster.members) {
      await occurrenceDao.create({
        componentId: createdRow.id,
        trajectoryId: m.traj.id,
        trajectoryPhaseId: m.phase.id,
        similarity: 1,
      });
    }
    const full = await refreshOccurrenceCount(createdRow.id);
    created.push({ ...full, llmFailed: !!named.llmFailed });
  }

  return {
    created,
    updated,
    skippedSingletons,
    scannedPhases,
    trajectoryCount: trajectoryIds.length,
    createdCount: created.length,
    updatedCount: updated.length,
  };
}
