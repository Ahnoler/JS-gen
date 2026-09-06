/**
 * API group(s): remote-session, screenshot, api-override — extracted from catalog.js.
 * Keep in sync with src/routes/v2/*.js
 */

/** @typedef {{ name: string, type: string, required?: boolean, in?: 'path'|'query'|'body', desc: string, example?: string }} Param */
/** @typedef {{ method: string, path: string, summary: string, desc?: string, params?: Param[], reqExample?: string, respExample?: string, notes?: string[], deprecated?: boolean, tryable?: boolean }} Endpoint */
/** @typedef {{ id: string, name: string, description: string, endpoints: Endpoint[] }} TagGroup */

import { J } from './_j.js';

/** @type {TagGroup[]} */
export const GROUP_REMOTE = [
  {
    id: 'remote-session',
    name: '远程会话 / BiB',
    description: 'CDP 附着与推流状态（录制工作室左侧画布）。多交易并存时以 trajectoryId / remoteSessionId 隔离，勿依赖全局 singleton。',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/remote-sessions/live/status',
        summary: '当前 live 状态',
        desc: '推荐带 trajectoryId 查询本交易推流；省略时返回任一已附着绑定（工程调试）。',
        params: [
          { name: 'trajectoryId', type: 'number', in: 'query', example: '42' },
          { name: 'remoteSessionId', type: 'number', in: 'query', example: '7' },
          { name: 'sessionId', type: 'string', in: 'query', example: 'uuid' },
        ],
        respExample: J({
          attached: true, remoteSessionId: 7, remoteSessionUuid: 'uuid',
          sessionId: 'uuid', trajectoryId: 42,
          cdpReady: true, inputEnabled: true, agentBusy: false,
          viewportW: 1600, viewportH: 900, manualRecording: false,
        }),
      },
      {
        method: 'POST', path: '/api/v2/remote-sessions/attach-live',
        summary: '附着 CDP + 推流',
        reqExample: J({ sessionId: 'uuid', trajectoryId: 42, quality: 0.65, viewportW: 1600, viewportH: 900 }),
        respExample: J({ remoteSession: { id: 7 }, status: { attached: true, remoteSessionId: 7, trajectoryId: 42 } }),
        notes: [
          '503：CDP/页面未就绪',
          '须传 sessionId；按 trajectoryId 写入 live 映射',
          '409 `grace_owned`：宽限期内他交易 idle Chrome 仍归属原 traj — `{ error, code: "grace_owned", ownerTrajectoryId: 42, graceUntil: "2026-08-11T12:00:00.000Z" }`',
        ],
      },
      {
        method: 'GET', path: '/api/v2/remote-sessions',
        summary: '分页列表',
        params: [
          { name: 'page', type: 'number', in: 'query', example: '1' },
          { name: 'pageSize', type: 'number', in: 'query', example: '20' },
        ],
      },
      {
        method: 'POST', path: '/api/v2/remote-sessions',
        summary: '新建会话记录',
        reqExample: J({ sessionId: 'uuid', viewportW: 1600, viewportH: 900 }),
      },
      {
        method: 'GET', path: '/api/v2/remote-sessions/{id}',
        summary: '详情（id 或 uuid）',
        params: [{ name: 'id', type: 'string', required: true, in: 'path', example: '7' }],
      },
      {
        method: 'PATCH', path: '/api/v2/remote-sessions/{id}',
        summary: '更新视口等',
        params: [{ name: 'id', type: 'string', required: true, in: 'path', example: '7' }],
        reqExample: J({ viewportW: 1600, viewportH: 900 }),
      },
      {
        method: 'POST', path: '/api/v2/remote-sessions/{id}/detach',
        summary: '断开画面推流（不停浏览器）',
        desc: 'remote_session → idle 并设 grace_until；可选 body.trajectoryId 做归属校验。Chrome 与 Agent 会话仍存活。产品路径优先用 POST /trajectories/{id}/stream/detach。与 trajectories/:id/detach（释放执行资源、关浏览器）不同。',
        params: [{ name: 'id', type: 'string', required: true, in: 'path', example: '7' }],
        reqExample: J({ trajectoryId: 42 }),
        notes: [
          '409：body.trajectoryId 与 remote_session.trajectory_id 不一致',
          'streamDetach 后 grace 内保留归属；他交易 attach 同 session → 409 `grace_owned`（见 attach-live）',
        ],
      },
      {
        method: 'POST', path: '/api/v2/remote-sessions/{id}/close',
        summary: '关闭会话',
        params: [{ name: 'id', type: 'string', required: true, in: 'path', example: '7' }],
      },
      {
        method: 'DELETE', path: '/api/v2/remote-sessions/{id}',
        summary: '删除记录',
        params: [{ name: 'id', type: 'string', required: true, in: 'path', example: '7' }],
      },
    ],
  },
  {
    id: 'screenshot',
    name: '截图管理',
    description: '按 trajectory_step 绑定的 before/after 截图；`kind=phase_highlight` 行绑定 trajectory_phase（`trajectoryPhaseId` 有值、`trajectoryStepId` 为 null）；`kind=phase_group` 行为阶段内状态组截图（`trajectoryPhaseId` + `stateGroup` 唯一，步骤经 `group_shot_id` 绑定）；回放中亦可经 WS replay:screenshot 获取临时 URL',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/screenshots/pending',
        summary: '待补传截图列表',
        desc: '返回所有 `storage_type=local` 的截图，即 MinIO 上传失败后暂存在本地的图片。',
        respExample: J([{
          id: 1, storageType: 'local', retryCount: 2, lastRetryAt: '2026-08-18T12:00:00.000Z',
          fileSize: 12345, mimeType: 'image/png', trajectoryStepId: 501, kind: 'before',
          imageUrl: '/api/v2/screenshots/1/image',
        }]),
      },
      {
        method: 'GET', path: '/api/v2/trajectories/{trajectoryId}/screenshots',
        summary: '交易关联截图列表',
        params: [{ name: 'trajectoryId', type: 'number', required: true, in: 'path', example: '42' }],
        respExample: J([{
          id: 1, fileSize: 12345,
          mimeType: 'image/png', trajectoryStepId: 501, stepNumber: 1, kind: 'before',
        }, {
          id: 88, fileSize: 456789,
          mimeType: 'image/png', trajectoryPhaseId: 101, trajectoryStepId: null, kind: 'phase_highlight',
        }, {
          id: 900, fileSize: 234561,
          mimeType: 'image/png', trajectoryPhaseId: 101, trajectoryStepId: null,
          kind: 'phase_group', stateGroup: 'page:https://demo.example.com/#/customer/manage',
        }]),
      },
      {
        method: 'GET', path: '/api/v2/screenshots/{id}/image',
        summary: '原始 PNG 二进制（从 MinIO 或本地暂存读取）',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
        tryable: false,
        respExample: '(binary image/png)',
      },
      {
        method: 'DELETE', path: '/api/v2/screenshots/{id}',
        summary: '删除截图（同时删除 MinIO/本地文件）',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
        respExample: J({ status: 'deleted', id: 1 }),
      },
    ],
  },
  {
    id: 'api-override',
    name: 'API 覆盖',
    description: 'CDP Fetch 层 mock HTTP 响应',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/api-overrides',
        summary: '分页列表',
        params: [
          { name: 'page', type: 'number', in: 'query', example: '1' },
          { name: 'pageSize', type: 'number', in: 'query', example: '20' },
        ],
      },
      {
        method: 'GET', path: '/api/v2/api-overrides/applicable',
        summary: '按作用域解析生效规则',
        params: [
          { name: 'scope', type: 'string', in: 'query', desc: 'global|system|process|function' },
          { name: 'scopeRefId', type: 'number', in: 'query' },
        ],
      },
      {
        method: 'GET', path: '/api/v2/api-overrides/{id}',
        summary: '详情',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
      },
      {
        method: 'POST', path: '/api/v2/api-overrides',
        summary: '创建覆盖规则',
        reqExample: J({
          name: 'mock登录',
          urlPattern: '/api/login',
          matchType: 'prefix',
          httpMethod: 'POST',
          enabled: true,
          respStatus: 200,
          respHeaders: { 'Content-Type': 'application/json' },
          respBody: '{"code":0}',
          scope: 'global',
          scopeRefId: null,
          sortOrder: 0,
        }),
        notes: ['matchType: exact | prefix | regex', 'scope: global | system | process | function'],
      },
      {
        method: 'PUT', path: '/api/v2/api-overrides/{id}',
        summary: '更新',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
        reqExample: J({ enabled: false }),
      },
      {
        method: 'DELETE', path: '/api/v2/api-overrides/{id}',
        summary: '删除',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
      },
    ],
  },
];
