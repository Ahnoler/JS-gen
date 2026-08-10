/**
 * Product API catalog for frontend developers (/api/v2/* + WebSocket).
 * Served by /api/docs — keep in sync with src/routes/v2/*.js
 *
 * Group definitions live in ./groups/*.js (clustered per module).
 */

/** @typedef {{ name: string, type: string, required?: boolean, in?: 'path'|'query'|'body', desc: string, example?: string }} Param */
/** @typedef {{ method: string, path: string, summary: string, desc?: string, params?: Param[], reqExample?: string, respExample?: string, notes?: string[], deprecated?: boolean, tryable?: boolean }} Endpoint */
/** @typedef {{ id: string, name: string, description: string, endpoints: Endpoint[] }} TagGroup */

import { GROUP_OVERVIEW } from './groups/overview.js';
import { GROUP_HIERARCHY } from './groups/hierarchy.js';
import { GROUP_COMPONENTS } from './groups/components.js';
import { GROUP_TRAJECTORY } from './groups/trajectory.js';
import { GROUP_RECORDING } from './groups/recording.js';
import { GROUP_MEMORY } from './groups/memory.js';
import { GROUP_REMOTE } from './groups/remote.js';
import { GROUP_WEBSOCKET } from './groups/websocket.js';
import { GROUP_EXPORT } from './groups/export-mgmt.js';

/** @type {TagGroup[]} */
export const API_GROUPS = [
  ...GROUP_OVERVIEW,
  ...GROUP_HIERARCHY,
  ...GROUP_COMPONENTS,
  ...GROUP_TRAJECTORY,
  ...GROUP_RECORDING,
  ...GROUP_MEMORY,
  ...GROUP_REMOTE,
  ...GROUP_WEBSOCKET,
  ...GROUP_EXPORT,
];

export const ENUMS = [
  { name: 'recordStatus', values: 'draft / live / recording / recorded / completed' },
  { name: 'remote_session.status', values: 'active（推流中）/ idle（断开画面浏览器仍在）/ closed / crashed' },
  { name: 'phase.status', values: 'pending / running / completed / failed' },
  { name: 'step.source', values: 'agent / manual' },
  { name: 'batch jobStatus', values: 'accepted / running / waiting_executor / cancelling / cancelled / completed / completed_with_errors / failed' },
  { name: 'batch itemStatus', values: 'pending / analyzing / analyzed / queued / waiting_executor / preparing / recording / recorded / failed / rejected / cancelled' },
  { name: '节点 type', values: '1 系统 / 2 模块 / 3 功能' },
  { name: 'legacy-engine type', values: 'click / input / select:click / select:tree / radio / date（仅当前可录制动作）' },
  { name: 'legacy-engine locateBy', values: 'xpath（默认）' },
  { name: 'isExport', values: '0（未导出或有变更）/ 1（最近一次全量 partner transaction 导出成功）' },
];

export const RECORDING_FLOW = [
  'analyze → POST /trajectories（带 phases）',
  'PATCH /trajectories/:id 绑定 systemAccountId',
  'POST .../record/prepare（复用空闲资源 / 占槽 + 登录，幂等）',
  'POST .../record/start（可选 phaseIds；可关页后台继续）',
  'POST .../record/stop（不释放槽位）',
  'POST .../confirm（人工确认 → completed；取消 → draft）',
  'POST .../resolve-element（可选：actionType+params 从已附着页面抓 xpath_smart 写入步骤 element_json）',
  'POST .../stream/detach（断开画面；或 .../detach 释放执行资源关浏览器）',
];

export const BATCH_RECORDING_FLOW = [
  'GET /trajectories/batch/template → 填写 交易名称 / 需求描述',
  'POST /trajectories/batch/import（file + functionId + systemAccountId + mode? + Idempotency-Key）→ HTTP 202',
  'mode=record：analyze → 草稿 → prepare → record/start → detach（并行，全局 FIFO）',
  'mode=draft：analyze → 草稿（itemStatus=drafted，不占执行机）',
  'WS batch:progress / batch:done；或 GET /trajectories/batch/{batchId} 轮询',
  '可选 POST .../batch/{batchId}/cancel',
];
