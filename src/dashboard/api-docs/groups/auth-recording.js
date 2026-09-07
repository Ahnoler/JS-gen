/**
 * API group: auth-recording — login/logout automated recording.
 * Keep in sync with src/routes/v2/auth-recording.js
 */

/** @typedef {{ name: string, type: string, required?: boolean, in?: 'path'|'query'|'body', desc: string, example?: string }} Param */
/** @typedef {{ method: string, path: string, summary: string, desc?: string, params?: Param[], reqExample?: string, respExample?: string, notes?: string[], deprecated?: boolean, tryable?: boolean }} Endpoint */
/** @typedef {{ id: string, name: string, description: string, endpoints: Endpoint[] }} TagGroup */

import { J } from './_j.js';

/** @type {TagGroup[]} */
export const GROUP_AUTH_RECORDING = [
  {
    id: 'auth-recording',
    name: '登录/登出自动录制',
    description:
      '系统级两段式演练录制：login + logout 轨迹自动创建并由执行机 fire-and-forget 录制，'
      + '成功后自动沉淀 login/logout 组件（operation_component）。'
      + '系统创建时自动触发一次；也可手动触发。',
    endpoints: [
      {
        method: 'POST', path: '/api/v2/systems/{id}/auth-recording',
        summary: '触发登录/登出自动录制任务',
        desc: '校验系统 url 与账号（默认取系统第一个账号）后创建 job 并立即返回。同系统存在 pending/running job 时 409（超过 30 分钟无心跳的 stale job 会被置 failed 并允许重新触发）。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', desc: '系统节点 id', example: '1' }],
        reqExample: J({ accountId: 3 }),
        respExample: J({ jobId: 12 }),
        notes: [
          'body 可省略；accountId 指定登录用的 system_account（须属于该系统且有账号+密码）',
          '系统无 url 或无可用的账号+密码 → 400',
          '录制成功后自动注册 login/logout 两个组件',
        ],
      },
      {
        method: 'GET', path: '/api/v2/systems/{id}/auth-recording',
        summary: '查询最近一次自动录制状态',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', desc: '系统节点 id', example: '1' }],
        respExample: J({
          job: { id: 12, systemId: 1, status: 'running', accountId: 3, loginTrajectoryId: 101, logoutTrajectoryId: 102, error: null },
          loginTrajectory: { id: 101, recordStatus: 'recording', stepCount: 4, authKind: 'login' },
          logoutTrajectory: { id: 102, recordStatus: 'draft', stepCount: 0, authKind: 'logout' },
        }),
        notes: [
          'job.status: pending / running / success / failed',
          'job 为 null 表示该系统从未触发过',
        ],
      },
    ],
  },
];
