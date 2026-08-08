/**
 * API group(s): special-element, component-library — extracted from catalog.js.
 * Keep in sync with src/routes/v2/*.js
 */
import { J } from './_j.js';

/** @type {TagGroup[]} */
export const GROUP_COMPONENTS = [
  {
    id: 'special-element',
    name: '特殊元素管理',
    description: '特殊元素库、步骤快照；按 system_id 隔离；分类标签来自字典管理 special_element_tag',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/special-elements',
        summary: '特殊元素分页列表',
        params: [
          { name: 'systemId', type: 'number', in: 'query', desc: '系统范围（推荐必填）', example: '1' },
          { name: 'moduleId', type: 'number', in: 'query', desc: '模块；展开其下全部功能过滤（无 functionId 时）' },
          { name: 'functionId', type: 'number', in: 'query', desc: '功能过滤（优先于 moduleId）' },
          { name: 'keyword', type: 'string', in: 'query', desc: '入库说明/名称模糊（也可传 description）' },
          { name: 'stepDesc', type: 'string', in: 'query', desc: '步骤说明：匹配步骤 action/params' },
          { name: 'createdBy', type: 'string', in: 'query', desc: '入库人模糊' },
          { name: 'startTime', type: 'string', in: 'query', desc: '入库日起 YYYY-MM-DD' },
          { name: 'endTime', type: 'string', in: 'query', desc: '入库日止 YYYY-MM-DD' },
          { name: 'tagDictCode', type: 'number', in: 'query' },
          { name: 'enabled', type: 'string', in: 'query', desc: '1/0' },
          { name: 'page', type: 'number', in: 'query', example: '1' },
          { name: 'pageSize', type: 'number', in: 'query', example: '20' },
        ],
      },
      {
        method: 'GET', path: '/api/v2/special-elements/{id}',
        summary: '详情（含有序 steps）',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
      },
      {
        method: 'PUT', path: '/api/v2/special-elements/{id}',
        summary: '更新元数据（不可改 systemId）',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
        reqExample: J({ name: '复杂登录组', tagDictCode: 1, remark: '', enabled: true }),
      },
      {
        method: 'DELETE', path: '/api/v2/special-elements/{id}',
        summary: '物理删除（级联 steps）',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
      },
      {
        method: 'POST', path: '/api/v2/special-elements/from-trajectory',
        summary: '从轨迹步骤原子入库',
        desc: '所选 stepIds 须同属一个 trajectoryPhaseId；systemId 可由 trajectory.functionId 解析，失败时需显式传入。',
        reqExample: J({
          trajectoryPhaseId: 10,
          stepIds: [101, 102, 103],
          tagDictCode: 1,
          name: '复杂组件操作组',
          remark: '',
        }),
      },
      {
        method: 'POST', path: '/api/v2/special-elements/search',
        summary: '混合检索候选',
        reqExample: J({ systemId: 1, description: '填写登录表单', limit: 3 }),
      },
      {
        method: 'POST', path: '/api/v2/special-elements/{id}/replay',
        summary: '人工试跑（默认不落库）',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
        reqExample: J({ trajectoryId: 42, persist: false }),
        notes: [
          '目标 trajectory 须已 record/prepare 附着会话',
          'persist=true 时写入 trajectory_step 且 source=special_element',
        ],
      },
      {
        method: 'PATCH', path: '/api/v2/special-element-steps/{id}',
        summary: '更新单步 action/params/element',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
        reqExample: J({ actionType: 'fill_form_field', paramsJson: { label_text: '用户名', value: 'u' } }),
      },
      {
        method: 'DELETE', path: '/api/v2/special-element-steps/{id}',
        summary: '删除单步并重排（最后一条拒绝 409）',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
      },
    ],
  },
  {
    id: 'component-library',
    name: '组件库管理',
    description:
      '操作步骤原子化组件库（operation_component / occurrence）。'
      + 'LLM 离线扫描轨迹三表 → draft 组件；人工 confirm/deprecate。'
      + '本阶段不引用录制/回放、不碰 login。签名含 label_text 等稳定语义字段。',
    endpoints: [
      {
        method: 'POST', path: '/api/v2/operation-components/mine',
        summary: '离线扫描沉淀（LLM 命名新簇）',
        desc: 'scope 三选一：systemId | functionId | trajectoryIds。同 system+signature 已存在则只加 occurrence，不改文案。簇内 phase≥2 才沉淀。',
        reqExample: J({ systemId: 1, model: 'deepseek-v4-flash' }),
        respExample: J({
          created: [{ id: 1, name: '查询并引入', status: 'draft', occurrenceCount: 3 }],
          updated: [],
          createdCount: 1,
          updatedCount: 0,
          skippedSingletons: 5,
          scannedPhases: 12,
          trajectoryCount: 4,
        }),
      },
      {
        method: 'GET', path: '/api/v2/operation-components',
        summary: '分页列表',
        params: [
          { name: 'page', type: 'number', in: 'query', example: '1' },
          { name: 'pageSize', type: 'number', in: 'query', example: '20' },
          { name: 'systemId', type: 'number', in: 'query', example: '1' },
          { name: 'moduleId', type: 'number', in: 'query', desc: '模块；展开其下功能过滤' },
          { name: 'functionId', type: 'number', in: 'query', desc: '功能过滤（优先于 moduleId）' },
          { name: 'startTime', type: 'string', in: 'query', desc: '入库日起 YYYY-MM-DD' },
          { name: 'endTime', type: 'string', in: 'query', desc: '入库日止 YYYY-MM-DD' },
          { name: 'status', type: 'string', in: 'query', desc: 'draft | confirmed | deprecated' },
          { name: 'grain', type: 'string', in: 'query', desc: 'phase | step_seq' },
          { name: 'q', type: 'string', in: 'query', desc: 'name/description/key 模糊' },
        ],
        respExample: J({
          rows: [{ id: 1, name: '查询并引入', status: 'draft', systemId: 1, grain: 'phase', occurrenceCount: 3 }],
          total: 1, page: 1, pageSize: 20,
        }),
      },
      {
        method: 'GET', path: '/api/v2/operation-components/{id}',
        summary: '详情（含 stepsJson + occurrences）',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
      },
      {
        method: 'POST', path: '/api/v2/operation-components',
        summary: '手工创建（从 phase 或 steps）',
        reqExample: J({ trajectoryPhaseId: 101 }),
      },
      {
        method: 'PATCH', path: '/api/v2/operation-components/{id}',
        summary: '改 name/key/description/paramSchema（不可改 stepsJson/signature）',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
        reqExample: J({ name: '引入法定代表人', description: '查询确认后引入' }),
      },
      {
        method: 'POST', path: '/api/v2/operation-components/{id}/confirm',
        summary: 'draft → confirmed',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
      },
      {
        method: 'POST', path: '/api/v2/operation-components/{id}/deprecate',
        summary: '→ deprecated',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
      },
      {
        method: 'DELETE', path: '/api/v2/operation-components/{id}',
        summary: '仅 draft 硬删',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
      },
    ],
  },
];
