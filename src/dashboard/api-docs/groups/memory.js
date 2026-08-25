/**
 * API group(s): business-data, system-ref-data, memory — extracted from catalog.js.
 * Keep in sync with src/routes/v2/*.js
 */
import { J } from './_j.js';

/** @type {TagGroup[]} */
export const GROUP_MEMORY = [
  {
    id: 'business-data',
    name: '业务数据（legacy）',
    description:
      'LEGACY：旧 business_data / business_data_entry。用户需求业务数据走 trajectory.task【业务数据】；'
      + '目标系统回写/已校验填表参考值请用「系统参考数据」system_ref_*。旧路径 /api/case-data → 410 Gone。',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/business-data',
        summary: '分页列表（legacy）',
        params: [
          { name: 'page', type: 'number', in: 'query', example: '1' },
          { name: 'pageSize', type: 'number', in: 'query', example: '20' },
        ],
        respExample: J({
          rows: [{ id: 1, recordId: 'case_xxx', sessionId: '...', keyCount: 5, description: '...' }],
          total: 1, page: 1, pageSize: 20,
        }),
      },
      {
        method: 'GET', path: '/api/v2/business-data/{recordId}',
        summary: '详情（含 entries，legacy）',
        params: [{ name: 'recordId', type: 'string', required: true, in: 'path', example: 'case_xxx' }],
      },
      {
        method: 'GET', path: '/api/v2/business-data/{recordId}/file',
        summary: '物化为本地 JSON 文件路径（legacy）',
        params: [{ name: 'recordId', type: 'string', required: true, in: 'path', example: 'case_xxx' }],
      },
      {
        method: 'DELETE', path: '/api/v2/business-data/{recordId}',
        summary: '删除（legacy）',
        params: [{ name: 'recordId', type: 'string', required: true, in: 'path', example: 'case_xxx' }],
      },
    ],
  },
  {
    id: 'system-ref-data',
    name: '系统参考数据',
    description:
      '目标系统回写/经校验可复用的填表参考值（system_ref_data / system_ref_entry）。'
      + '≠ 用户需求业务数据；≠ legacy business_data。本迭代仅 CRUD 地基，录制暂不自动注入。',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/system-ref-data',
        summary: '分页列表（可按交易/校验状态过滤）',
        params: [
          { name: 'page', type: 'number', in: 'query', example: '1' },
          { name: 'pageSize', type: 'number', in: 'query', example: '20' },
          { name: 'trajectoryId', type: 'number', in: 'query', example: '42' },
          {
            name: 'verificationStatus', type: 'string', in: 'query',
            desc: 'raw | verified | rejected', example: 'verified',
          },
        ],
        respExample: J({
          rows: [{
            id: 1, recordId: 'sref_xxx', trajectoryId: 42,
            source: 'system_capture', verificationStatus: 'raw', keyCount: 2,
          }],
          total: 1, page: 1, pageSize: 20,
        }),
      },
      {
        method: 'GET', path: '/api/v2/system-ref-data/{id}',
        summary: '详情（含 entries）',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
      },
      {
        method: 'DELETE', path: '/api/v2/system-ref-data/{id}',
        summary: '删除头表（级联 entries）',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
      },
      {
        method: 'GET', path: '/api/v2/trajectories/{id}/system-ref-entries',
        summary: '按交易列出系统参考 KV',
        params: [
          { name: 'id', type: 'number', required: true, in: 'path', example: '42' },
          {
            name: 'verificationStatus', type: 'string', in: 'query',
            desc: 'raw | verified | rejected', example: 'verified',
          },
        ],
        respExample: J({
          trajectoryId: 42,
          entries: [
            { id: 1, fieldKey: '客户名称', fieldValue: '某某公司', verificationStatus: 'verified' },
          ],
        }),
      },
      {
        method: 'PUT', path: '/api/v2/trajectories/{id}/system-ref-entries',
        summary: '按交易全量替换系统参考 KV',
        desc:
          '先删后插。写入目标系统回写/人工导入的参考值；禁止把用户需求业务数据块当 system_ref 写入。'
          + 'verificationStatus=verified 表示经校验可复用。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({
          source: 'system_capture',
          verificationStatus: 'raw',
          entries: [
            { fieldKey: '客户名称', fieldValue: '某某科技有限公司' },
            { fieldKey: '证件号码', fieldValue: '91440101MA5XXXXXX' },
          ],
        }),
        respExample: J({
          trajectoryId: 42,
          entries: [{ id: 1, fieldKey: '客户名称', fieldValue: '某某科技有限公司', trajectoryId: 42 }],
          header: { id: 1, recordId: 'sref_xxx', verificationStatus: 'raw' },
        }),
      },
      {
        method: 'DELETE', path: '/api/v2/trajectories/{id}/system-ref-entries',
        summary: '删除该交易全部系统参考数据',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
      },
    ],
  },
  {
    id: 'memory',
    name: '记忆 / 审计',
    description:
      'AI 记忆系统（P0/P1/P2）：事件摄取、Fact Pack 检索（可含同功能历史复用）、决策记录、审计汇总与多模型对比。外部 Vue 审计页据此渲染。'
      + '决策类型：form_value / scenario_summary / heal（回放自愈）/ analyze_phase；agent_step 本迭代不做。'
      + 'AI_MEMORY_HISTORY 默认关；开启后 retrieve 传 functionId 并入历史事实（低权重）。'
      + 'GET /memory/compare：同需求多模型录制对比（步骤数 / 成功 / 审计通过率 / 填表值并集一致性）。',
    endpoints: [
      {
        method: 'POST', path: '/api/v2/memory/events',
        summary: '批量摄取记忆事件（旁路写）',
        desc: 'Body: { events: [...] } 或直接数组。事件可内嵌 facts[] / decision{}。Agent 主路径不等待落库。',
        reqExample: J({
          events: [{
            eventType: 'business_saved',
            trajectoryId: 42,
            phaseNumber: 1,
            payload: { key: '客户名称', value: '某某公司' },
          }],
        }),
        respExample: J({ inserted: 1, facts: 0, decisions: 0, relations: 0 }),
      },
      {
        method: 'POST', path: '/api/v2/memory/retrieve',
        summary: '检索 Fact Pack（阶段开始前注入用）',
        desc: '传 functionId 且 AI_MEMORY_HISTORY=true 时，并入同功能历史成功交易的当前版本事实（source=history, stance=inferred, weight×0.5，排序靠后，绝不覆盖本交易 requirement 事实）。',
        reqExample: J({ trajectoryId: 42, phaseNumber: 2, entity: '', limit: 50, maxChars: 2000, functionId: 7 }),
        respExample: J({
          facts: [
            { id: 7, entity: '客户名称', attribute: 'value', value: '某某公司', source: 'requirement', stance: 'authoritative', effectiveWeight: 1.2 },
            { id: 99, entity: '联系人', attribute: 'value', value: '历史联系人', source: 'history', stance: 'inferred', effectiveWeight: 0.3 },
          ],
          dropped: [],
          budget: { used: 800, max: 2000, limit: 50 },
        }),
      },
      {
        method: 'GET', path: '/api/v2/memory/decisions',
        summary: '决策列表（按交易/阶段/类型/状态过滤）',
        params: [
          { name: 'trajectoryId', type: 'number', in: 'query', example: '42' },
          { name: 'phaseNumber', type: 'number', in: 'query', example: '1' },
          {
            name: 'decisionType', type: 'string', in: 'query',
            desc: 'form_value | scenario_summary | heal | analyze_phase', example: 'scenario_summary',
          },
          { name: 'auditStatus', type: 'string', in: 'query', desc: 'pending | passed | failed', example: 'passed' },
          { name: 'limit', type: 'number', in: 'query', example: '50' },
          { name: 'offset', type: 'number', in: 'query', example: '0' },
        ],
      },
      {
        method: 'GET', path: '/api/v2/memory/decisions/{id}',
        summary: '决策详情（含 inputFacts 回填）',
        desc: 'inputFactIds 为引用事实 id；inputFacts 为对应事实正文（含被 supersede 版本），供审计复现「模型依据了什么」。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '9' }],
        respExample: J({
          id: 9, trajectoryId: 42, decisionType: 'scenario_summary', model: 'Qwen/Qwen3.5-35B-A3B',
          auditStatus: 'passed', inputFactIds: [7, 8],
          inputFacts: [
            { id: 7, entity: '客户名称', attribute: 'value', value: '某某公司', source: 'requirement', stance: 'authoritative', weight: 1.5, phaseNumber: 1 },
          ],
        }),
      },
      {
        method: 'GET', path: '/api/v2/memory/audit/summary',
        summary: '审计汇总（含 topReferencedFacts）',
        desc: '仅按 trajectoryId 聚合；topReferencedFacts 为该交易决策中被引用最多的事实 Top10。',
        params: [{ name: 'trajectoryId', type: 'number', required: true, in: 'query', example: '42' }],
        respExample: J({
          trajectoryId: 42, total: 12, byStatus: { pending: 0, passed: 11, failed: 1 }, overridden: 0,
          topReferencedFacts: [
            { id: 7, refs: 5, entity: '客户名称', attribute: 'value', value: '某某公司' },
          ],
        }),
      },
      {
        method: 'GET', path: '/api/v2/memory/compare',
        summary: '多模型对比报告（P2-4）',
        desc:
          '对已录制的多条交易（通常同需求、不同 model）汇总步骤数、成功状态、审计通过率与填表值一致性。'
          + 'formValues 仅含 source∈{llm,page,rule,agent,observer}（排除 requirement/history）。'
          + 'consistency 用 entity 并集分母（缺字段=不一致）；找到 <2 条时 consistency=null。'
          + '无 token 用量字段，用 isSuccessful + decisions.passRate 代理。'
          + '400=无有效 id；404=全部缺失；200=至少找到 1 条（含 missingIds）。',
        params: [{
          name: 'trajectoryIds', type: 'string', required: true, in: 'query',
          example: '10,11', desc: '逗号分隔交易 id（2–10；重复 query 亦可）',
        }],
        respExample: J({
          trajectories: [{
            id: 10, model: 'Qwen/Qwen3.5-35B-A3B', stepCount: 42, phaseCount: 5,
            isSuccessful: true, isDone: true, task: '…',
            decisions: { total: 12, byStatus: { pending: 0, passed: 11, failed: 1 }, passRate: 0.9167, overridden: 0 },
            formValues: { 客户名称: '某某公司' },
          }],
          consistency: {
            entitiesCompared: 8, exactMatchRate: 0.625,
            pairwise: [{ a: 10, b: 11, matchRate: 0.7, compared: 10 }],
          },
          missingIds: [],
          note: 'token usage not stored; use decisions.passRate and isSuccessful as success proxies',
        }),
      },
      {
        method: 'POST', path: '/api/v2/memory/audit/run',
        summary: '离线复检整条交易',
        reqExample: J({ trajectoryId: 42 }),
      },
      {
        method: 'GET', path: '/api/v2/trajectories/{id}/memory',
        summary: '交易记忆时间线（events + facts + decisions）',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
      },
      {
        method: 'GET', path: '/api/v2/memory/stats',
        summary: '记忆表统计',
        respExample: J({
          tables: { memoryEvent: 120, memoryFact: 45, memoryRelation: 30, decisionRecord: 12 },
          recentEventTypes: [{ eventType: 'business_saved', count: 20 }],
        }),
      },
    ],
  },
];
