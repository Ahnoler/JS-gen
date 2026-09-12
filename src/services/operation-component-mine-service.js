/**
 * Offline mine: scan trajectory phases, signature-cluster, LLM-name new drafts.
 * Existing (system_id, signature) components: add occurrences only — never overwrite copy.
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { callLLM } from '../llm-utils.js';
import { LLM_MODEL } from '#config/config.js';
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

/**
 * 创建用于挖掘作用域和输入失败的校验类错误。
 * @param {string} message 错误消息
 * @param {number} [statusCode] HTTP 状态码
 * @returns {Error & {statusCode: number}} 已配置的服务错误
 */
function svcError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * 从磁盘加载组件命名提示词，并提供最小的本地回退内容。
 * @returns {string} 提示词模板文本
 */
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

/**
 * 分页读取绑定到某个功能的全部轨迹。
 * @param {number} functionId 功能节点 ID
 * @returns {Promise<number[]>} 从所有分页中发现的轨迹 ID
 */
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
 * @param {object} body mine scope input
 * @returns {Promise<{trajectoryIds: number[], systemIdHint: number|null}>} resolved trajectory ids + system hint
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

/**
 * 为一个签名簇组装严格 JSON 命名提示词。
 * @param {string} template 基础提示词文本
 * @param {object} input 簇描述和签名片段
 * @param {string} [input.phaseDescription] 代表性阶段描述
 * @param {object[]} input.fragments 确定性的签名片段
 * @param {number} input.stepCount 代表性步骤数量
 * @returns {string} 完整的 LLM 提示词
 */
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

/**
 * 请求配置的 LLM 为重复阶段簇命名，并规范化输出。
 * @param {object} input 簇命名输入
 * @param {string} [input.phaseDescription] 代表性阶段描述
 * @param {object[]} input.fragments 签名片段
 * @param {number} input.stepCount 代表性步骤数量
 * @param {string} [input.model] 可选的模型覆盖值
 * @returns {Promise<object>} 规范化的命名结果，包括 `llmFailed`
 */
async function nameClusterWithLlm({ phaseDescription, fragments, stepCount, model }) {
  const template = loadPromptTemplate();
  const prompt = buildLlmPrompt(template, { phaseDescription, fragments, stepCount });
  const modelId = model || LLM_MODEL;
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
 * @param {object} [body] mine scope (systemId / functionId / trajectoryIds)
 * @returns {Promise<{ created: object[], updated: object[], skippedSingletons: number, scannedPhases: number, trajectoryCount: number, createdCount: number, updatedCount: number }>} mine stats
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
