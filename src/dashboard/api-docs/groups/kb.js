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
  description: '信贷知识库流程卡只读面：溯源清单与失效检测（与 data/kb/flows 单向只读）',
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
  ],
}];
