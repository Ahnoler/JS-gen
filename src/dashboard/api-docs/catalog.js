/**
 * Product API catalog for frontend developers (/api/v2/* + WebSocket).
 * Served by /api/docs — keep in sync with src/routes/v2/*.js
 */

const J = (obj) => JSON.stringify(obj, null, 2);

/** @typedef {{ name: string, type: string, required?: boolean, in?: 'path'|'query'|'body', desc: string, example?: string }} Param */
/** @typedef {{ method: string, path: string, summary: string, desc?: string, params?: Param[], reqExample?: string, respExample?: string, notes?: string[], deprecated?: boolean, tryable?: boolean }} Endpoint */
/** @typedef {{ id: string, name: string, description: string, endpoints: Endpoint[] }} TagGroup */

/** @type {TagGroup[]} */
export const API_GROUPS = [
  {
    id: 'overview',
    name: '概览',
    description: '产品前端对接约定与推荐流程',
    endpoints: [],
  },
  {
    id: 'system-mgmt',
    name: '系统管理',
    description: '系统 → 模块 → 功能（children[] 嵌套树）',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/system-mgmt/tree',
        summary: '系统树（children[]，可筛选）',
        desc: '返回嵌套树：子节点统一在 children[]。支持 name 模糊名与 type 筛选；筛选时保留祖先节点。',
        params: [
          { name: 'name', type: 'string', in: 'query', desc: '名称模糊关键词', example: '客户' },
          { name: 'type', type: 'number', in: 'query', desc: '1 系统 / 2 模块 / 3 功能', example: '3' },
          { name: 'limit', type: 'number', in: 'query', desc: '有关键词时默认 50，最大 500', example: '50' },
          { name: 'accounts', type: 'string', in: 'query', desc: '传 0/false 时不含账号', example: '0' },
        ],
        respExample: J({
          code: 200,
          message: 'ok',
          data: [
            {
              id: 1, type: 1, typeLabel: '系统', name: '核心系统', url: 'https://example.com', parentId: null,
              children: [
                {
                  id: 2, type: 2, typeLabel: '模块', name: '客户模块', parentId: 1,
                  children: [
                    { id: 3, type: 3, typeLabel: '功能', name: '查询客户', parentId: 2, children: [] },
                  ],
                },
              ],
            },
          ],
        }),
        notes: [
          '统一信封：code=200 成功 / 4** 鉴权 / 5** 错误；业务数据在 data',
          '子节点只用 children[]，不再返回 modules/functions',
          '示例：GET /tree?name=客户&type=3&accounts=false',
        ],
      },
      {
        method: 'GET', path: '/api/v2/system-mgmt/meta',
        summary: '节点类型常量',
        respExample: J({
          typeMap: { '1': '系统', '2': '模块', '3': '功能' },
          types: [
            { type: 1, label: '系统' },
            { type: 2, label: '模块' },
            { type: 3, label: '功能' },
          ],
        }),
      },
      {
        method: 'GET', path: '/api/v2/system-mgmt/nodes',
        summary: '节点列表（可过滤）',
        desc: '可选 type / parentId；直接返回数组。',
        params: [
          { name: 'type', type: 'number', in: 'query', example: '1' },
          { name: 'parentId', type: 'number', in: 'query', example: '1' },
        ],
        respExample: J([{ id: 1, name: '核心系统', type: 1, parentId: null }]),
      },
      {
        method: 'GET', path: '/api/v2/system-mgmt/nodes/{id}',
        summary: '节点详情',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', desc: '节点 ID', example: '3' }],
        respExample: J({ id: 3, name: '查询客户', type: 3, parentId: 2 }),
      },
      {
        method: 'POST', path: '/api/v2/system-mgmt/nodes',
        summary: '新增节点',
        params: [
          { name: 'type', type: 'number', required: true, in: 'body', desc: '1 系统 / 2 模块 / 3 功能' },
          { name: 'name', type: 'string', required: true, in: 'body', desc: '名称' },
          { name: 'parentId', type: 'number|null', in: 'body', desc: '父节点；系统可为 null' },
          { name: 'url', type: 'string', in: 'body', desc: '系统地址（仅 type=1）', example: 'https://example.com' },
        ],
        reqExample: J({ type: 1, parentId: null, name: '核心系统', url: 'https://example.com', description: '' }),
        respExample: J({ id: 1, type: 1, name: '核心系统', url: 'https://example.com', parentId: null }),
      },
      {
        method: 'PUT', path: '/api/v2/system-mgmt/nodes/{id}',
        summary: '修改节点',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
        reqExample: J({ name: '新名称', url: 'https://example.com/login', description: '...' }),
        respExample: J({ id: 1, name: '新名称', url: 'https://example.com/login' }),
      },
      {
        method: 'DELETE', path: '/api/v2/system-mgmt/nodes/{id}',
        summary: '删除节点（级联子节点）',
        desc: '成功返回 { code:200, data:null }。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '3' }],
        respExample: J({ code: 200, message: 'ok', data: null }),
      },
      {
        method: 'GET', path: '/api/v2/system-mgmt/export',
        summary: '导出整树 JSON（嵌套，便于再导入）',
        respExample: J({ nodes: [{ type: 1, name: '核心系统', url: 'https://example.com', children: [] }] }),
      },
      {
        method: 'GET', path: '/api/v2/system-mgmt/template',
        summary: '导入模板示例',
        respExample: J({ mode: 'merge', nodes: [{ type: 1, name: '示例系统', url: 'https://example.com', uid: 'sys-demo', children: [] }] }),
      },
      {
        method: 'POST', path: '/api/v2/system-mgmt/import',
        summary: '导入树',
        desc: 'mode=merge 按 uid 合并（默认）；mode=append 追加。body 仍为嵌套 children；系统节点可带 url。',
        reqExample: J({ mode: 'merge', nodes: [{ type: 1, name: '核心系统', url: 'https://example.com', uid: 'sys-1', children: [] }] }),
        respExample: J({ created: 1, updated: 0, skipped: 0, tree: [] }),
      },
    ],
  },
  {
    id: 'hierarchy',
    name: '层级 / 账号',
    description: '系统、模块、功能、系统账号的 REST CRUD（与系统管理互补）',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/hierarchy/tree',
        summary: '层级树（children[]，同 system-mgmt/tree）',
        respExample: J([
          {
            id: 1, type: 1, name: '核心系统', url: 'https://example.com',
            children: [{ id: 2, type: 2, name: '客户模块', children: [] }],
          },
        ]),
      },
      {
        method: 'GET', path: '/api/v2/systems',
        summary: '系统列表',
        respExample: J([{ id: 1, name: '核心系统', uid: 'sys-1' }]),
      },
      {
        method: 'POST', path: '/api/v2/systems',
        summary: '创建系统',
        reqExample: J({ name: '核心系统', uid: 'sys-1', description: '', url: 'https://example.com' }),
        respExample: J({ id: 1, name: '核心系统', url: 'https://example.com' }),
      },
      {
        method: 'GET', path: '/api/v2/systems/{id}',
        summary: '系统详情',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
      },
      {
        method: 'PUT', path: '/api/v2/systems/{id}',
        summary: '更新系统',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
        reqExample: J({ name: '新名称', url: 'https://example.com' }),
      },
      {
        method: 'DELETE', path: '/api/v2/systems/{id}',
        summary: '删除系统',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
      },
      {
        method: 'GET', path: '/api/v2/systems/{systemId}/accounts',
        summary: '系统下账号列表',
        params: [{ name: 'systemId', type: 'number', required: true, in: 'path', example: '1' }],
        respExample: J([{ id: 10, systemId: 1, name: '测试员', loginUrl: 'https://...', username: 'u' }]),
      },
      {
        method: 'POST', path: '/api/v2/systems/{systemId}/accounts',
        summary: '创建系统账号',
        params: [{ name: 'systemId', type: 'number', required: true, in: 'path', example: '1' }],
        reqExample: J({ name: '测试员', loginUrl: 'https://example.com/login', username: 'u', password: 'p' }),
        respExample: J({ id: 10, systemId: 1, name: '测试员', loginUrl: 'https://...', username: 'u', password: 'p' }),
      },
      {
        method: 'GET', path: '/api/v2/system-accounts/{id}',
        summary: '账号详情',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '10' }],
      },
      {
        method: 'PUT', path: '/api/v2/system-accounts/{id}',
        summary: '更新账号',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '10' }],
        reqExample: J({ name: '测试员', loginUrl: 'https://...', username: 'u', password: 'p' }),
      },
      {
        method: 'DELETE', path: '/api/v2/system-accounts/{id}',
        summary: '删除账号',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '10' }],
      },
      {
        method: 'GET', path: '/api/v2/systems/{systemId}/processes',
        summary: '模块列表',
        params: [{ name: 'systemId', type: 'number', required: true, in: 'path', example: '1' }],
      },
      {
        method: 'POST', path: '/api/v2/systems/{systemId}/processes',
        summary: '创建模块',
        params: [{ name: 'systemId', type: 'number', required: true, in: 'path', example: '1' }],
        reqExample: J({ name: '客户模块', sortOrder: 0 }),
      },
      {
        method: 'PUT', path: '/api/v2/processes/{id}',
        summary: '更新模块',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '2' }],
        reqExample: J({ name: '客户模块' }),
      },
      {
        method: 'DELETE', path: '/api/v2/processes/{id}',
        summary: '删除模块',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '2' }],
      },
      {
        method: 'GET', path: '/api/v2/processes/{processId}/functions',
        summary: '功能列表',
        params: [{ name: 'processId', type: 'number', required: true, in: 'path', example: '2' }],
      },
      {
        method: 'POST', path: '/api/v2/processes/{processId}/functions',
        summary: '创建功能',
        params: [{ name: 'processId', type: 'number', required: true, in: 'path', example: '2' }],
        reqExample: J({ name: '查询客户' }),
      },
      {
        method: 'PUT', path: '/api/v2/functions/{id}',
        summary: '更新功能',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '3' }],
        reqExample: J({ name: '查询客户' }),
      },
      {
        method: 'DELETE', path: '/api/v2/functions/{id}',
        summary: '删除功能',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '3' }],
      },
    ],
  },
  {
    id: 'trajectory',
    name: '交易 / 轨迹',
    description: '交易 CRUD、阶段树、步骤管理',
    endpoints: [
      {
        method: 'POST', path: '/api/v2/trajectories/analyze',
        summary: 'AI 需求拆解为阶段（不落库）',
        desc: '调用 LLM 将需求拆成阶段描述数组，供创建交易前预览。',
        reqExample: J({ description: '登录后查询并修改客户', stepLength: 3, model: 'deepseek-v4-flash' }),
        respExample: J(['登录系统', '查询客户', '修改信息']),
      },
      {
        method: 'GET', path: '/api/v2/trajectories',
        summary: '交易分页列表',
        params: [
          { name: 'page', type: 'number', in: 'query', example: '1' },
          { name: 'pageSize', type: 'number', in: 'query', example: '20' },
          { name: 'functionId', type: 'number', in: 'query', desc: '按功能筛选', example: '3' },
          { name: 'keyword', type: 'string', in: 'query', desc: '名称模糊' },
          { name: 'sortBy', type: 'string', in: 'query', desc: 'created_at | name | step_count' },
          { name: 'order', type: 'string', in: 'query', desc: 'asc | desc' },
        ],
        respExample: J({
          rows: [{
            id: 42, name: '开户交易', task: '需求描述',
            recordStatus: 'draft', stepCount: 0, phaseCount: 3,
            functionId: 3, systemAccountId: 10, model: 'deepseek-v4-flash',
          }],
          total: 1, page: 1, pageSize: 20,
        }),
      },
      {
        method: 'POST', path: '/api/v2/trajectories',
        summary: '创建交易',
        desc: '推荐带 phases；requirement 可写为 task；systemAccountId 可写为 accountId。',
        reqExample: J({
          functionId: 3,
          name: '开户交易',
          requirement: '登录、查询、修改',
          phases: ['登录系统', '查询客户', '修改信息'],
          model: 'deepseek-v4-flash',
          systemAccountId: 10,
        }),
        respExample: J({ id: 42, name: '开户交易', recordStatus: 'draft', phaseCount: 3 }),
      },
      {
        method: 'GET', path: '/api/v2/trajectories/{id}',
        summary: '交易详情（含 steps）',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
      },
      {
        method: 'PATCH', path: '/api/v2/trajectories/{id}',
        summary: '更新元数据 / 绑定账号',
        desc: '录制前须绑定 systemAccountId。账号须属于该交易所属系统。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({ systemAccountId: 10 }),
        respExample: J({
          trajectory: { id: 42, systemAccountId: 10 },
          account: { id: 10, name: '测试员', loginUrl: 'https://...' },
        }),
      },
      {
        method: 'DELETE', path: '/api/v2/trajectories/{id}',
        summary: '删除交易',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
      },
      {
        method: 'GET', path: '/api/v2/trajectories/{id}/tree',
        summary: '阶段 + 步骤二级树',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        respExample: J({
          trajectoryId: 42, name: '...', recordStatus: 'draft',
          phases: [{
            id: 101, phaseNumber: 1, description: '登录系统', status: 'pending',
            steps: [{
              id: 501, stepNumber: 1, actionType: 'click_element_by_index',
              description: '点击查询', source: 'agent', confirmed: false,
              params: {}, trajectoryPhaseId: 101,
            }],
          }],
          orphanSteps: [],
        }),
      },
      {
        method: 'GET', path: '/api/v2/trajectories/{id}/phases',
        summary: '阶段列表',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/phases',
        summary: '追加阶段',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({ description: '补充审核阶段' }),
      },
      {
        method: 'GET', path: '/api/v2/trajectories/{id}/action-flow',
        summary: 'DB 步骤动作流',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/clear',
        summary: '清空步骤，阶段重置 pending',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        respExample: J({ trajectoryId: 42, recordStatus: 'draft', stepCount: 0, phases: [], orphanSteps: [] }),
      },
      {
        method: 'GET', path: '/api/v2/trajectory-phases/{id}/steps',
        summary: '某阶段下步骤',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', desc: 'phaseId', example: '101' }],
      },
      {
        method: 'POST', path: '/api/v2/trajectory-steps',
        summary: '手动新增步骤',
        reqExample: J({
          trajectoryId: 42, phaseNumber: 1,
          actionType: 'click_element_by_index',
          description: '点击新增',
          params: { index: 1, text: '新增' },
          source: 'manual',
        }),
      },
      {
        method: 'PATCH', path: '/api/v2/trajectory-steps/{id}',
        summary: '修改步骤',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '501' }],
        reqExample: J({ description: '新描述', params: { index: 2 } }),
      },
      {
        method: 'PATCH', path: '/api/v2/trajectory-steps/{id}/confirm',
        summary: '确认 / 取消确认步骤',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '501' }],
        reqExample: J({ confirmed: true }),
        respExample: J({ id: 501, confirmed: true, confirmedAt: '2026-07-20 12:00:00.000' }),
      },
      {
        method: 'DELETE', path: '/api/v2/trajectory-steps/{id}',
        summary: '删除步骤',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '501' }],
      },
    ],
  },
  {
    id: 'recording',
    name: '交易录制',
    description: 'prepare → start → stop → detach。stop 不释放槽位，detach 才释放。',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/trajectories/{id}/login-context',
        summary: '登录上下文',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        respExample: J({
          trajectoryId: 42, functionId: 3, systemAccountId: 10,
          system: { id: 1, name: '核心系统' },
          accounts: [{ id: 10, name: '测试员', loginUrl: '...', username: 'u', password: 'p' }],
        }),
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/record/prepare',
        summary: '一键准备（占槽 + 登录 + 推流）',
        desc: '幂等。需已绑定 systemAccountId。登录/导航不写入 trajectory_step。通过 WS 广播 recording:prepare。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({}),
        respExample: J({
          trajectoryId: 42, sessionId: 'uuid', executorNodeUuid: 'node-uuid',
          remoteSessionId: 7, ready: true, attached: true,
          login: { skipped: false, done: true, accountId: 10 },
          stream: { ok: true, remoteSessionId: 7 },
          stages: {
            session: { status: 'done' }, browser: { status: 'done' },
            stream: { status: 'done' }, login: { status: 'done' },
          },
        }),
        notes: ['409：无空闲执行机槽位（可能含 holders）', '503：会话/执行机不可用'],
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/record/start',
        summary: '开始 AI 录制',
        desc: '同步阻塞至录制完成。phaseIds 省略则录全部阶段。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({ phaseIds: [101, 102], accountId: 10 }),
        respExample: J({
          trajectoryId: 42, recordStatus: 'recorded',
          phaseIds: [101], systemAccountId: 10,
          events: [{ type: 'phase_start', phaseNumber: 1 }],
          steps: [],
        }),
        notes: ['400：未 attach / 无匹配 phase / 缺账号', '409：session busy'],
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/record/stop',
        summary: '结束录制（不 detach）',
        desc: 'success=true → recordStatus=recorded；false → draft。响应含 detached:false。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({ success: true }),
        respExample: J({
          trajectoryId: 42, recordStatus: 'recorded', detached: false,
          tree: { phases: [], orphanSteps: [] },
        }),
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/manual-record',
        summary: '开关人工录制',
        desc: 'AI 录制中（recordStatus=recording）时开启会 409。phaseId 省略则追加到最后阶段。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({ enabled: true, phaseId: 102 }),
        respExample: J({ trajectoryId: 42, enabled: true, phaseId: 102 }),
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/steps/replay',
        summary: 'live 会话中重放选中步骤',
        desc: '与 Playwright 全量回放不同。默认 isReplay=true 时不写入步骤表。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({ stepIds: [501, 502], isReplay: true }),
        respExample: J({ trajectoryId: 42, isReplay: true, stepIds: [501], count: 2, error: null }),
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/attach',
        summary: '低级附着（一般用 prepare）',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({}),
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/detach',
        summary: '释放执行机槽位',
        desc: '关闭会话并释放槽位。离开录制工作室前应调用。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({}),
        respExample: J({ trajectoryId: 42, detached: true }),
      },
    ],
  },
  {
    id: 'replay',
    name: '回放',
    description: 'Playwright 全量回放。服务端组装脚本，不向客户端返回 JS 源码；进度走 WS replay:*。',
    endpoints: [
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/replay/prepare',
        summary: '组装回放计划',
        desc: 'recordStatus=recording 时 409。脚本不返回给客户端。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({}),
        respExample: J({
          replayPlanId: 'uuid', trajectoryId: 42, ready: true, stepCount: 15,
          steps: [{ stepId: 501, phaseId: 101, phaseNumber: 1, actionType: '...', confirmed: true }],
          stepMap: [{ assemblerStep: 1, stepId: 501, phaseId: 101, description: '...' }],
        }),
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/replay/start',
        summary: '启动 Playwright 回放',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({ replayPlanId: 'uuid' }),
        respExample: J({ replayId: 'uuid', trajectoryId: 42, replayPlanId: 'uuid' }),
        notes: ['进度通过 WS：replay:status / replay:step / replay:screenshot / replay:result / replay:done'],
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/replay/stop',
        summary: '中止回放',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        respExample: J({ trajectoryId: 42, replayId: 'uuid', stopped: true }),
      },
      {
        method: 'GET', path: '/api/v2/trajectories/{id}/replay/latest',
        summary: '最近一次回放状态',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        respExample: J({
          replayId: 'uuid', trajectoryId: 42, status: 'running',
          completedStepIds: [501, 502], screenshots: [], failedStep: null, success: true,
        }),
      },
      {
        method: 'GET', path: '/api/v2/replays/{replayId}',
        summary: '按 replayId 查询',
        params: [{ name: 'replayId', type: 'string', required: true, in: 'path', example: 'uuid' }],
      },
    ],
  },
  {
    id: 'executor',
    name: '执行机',
    description: '执行机注册走 WS /ws/executor；HTTP 只读 + drain',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/executors',
        summary: '执行机列表',
        respExample: J({
          count: 1,
          nodes: [{
            id: 1, nodeUuid: 'abc', name: 'executor-1',
            status: 'online', capacity: 2, connected: true, inUse: 1,
            slots: [{ slotIndex: 0, sessionId: '...', trajectoryId: 42, busy: true }],
          }],
        }),
      },
      {
        method: 'GET', path: '/api/v2/executors/{nodeUuid}',
        summary: '单节点详情',
        params: [{ name: 'nodeUuid', type: 'string', required: true, in: 'path', example: 'abc' }],
      },
      {
        method: 'POST', path: '/api/v2/executors/{nodeUuid}/drain',
        summary: '排空节点（不再接新任务）',
        params: [{ name: 'nodeUuid', type: 'string', required: true, in: 'path', example: 'abc' }],
        reqExample: J({}),
      },
    ],
  },
  {
    id: 'case-data',
    name: '案例数据',
    description: '旧路径 /api/case-data → 410 Gone，请用本分组',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/case-data',
        summary: '分页列表',
        params: [
          { name: 'page', type: 'number', in: 'query', example: '1' },
          { name: 'pageSize', type: 'number', in: 'query', example: '20' },
        ],
        respExample: J({
          rows: [{ id: 1, recordId: 'case_xxx', sessionId: '...', keyCount: 5, description: '...' }],
          total: 1, page: 1, pageSize: 20,
        }),
      },
      {
        method: 'GET', path: '/api/v2/case-data/{recordId}',
        summary: '详情（含 entries）',
        params: [{ name: 'recordId', type: 'string', required: true, in: 'path', example: 'case_xxx' }],
      },
      {
        method: 'GET', path: '/api/v2/case-data/{recordId}/file',
        summary: '物化为本地 JSON 文件路径',
        params: [{ name: 'recordId', type: 'string', required: true, in: 'path', example: 'case_xxx' }],
      },
      {
        method: 'DELETE', path: '/api/v2/case-data/{recordId}',
        summary: '删除',
        params: [{ name: 'recordId', type: 'string', required: true, in: 'path', example: 'case_xxx' }],
      },
    ],
  },
  {
    id: 'remote-session',
    name: '远程会话 / BiB',
    description: 'CDP 附着与推流状态（录制工作室左侧画布）',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/remote-sessions/live/status',
        summary: '当前 live 状态',
        respExample: J({
          attached: true, remoteSessionId: 7, remoteSessionUuid: 'uuid',
          cdpReady: true, inputEnabled: true, agentBusy: false,
          viewportW: 1920, viewportH: 1080, manualRecording: false,
        }),
      },
      {
        method: 'POST', path: '/api/v2/remote-sessions/attach-live',
        summary: '附着 CDP + 推流',
        reqExample: J({ sessionId: 'uuid', quality: 0.7, viewportW: 1920, viewportH: 1080 }),
        respExample: J({ remoteSession: { id: 7 }, status: { attached: true, remoteSessionId: 7 } }),
        notes: ['503：CDP/页面未就绪'],
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
        reqExample: J({ sessionId: 'uuid', viewportW: 1920, viewportH: 1080 }),
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
        reqExample: J({ viewportW: 1280, viewportH: 720 }),
      },
      {
        method: 'POST', path: '/api/v2/remote-sessions/{id}/detach',
        summary: '断开 live 桥接',
        params: [{ name: 'id', type: 'string', required: true, in: 'path', example: '7' }],
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
    name: '截图',
    description: '交易关联截图；回放中亦可经 WS replay:screenshot 获取 URL',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/trajectories/{trajectoryId}/screenshots',
        summary: '交易关联截图列表',
        params: [{ name: 'trajectoryId', type: 'number', required: true, in: 'path', example: '42' }],
        respExample: J([{ id: 1, fileName: 'step_1.png', fileSize: 12345, stepIndex: 1, mimeType: 'image/png' }]),
      },
      {
        method: 'GET', path: '/api/v2/screenshots/{id}/image',
        summary: '原始 PNG 二进制',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
        tryable: false,
        respExample: '(binary image/png)',
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
  {
    id: 'websocket',
    name: 'WebSocket',
    description: '产品前端连接 ws://<host>/ws；消息格式 { type, payload }',
    endpoints: [
      {
        method: 'WS', path: '/ws',
        summary: '产品前端 / Dashboard 通道',
        desc: '连接后可收 recording:*、replay:*、remote:*、二进制投屏帧。客户端可发 ws:ping、replay:start。',
        tryable: false,
        respExample: J({ type: 'server:init', payload: { /* 会话快照 */ } }),
        notes: [
          '客户端 → { type: "ws:ping", payload: {} } → 收到 ws:pong',
          '客户端 → { type: "replay:start", payload: { trajectoryId, replayPlanId? } }',
          '二进制帧：RSCF 投屏（record-studio 画布）',
        ],
      },
      {
        method: 'WS', path: 'recording:prepare',
        summary: '录制准备阶段事件',
        tryable: false,
        respExample: J({
          type: 'recording:prepare',
          payload: {
            trajectoryId: 42,
            stage: 'stream',
            status: 'done',
            sessionId: 'uuid',
            remoteSessionId: 7,
          },
        }),
        notes: ['stage: session | browser | stream | login', 'status: running | done | degraded | error | skipped'],
      },
      {
        method: 'WS', path: 'action_log_sync',
        summary: 'AI 步骤实时同步',
        tryable: false,
        respExample: J({ type: 'action_log_sync', payload: { sessionId: 'uuid', entries: [] } }),
      },
      {
        method: 'WS', path: 'manual_action_recorded',
        summary: '人工操作落库前',
        tryable: false,
        respExample: J({ type: 'manual_action_recorded', payload: { sessionId: 'uuid', entry: { action: '...', params: {} } } }),
      },
      {
        method: 'WS', path: 'manual_record_status',
        summary: '人工录制开关状态',
        tryable: false,
        respExample: J({ type: 'manual_record_status', payload: { sessionId: 'uuid', enabled: true } }),
      },
      {
        method: 'WS', path: 'remote:status',
        summary: 'BiB 附着状态变化',
        tryable: false,
        respExample: J({ type: 'remote:status', payload: { attached: true, remoteSessionId: 7 } }),
      },
      {
        method: 'WS', path: 'replay:status',
        summary: '回放状态',
        tryable: false,
        respExample: J({ type: 'replay:status', payload: { replayId: 'uuid', trajectoryId: 42, phase: 'running' } }),
      },
      {
        method: 'WS', path: 'replay:step',
        summary: '回放单步进度',
        tryable: false,
        respExample: J({
          type: 'replay:step',
          payload: {
            replayId: 'uuid', trajectoryId: 42, stepId: 501,
            phaseId: 101, status: 'completed',
          },
        }),
      },
      {
        method: 'WS', path: 'replay:screenshot',
        summary: '回放截图',
        tryable: false,
        respExample: J({
          type: 'replay:screenshot',
          payload: { replayId: 'uuid', trajectoryId: 42, stepId: 501, fileName: 'step.png', url: '/api/...' },
        }),
      },
      {
        method: 'WS', path: 'replay:result',
        summary: '回放结果汇总',
        tryable: false,
        respExample: J({
          type: 'replay:result',
          payload: { replayId: 'uuid', trajectoryId: 42, success: true, completedStepIds: [501], exitCode: 0 },
        }),
      },
      {
        method: 'WS', path: 'replay:done',
        summary: '回放结束',
        tryable: false,
        respExample: J({ type: 'replay:done', payload: { replayId: 'uuid', trajectoryId: 42 } }),
      },
    ],
  },
];

export const ENUMS = [
  { name: 'recordStatus', values: 'draft / recording / recorded' },
  { name: 'phase.status', values: 'pending / running / completed / failed' },
  { name: 'step.source', values: 'agent / manual' },
  { name: '节点 type', values: '1 系统 / 2 模块 / 3 功能' },
];

export const RECORDING_FLOW = [
  'analyze → POST /trajectories（带 phases）',
  'PATCH /trajectories/:id 绑定 systemAccountId',
  'POST .../record/prepare（占槽 + 登录，幂等）',
  'POST .../record/start（可选 phaseIds）',
  'POST .../record/stop（不释放槽位）',
  'POST .../detach（释放执行机槽位）',
];
