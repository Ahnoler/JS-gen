/**
 * API group: L1c region classify — keep in sync with src/routes/v2/regions.js
 */
import { J } from './_j.js';

/** @type {TagGroup[]} */
export const GROUP_REGIONS = [
  {
    id: 'regions',
    name: '区域分类 (L1c)',
    description:
      '规则 + 可选 LLM（`L1C_LLM`）对 feature card 做 L1 区域分类；L1d 进程内缓存按 systemId + signature。'
      + ' resolve-element 与 scan/fullpage 共用 `classifyRegions` 服务。',
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
          '配置：L1C_LLM、L1C_LLM_TIMEOUT_MS（见 config/.env.example）',
        ],
      },
    ],
  },
];
