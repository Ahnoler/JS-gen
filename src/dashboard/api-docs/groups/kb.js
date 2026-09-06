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
    + '；需求作业区登记（data/kb/req/<moduleKey>/ manifest + chapters/drafts 工作区）。',
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
            createdAt: '2026-09-05T10:00:00.000Z',
            updatedAt: '2026-09-05T10:00:00.000Z',
          }],
        },
      }),
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
  ],
}];
