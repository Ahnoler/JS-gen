/**
 * API group: L1c region classify — keep in sync with src/routes/v2/regions.js
 */

/** @typedef {{ name: string, type: string, required?: boolean, in?: 'path'|'query'|'body', desc: string, example?: string }} Param */
/** @typedef {{ method: string, path: string, summary: string, desc?: string, params?: Param[], reqExample?: string, respExample?: string, notes?: string[], deprecated?: boolean, tryable?: boolean }} Endpoint */
/** @typedef {{ id: string, name: string, description: string, endpoints: Endpoint[] }} TagGroup */

import { J } from './_j.js';

/** @type {TagGroup[]} */
export const GROUP_REGIONS = [
  {
    id: 'regions',
    name: '区域分类 (L1c)',
    description:
      'L1c = L1 区域分类：对页面分区 feature card（shell/main/section/overlay…）打 role/label；'
      + '规则优先，可选 LLM（`L1C_LLM`）；L1d 按 systemId+signature 缓存；'
      + ' resolve-element 与 scan/fullpage 共用 `classifyRegions`。'
      + ' 环境变量：`L1C_LLM` / `L1C_LLM_MODEL` / `L1C_LLM_BASE_URL` / `L1C_LLM_API_KEY` / `L1C_LLM_TIMEOUT_MS`'
      + '（未设回落主 LLM_*）。',
    endpoints: [
      {
        method: 'POST',
        path: '/api/v2/regions/classify',
        summary: '批量分类 UI 区域 feature card',
        desc:
          '输入 L1b feature card 数组；返回带 `role` / `label` / `confidence` / `source`（rule|llm|l1d）的分类结果。'
          + ' `L1C_LLM=false`（默认）时仅规则 + L1d 读，不发起 LLM 调用。',
        reqExample: J({
          systemId: '42',
          cards: [
            {
              classTokens: ['el-main'],
              title: '',
              band: 'center',
              flags: {},
              childCounts: {},
              ruleRole: 'other',
              ruleConfidence: 0.4,
            },
          ],
        }),
        respExample: J({
          items: [
            {
              classTokens: ['el-main'],
              title: '',
              band: 'center',
              flags: {},
              childCounts: {},
              ruleRole: 'other',
              ruleConfidence: 0.4,
              role: 'other',
              label: 'other',
              confidence: 0.4,
              source: 'rule',
              signature: 'a1b2c3d4…',
            },
          ],
        }),
        notes: [
          'body 接受 systemId 或 system_id（字符串/数字均可，用于 L1d 缓存键）',
          'cards 缺省或非数组 → 空 items',
          'LLM 失败/超时：单卡 fallback 为 rule，附 fallback_reason=llm_error；不丢输入卡',
          'config/.env：`L1C_LLM`、`L1C_LLM_MODEL`、`L1C_LLM_BASE_URL`、`L1C_LLM_API_KEY`、`L1C_LLM_TIMEOUT_MS`（未设回落主 LLM_*）',
        ],
      },
    ],
  },
];
