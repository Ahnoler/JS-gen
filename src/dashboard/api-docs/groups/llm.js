/**
 * API group: LLM 配置 — 网关模型列表。
 * Keep in sync with src/routes/llm-proxy.js
 */

/** @typedef {{ name: string, type: string, required?: boolean, in?: 'path'|'query'|'body', desc: string, example?: string }} Param */
/** @typedef {{ method: string, path: string, summary: string, desc?: string, params?: Param[], reqExample?: string, respExample?: string, notes?: string[], deprecated?: boolean, tryable?: boolean }} Endpoint */
/** @typedef {{ id: string, name: string, description: string, endpoints: Endpoint[] }} TagGroup */

import { J } from './_j.js';

/** @type {TagGroup[]} */
export const GROUP_LLM = [
  {
    id: 'llm',
    name: 'LLM 配置',
    description: 'LLM 网关连通性与可用模型查询。模型名含 provider 前缀（如 Qwen/Qwen3.5-35B-A3B）需整名使用；默认模型统一由 config/.env 的 LLM_MODEL 配置。',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/llm/models',
        summary: '可用模型列表',
        desc: '代理网关 GET {LLM_BASE_URL}/models，返回可用模型 id 列表与当前默认模型。配置的模型报 model_not_found 时用此接口确认可用名称；网关不可达返回 502。',
        respExample: J({
          ok: true,
          baseUrl: 'http://218.77.58.156:3000/v1',
          defaultModel: 'Qwen/Qwen3.5-35B-A3B',
          models: ['Qwen/Qwen3.5-35B-A3B', 'ZhipuAI/GLM-4.7-Flash'],
        }),
      },
    ],
  },
];
