/**
 * API group(s): kb — extracted per kb-insights plan.
 * Keep in sync with src/routes/v2/kb.js
 */

/** @typedef {{ name: string, type: string, required?: boolean, in?: 'path'|'query'|'body', desc: string, example?: string }} Param */
/** @typedef {{ method: string, path: string, summary: string, desc?: string, params?: Param[], reqExample?: string, respExample?: string, notes?: string[], deprecated?: boolean, tryable?: boolean }} Endpoint */
/** @typedef {{ id: string, name: string, description: string, endpoints: Endpoint[] }} TagGroup */

import { J } from './_j.js';

/** @type {TagGroup[]} */
export const GROUP_KB = [{
  id: 'kb',
  name: 'KB 洞察',
  description:
    '信贷知识库：洞察只读面（流程卡溯源与失效检测，与 data/kb/flows 单向只读）'
    + '；需求作业区登记（data/kb/req/<moduleKey>/ manifest + chapters/drafts 工作区）'
    + '；需求切片→draft 交易两段式（draft-traj/propose 原子候选 → commit 建 draft，全程不录制）。',
  endpoints: [
    {
      method: 'GET', path: '/api/v2/kb/cards',
      summary: '流程卡清单（flow/menu_path/source/source_refs 溯源）',
      respExample: J([{
        flow: '对公授信申请', menu_path: '授信管理/对公授信管理/新增对公授信管理',
        source: 'K1 2026-08-31 + 交易 203-206',
        source_refs: { trajectory_ids: ['26081317115618826'], tx_nos: ['009'], dates: ['2026-09-01'] },
      }]),
    },
    {
      method: 'GET', path: '/api/v2/kb/stale-cards',
      summary: '卡 menu_path 对当前树三态解析（matched/possibly-stale/unparsed，只读）',
      respExample: J({
        cards: [{ flow: '某卡', menu_path: '授信管理/已删菜单', matchStatus: 'possibly-stale', missingSegment: '已删菜单', resolvedPrefix: '授信管理' }],
        summary: { total: 25, matched: 20, possiblyStale: 2, unparsed: 3 },
      }),
    },
    {
      method: 'POST', path: '/api/v2/kb/req-modules',
      summary: '登记或幂等更新需求模块作业区',
      desc: '在 data/kb/req/<moduleKey>/ 创建 manifest、source.link.json 与 chapters/drafts 目录；'
        + ' sourcePath 不可达时 manifest.warnings 含提示但不阻断登记。',
      reqExample: J({
        moduleKey: 'product-mgmt',
        moduleName: '产品管理',
        sourcePath: 'C:/docs/product-mgmt.docx',
        note: '首批导入',
        reset: false,
      }),
      respExample: J({
        code: 200,
        message: 'ok',
        data: {
          moduleKey: 'product-mgmt',
          dir: 'D:/dev/JS-gen/data/kb/req/product-mgmt',
          manifest: {
            moduleKey: 'product-mgmt',
            moduleName: '产品管理',
            sourcePath: 'C:/docs/product-mgmt.docx',
            sourceKind: 'req',
            status: 'registered',
            warnings: ['sourcePath not accessible from server'],
            createdAt: '2026-09-05T10:00:00.000Z',
            updatedAt: '2026-09-05T10:00:00.000Z',
          },
        },
      }),
      notes: ['moduleKey 须小写字母数字与连字符段；reset=true 清空 chapters/drafts 产物'],
    },
    {
      method: 'GET', path: '/api/v2/kb/req-modules',
      summary: '已登记需求模块清单',
      respExample: J({
        code: 200,
        message: 'ok',
        data: {
          rows: [{
            moduleKey: 'product-mgmt',
            moduleName: '产品管理',
            sourcePath: 'C:/docs/product-mgmt.docx',
            sourceKind: 'req',
            status: 'registered',
            warnings: [],
            hasThroughChains: true,
            canProposeAtoms: true,
            createdAt: '2026-09-05T10:00:00.000Z',
            updatedAt: '2026-09-05T10:00:00.000Z',
          }],
        },
      }),
      notes: [
        'hasThroughChains=文件存在；canProposeAtoms=解析后至少一条表格步骤（draft-traj propose 可结构化出候选）',
      ],
    },
    {
      method: 'GET', path: '/api/v2/kb/req-modules/:moduleKey',
      summary: '需求模块详情（manifest + 目录探测字段）',
      params: [
        { name: 'moduleKey', type: 'string', required: true, in: 'path', desc: '模块键', example: 'product-mgmt' },
      ],
      respExample: J({
        code: 200,
        message: 'ok',
        data: {
          moduleKey: 'product-mgmt',
          moduleName: '产品管理',
          sourcePath: 'C:/docs/product-mgmt.docx',
          sourceKind: 'req',
          status: 'registered',
          warnings: [],
          hasChapters: true,
          hasThroughChains: false,
          draftCount: 0,
          createdAt: '2026-09-05T10:00:00.000Z',
          updatedAt: '2026-09-05T10:00:00.000Z',
        },
      }),
      notes: ['模块不存在 → NOT_FOUND'],
    },
    {
      method: 'POST', path: '/api/v2/kb/req-modules/:moduleKey/source',
      summary: '上传源文档到作业区（v1 未实现）',
      params: [
        { name: 'moduleKey', type: 'string', required: true, in: 'path', desc: '模块键', example: 'product-mgmt' },
      ],
      notes: ['v1 固定返回 HTTP 501（multipart upload not implemented in v1）'],
    },
    {
      method: 'POST', path: '/api/v2/kb/req-modules/:moduleKey/draft-traj/propose',
      summary: '从 through-chains 生成可勾选原子候选（写 .draft-traj-propose.json）',
      desc: '解析模块 through-chains.md，LLM 原子化后仅返回出处齐全的可选原子；出处不可解析的进 rejected。',
      params: [
        { name: 'moduleKey', type: 'string', required: true, in: 'path', desc: '模块键', example: 'product-mgmt' },
        { name: 'chainIds', type: 'string[]', in: 'body', desc: '可选，限定主链 id 子集' },
        { name: 'maxAtoms', type: 'number', in: 'body', desc: '可选，截断返回原子数上限' },
      ],
      reqExample: J({ chainIds: ['chain-a'], maxAtoms: 5 }),
      respExample: J({
        code: 200,
        message: 'ok',
        data: {
          atoms: [{
            atomKey: 'product-mgmt:chain-a:2',
            title: '新增一级分类',
            suggestedFunctionId: 9000000740,
            sourceDoc: 'product-mgmt.docx',
            sourceChapter: 'chapters/01-product-library.md#产品库管理',
            taskDraft: '1、进入产品库。\n2、点击新增一级分类…\n\n来源：product-mgmt.docx / chapters/01-product-library.md\n',
            phaseHints: ['进入产品库', '新增一级分类并确定'],
            pageCodes: ['ZJJK00107304'],
            suggestedFlowRef: 'product_library',
            suggestedNodeId: 'add_category',
          }],
          rejected: [{ atomKey: 'product-mgmt:chain-a:1', reason: 'empty_task_draft' }],
        },
      }),
      notes: [
        '模块未登记 → NOT_FOUND/404',
        '缺 through-chains.md → 400 VALIDATION',
        '不建交易、不录制',
        'atomKey 形如 <module>:<chain>:<step>，与步骤标题无关（LLM 重跑稳定）',
        'pageCodes 为页面/组件编号元数据；关键数据块不应再堆 ZJJK 表',
      ],
    },
    {
      method: 'POST', path: '/api/v2/kb/req-modules/:moduleKey/draft-traj/commit',
      summary: '勾选原子 analyze→建 draft 交易（写出处字段，不录制）',
      desc: '从 propose 缓存读取 atomKeys 子集，analyze 后创建 recordStatus=draft 的交易；默认同 req_atom_key 已有草稿则 skip。',
      params: [
        { name: 'moduleKey', type: 'string', required: true, in: 'path', desc: '模块键', example: 'product-mgmt' },
        { name: 'atomKeys', type: 'string[]', required: true, in: 'body', desc: '勾选的原子键列表' },
        { name: 'systemAccountId', type: 'number', in: 'body', desc: '可选，系统账号 id' },
        { name: 'paasUserId', type: 'string', in: 'body', desc: '可选，操作人 PaaS 用户 id（审计透传到轨迹）' },
        { name: 'functionIdOverrides', type: 'object', in: 'body', desc: '可选，按 atomKey 覆盖 functionId' },
        { name: 'flowRefOverrides', type: 'object', in: 'body', desc: '可选，按 atomKey 覆盖 kbFlowRef/kbFlowNodeId' },
        { name: 'force', type: 'boolean', in: 'body', desc: '可选，true 时跳过重复草稿检查' },
      ],
      reqExample: J({
        atomKeys: ['product-mgmt:chain-a:2'],
        systemAccountId: 1,
        paasUserId: '1900000000000000001',
        functionIdOverrides: { 'product-mgmt:chain-a:2': 9000000740 },
        flowRefOverrides: { 'product-mgmt:chain-a:2': { kbFlowRef: 'product_library', kbFlowNodeId: 'add_category' } },
        force: false,
      }),
      respExample: J({
        code: 200,
        message: 'ok',
        data: {
          created: [{ trajectoryId: 4242, atomKey: 'product-mgmt:chain-a:2', name: '新增一级分类' }],
          skipped: [{ atomKey: 'product-mgmt:chain-a:9', reason: 'unknown_or_stale_atom' }],
        },
      }),
      notes: ['atomKeys 必填且非空', '未先 propose → 400', '缺 functionId 且无 override → skipped missing_function_id', '同键已有任意状态轨迹（draft/recorded…）→ skipped duplicate_draft；force 时 req_atom_seq 递增重建', 'analyze 失败的原子进 skipped，其余继续', '不调用 prepare/record'],
    },
    {
      method: 'POST', path: '/api/v2/kb/req-modules/:moduleKey/draft-traj/validate',
      summary: 'commit 预校验（dry-run，不写库、不调 LLM）',
      desc: '与 commit 共用同一校验函数：缓存存在性、出处齐全、任意状态重复、functionId 存在性；返回会成功/会失败清单。',
      params: [
        { name: 'moduleKey', type: 'string', required: true, in: 'path', desc: '模块键', example: 'product-mgmt' },
        { name: 'atomKeys', type: 'string[]', required: true, in: 'body', desc: '待提交的原子键列表' },
        { name: 'functionIdOverrides', type: 'object', in: 'body', desc: '可选，按 atomKey 覆盖 functionId' },
        { name: 'force', type: 'boolean', in: 'body', desc: '可选，true 时不报 duplicate_draft' },
      ],
      reqExample: J({
        atomKeys: ['product-mgmt:chain-a:2', 'product-mgmt:chain-a:3'],
        functionIdOverrides: {},
        force: false,
      }),
      respExample: J({
        code: 200,
        message: 'ok',
        data: {
          ok: ['product-mgmt:chain-a:2'],
          problems: [
            { atomKey: 'product-mgmt:chain-a:3', code: 'missing_function_id', message: 'no suggestedFunctionId and no override' },
          ],
        },
      }),
      notes: ['与 commit 同输入时 problems 与 commit 的 skipped 同源（analyze/create 失败不可预知）', '未先 propose → 400'],
    },
  ],
}];
