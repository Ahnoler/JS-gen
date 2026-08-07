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
        summary: '系统树（以 id=0 根为顶层）',
        desc: 'data 恒为 [{ id:0, type:0, children:[系统…] }]。支持 name / type 筛选；无命中时 children 为空数组。命中节点可带 path（不含根名）。',
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
              id: 0, type: 0, typeLabel: '根', name: '根', parentId: 0,
              children: [
                {
                  id: 1, type: 1, typeLabel: '系统', name: '核心系统', url: 'https://example.com', parentId: 0,
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
            },
          ],
        }),
        notes: [
          '统一信封：code=200 成功 / 4** 鉴权 / 5** 错误；业务数据在 data',
          '表内固定存在 id=0 根节点（type=0）；系统节点 parentId=0',
          '子节点只用 children[]，不再返回 modules/functions',
          '示例：GET /tree?name=客户&type=3&accounts=false',
        ],
      },
      {
        method: 'GET', path: '/api/v2/system-mgmt/meta',
        summary: '节点类型常量',
        respExample: J({
          typeMap: { '0': '根', '1': '系统', '2': '模块', '3': '功能' },
          types: [
            { type: 0, label: '根' },
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
        respExample: J([{ id: 1, name: '核心系统', type: 1, parentId: 0 }]),
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
          { name: 'parentId', type: 'number', in: 'body', desc: '父节点；系统节点固定为 0' },
          { name: 'url', type: 'string', in: 'body', desc: '系统地址（仅 type=1）', example: 'https://example.com' },
        ],
        reqExample: J({ type: 1, parentId: 0, name: '核心系统', url: 'https://example.com', description: '' }),
        respExample: J({ id: 1, type: 1, name: '核心系统', url: 'https://example.com', parentId: 0 }),
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
        summary: '导出整树 Excel',
        desc: '返回 .xlsx 二进制（非 JSON 信封）。列：*父节点 / *类型 / *名称 / 地址（系统下填写） / 备注；父路径用 / 分隔。',
        tryable: false,
        notes: ['Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'filename=system-tree-export.xlsx'],
      },
      {
        method: 'GET', path: '/api/v2/system-mgmt/template',
        summary: '下载导入模板 Excel',
        desc: '返回带示例行的 .xlsx；A2 单元格备注「父节点路径按 / 分割」。',
        tryable: false,
        notes: ['filename=system-tree-template.xlsx'],
      },
      {
        method: 'POST', path: '/api/v2/system-mgmt/import',
        summary: '导入 Excel 树',
        desc: 'multipart/form-data，字段 file=.xlsx；可选 mode=merge|append（默认 merge，按父路径+名称+类型合并）。成功仍返回 JSON 信封。',
        tryable: false,
        reqExample: 'form-data: file=@system-tree.xlsx; mode=merge',
        respExample: J({ created: 1, updated: 0, skipped: 0, mode: 'merge', tree: [] }),
        notes: ['类型填：系统 / 模块 / 功能', '系统行父节点留空；模块父=系统名；功能父=系统名/模块名'],
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
    id: 'sys-dict',
    name: '字典管理',
    description: '通用字典类型与数据（sys_dict_type / sys_dict_data）；特殊元素分类用 dict_type=special_element_tag',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/system/dict/type',
        summary: '字典类型列表',
        params: [{ name: 'status', type: 'string', in: 'query', desc: '0 正常 / 1 停用', example: '0' }],
        respExample: J([{ dictId: 1, dictName: '特殊元素标签', dictType: 'special_element_tag', status: '0' }]),
      },
      {
        method: 'GET', path: '/api/v2/system/dict/type/{dictId}',
        summary: '字典类型详情',
        params: [{ name: 'dictId', type: 'number', required: true, in: 'path', example: '1' }],
      },
      {
        method: 'POST', path: '/api/v2/system/dict/type',
        summary: '新增字典类型',
        reqExample: J({ dictName: '特殊元素标签', dictType: 'special_element_tag', remark: '' }),
      },
      {
        method: 'PUT', path: '/api/v2/system/dict/type/{dictId}',
        summary: '更新字典类型',
        params: [{ name: 'dictId', type: 'number', required: true, in: 'path', example: '1' }],
        reqExample: J({ dictName: '特殊元素标签', status: '0' }),
      },
      {
        method: 'DELETE', path: '/api/v2/system/dict/type/{dictId}',
        summary: '删除字典类型（下有数据则拒绝）',
        params: [{ name: 'dictId', type: 'number', required: true, in: 'path', example: '1' }],
      },
      {
        method: 'GET', path: '/api/v2/system/dict/data',
        summary: '字典数据列表',
        params: [
          { name: 'dictType', type: 'string', in: 'query', example: 'special_element_tag' },
          { name: 'status', type: 'string', in: 'query', example: '0' },
        ],
      },
      {
        method: 'GET', path: '/api/v2/system/dict/data/type/{dictType}',
        summary: '某类型下正常状态条目（入库弹窗下拉）',
        params: [{ name: 'dictType', type: 'string', required: true, in: 'path', example: 'special_element_tag' }],
        respExample: J([
          { dictCode: 1, dictLabel: '登录', dictValue: 'login', dictType: 'special_element_tag', status: '0' },
          { dictCode: 2, dictLabel: '填写', dictValue: 'fill', dictType: 'special_element_tag', status: '0' },
        ]),
      },
      {
        method: 'GET', path: '/api/v2/system/dict/data/{dictCode}',
        summary: '字典数据详情',
        params: [{ name: 'dictCode', type: 'number', required: true, in: 'path', example: '1' }],
      },
      {
        method: 'POST', path: '/api/v2/system/dict/data',
        summary: '新增字典数据',
        reqExample: J({
          dictType: 'special_element_tag',
          dictLabel: '登录',
          dictValue: 'login',
          dictSort: 1,
        }),
      },
      {
        method: 'PUT', path: '/api/v2/system/dict/data/{dictCode}',
        summary: '更新字典数据',
        params: [{ name: 'dictCode', type: 'number', required: true, in: 'path', example: '1' }],
        reqExample: J({ dictLabel: '登录', status: '0' }),
      },
      {
        method: 'DELETE', path: '/api/v2/system/dict/data/{dictCode}',
        summary: '删除字典数据（被 special_element 引用则拒绝）',
        params: [{ name: 'dictCode', type: 'number', required: true, in: 'path', example: '1' }],
      },
    ],
  },
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
  {
    id: 'trajectory',
    name: '交易 / 轨迹',
    description: '交易 CRUD、阶段树、步骤管理',
    endpoints: [
      {
        method: 'POST', path: '/api/v2/trajectories/analyze',
        summary: 'AI 需求拆解为阶段（不落库）',
        desc: '将需求拆成 phases（条数跟用户编号分步）。需求中的「关键数据/案例数据」段落语义上是**业务数据**（用户希望使用的值，≠ 本项目落库的系统回写案例数据）：原文附加到每个 phase 描述末尾供 LLM 理解填表；其余字段仍可由 autofill 随机补。可选 functionId：为每个 phase 挂 specialElementCandidates（仅预览）。',
        reqExample: J({
          description:
            '1、点击客户管理，点击对公客户管理。\n'
            + '2、新增一个对公潜在客户。\n\n'
            + '关键数据\n'
            + '对公客户基本信息：\n'
            + '法定责任人的客户名称：朱桂武\n'
            + '客户标签：',
          model: 'deepseek-v4-flash',
          functionId: 3,
        }),
        respExample: J({
          phases: [
            '点击客户管理，点击对公客户管理。预期结果：抵达对公客户管理。\n\n'
            + '【业务数据 — 来自用户需求（非系统回写案例数据）；填表时参考理解，按场景填写关键字段】\n'
            + '关键数据\n对公客户基本信息：\n法定责任人的客户名称：朱桂武\n客户标签：',
            '新增一个对公潜在客户。预期结果：打开对公潜在客户新增表单。\n\n'
            + '【业务数据 — 来自用户需求（非系统回写案例数据）；填表时参考理解，按场景填写关键字段】\n'
            + '关键数据\n对公客户基本信息：\n法定责任人的客户名称：朱桂武\n客户标签：',
          ],
          caseEntries: [],
        }),
      },
      {
        method: 'GET', path: '/api/v2/trajectories',
        summary: '交易分页列表',
        params: [
          { name: 'page', type: 'number', in: 'query', example: '1' },
          { name: 'pageSize', type: 'number', in: 'query', example: '20' },
          { name: 'functionId', type: 'number', in: 'query', desc: '按功能筛选', example: '3' },
          { name: 'keyword', type: 'string', in: 'query', desc: '名称模糊' },
          {
            name: 'recordStatus', type: 'string', in: 'query',
            desc: '按录制状态筛选；支持单个或逗号分隔多值：draft | live | recording | recorded | completed。别名 status',
            example: 'draft,recorded',
          },
          { name: 'sortBy', type: 'string', in: 'query', desc: 'created_at | name | step_count | record_status' },
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
        desc: '推荐带 phases；requirement 可写为 task；systemAccountId 可写为 accountId。可选 caseEntries 写入 legacy case_data_entry（勿与业务数据、system_ref 混用）。录制填表优先参考 phase 内【业务数据】（用户需求原文）。系统回写参考值见 PUT …/system-ref-entries。',
        reqExample: J({
          functionId: 3,
          name: '开户交易',
          requirement: '登录、查询、修改',
          phases: ['登录系统', '查询客户', '修改信息'],
          caseEntries: [
            { fieldKey: '姓名', fieldValue: '张三' },
            { fieldKey: '证件号码', fieldValue: '110101199001011234' },
          ],
          model: 'deepseek-v4-flash',
          systemAccountId: 10,
        }),
        respExample: J({
          id: 42, name: '开户交易', recordStatus: 'draft', phaseCount: 3,
          phases: [],
          caseEntries: [{ id: 1, fieldKey: '姓名', fieldValue: '张三', trajectoryId: 42 }],
        }),
      },
      {
        method: 'GET', path: '/api/v2/trajectories/{id}',
        summary: '交易详情（含 phases、caseEntries）',
        desc: 'caseEntries 为交易级 legacy KV（case_data_entry）。录制填表优先【业务数据】；目标系统已校验参考值用 system_ref_entry，勿混用。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
      },
      {
        method: 'PATCH', path: '/api/v2/trajectories/{id}',
        summary: '更新元数据 / 绑定账号 / 案例数据',
        desc: '录制前须绑定 systemAccountId。账号须属于该交易所属系统。可同时传 caseEntries 替换案例 KV。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({
          systemAccountId: 10,
          caseEntries: [{ fieldKey: '姓名', fieldValue: '李四' }],
        }),
        respExample: J({
          trajectory: { id: 42, systemAccountId: 10 },
          account: { id: 10, name: '测试员', loginUrl: 'https://...' },
        }),
      },
      {
        method: 'PUT', path: '/api/v2/trajectories/{id}/case-data',
        summary: '替换交易案例数据',
        desc: '按 trajectory_id 全量替换 legacy case_data_entry（先删后插）。不是 system_ref；系统参考值请用 PUT …/system-ref-entries。本期仅持久化，不参与录制注入。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({
          caseEntries: [
            { fieldKey: '姓名', fieldValue: '张三' },
            { fieldKey: '手机号', fieldValue: '13800138000' },
          ],
        }),
        respExample: J({
          id: 42, caseEntries: [{ id: 2, fieldKey: '姓名', fieldValue: '张三', trajectoryId: 42 }],
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
        desc: '含 caseEntries（交易级案例 KV）。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        respExample: J({
          trajectoryId: 42, name: '...', recordStatus: 'draft',
          caseEntries: [{ fieldKey: '姓名', fieldValue: '张三' }],
          phases: [{
            id: 101, phaseNumber: 1, description: '登录系统', status: 'pending',
            steps: [{
              id: 501, stepNumber: 1, actionType: 'click_element_by_index',
              source: 'agent', confirmed: true,
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
        method: 'PUT', path: '/api/v2/trajectories/{id}/phases',
        summary: '按 id 同步阶段（删缺补新并重排 phase_number）',
        desc: '可选同时传 caseEntries，一并替换交易案例数据。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({
          phases: [
            { id: 101, description: '登录系统' },
            { description: '新阶段' },
            { id: 103, description: '提交' },
          ],
          caseEntries: [{ fieldKey: '姓名', fieldValue: '张三' }],
        }),
      },
      {
        method: 'GET', path: '/api/v2/trajectories/{id}/action-flow',
        summary: 'DB 步骤动作流',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/clear',
        summary: '清空步骤，阶段重置 pending（可按 phaseIds 局部清空）',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({ phaseIds: [101, 102] }),
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
          params: { index: -1, text: '新增' },
          element: {
            xpath: "//button[normalize-space()='新增']",
            xpath_smart: "//button[normalize-space()='新增']",
            xpath_full: '/div[1]/button[2]',
            locator_strategy: 'xpath_smart',
          },
          source: 'manual',
        }),
        notes: [
          '单目标动作会 prepareElementJson；无可用 xpath_smart/xpath_full 时 400',
          '优先写入相对 xpath_smart（语义锚点 + 可见 dialog/drawer scope + 树文案剥 (n)/[V-x] + 图标 el-icon class/tooltip）；否则 xpath_full + locator_fallback_reason',
        ],
      },
      {
        method: 'PATCH', path: '/api/v2/trajectory-steps/{id}',
        summary: '修改步骤',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '501' }],
        reqExample: J({ params: { index: -1, text: '保存' }, element: { xpath_smart: "//button[normalize-space()='保存']" } }),
        notes: [
          '仅当 actionType/params/element 变更时重校验定位器；纯元数据 PATCH 不强制历史行修复',
        ],
      },
      {
        method: 'PATCH', path: '/api/v2/trajectory-steps/{id}/confirm',
        summary: '设置步骤回放确认标记',
        desc:
          '写入 trajectory_step.confirmed（回放确认）：true/1=通过，false/0=不通过。'
          + '与交易级 POST /trajectories/{id}/confirm（改 recordStatus）无关。'
          + 'steps/replay 遇错触发自愈时会自动将对应步骤置为 confirmed=0。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '501' }],
        reqExample: J({ confirmed: true }),
        respExample: J({ id: 501, confirmed: true, confirmedAt: '2026-08-03 12:00:00.000' }),
        notes: [
          '列 COMMENT=回放确认；默认值为 1（通过）；新录制步骤默认为通过',
          'confirmed_at = 回放确认时间',
        ],
      },
      {
        method: 'DELETE', path: '/api/v2/trajectory-steps/{id}',
        summary: '删除步骤',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '501' }],
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/steps/move',
        summary: '拖拽改序 / 跨阶段移动单步',
        desc:
          '将 stepId 移到 targetPhaseId；beforeStepId 有值则插入到该步之前，省略/null 则追加到该阶段末尾。'
          + '事务内重写全局 step_number。AI 录制 / 人工录制 / session.busy（回放等）时 409；不因 recordStatus=completed 拒绝。',
        params: [
          { name: 'id', type: 'number', required: true, in: 'path' },
          { name: 'stepId', type: 'number', required: true, in: 'body' },
          { name: 'targetPhaseId', type: 'number', required: true, in: 'body' },
          { name: 'beforeStepId', type: 'number|null', in: 'body', desc: '省略=阶段末尾' },
        ],
        reqExample: J({ stepId: 123, targetPhaseId: 7, beforeStepId: 456 }),
        notes: [
          '排序字段 step_number；阶段归集 trajectory_phase_id',
          '截图绑 trajectory_step.id，无需迁移',
        ],
      },
    ],
  },
  {
    id: 'batch-import',
    name: '批量导入管理',
    description: 'Excel 批量导入交易并自动录制。主接口一站式：analyze → 草稿 → prepare → record/start → detach；模板 / 状态查询 / 取消为辅助。进度可通过 WS batch:* 或轮询获取。',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/trajectories/batch/template',
        summary: '下载批量录制 Excel 模板',
        desc: '返回 .xlsx 二进制（非 JSON 信封）。列：交易名称 / 需求描述。',
        tryable: false,
        notes: [
          'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'filename=trajectory-batch-template.xlsx',
        ],
      },
      {
        method: 'POST', path: '/api/v2/trajectories/batch/import',
        summary: '批量导入 Excel 并自动录制（一站式）',
        desc: 'multipart 上传 .xlsx；服务端对每行自动执行 analyze → 保存草稿 → prepare → record/start → detach。'
          + ' 立即返回 HTTP 202；后台并行录制（全局 FIFO，受执行机槽位限制）。'
          + ' 需 USE_EXECUTOR=true；须带 Idempotency-Key。functionId / systemAccountId 由页面上下文随表单提交。',
        reqExample: 'form-data: file=@batch.xlsx; functionId=3; systemAccountId=10; model=deepseek-v4-flash\nHeader: Idempotency-Key: <uuid>',
        respExample: J({
          batchId: 'uuid',
          status: 'accepted',
          functionId: 3,
          systemAccountId: 10,
          summary: { total: 5, accepted: 4, rejected: 1, recorded: 0, failed: 0 },
          items: [{ id: 1, rowNumber: 2, name: '开户交易', status: 'pending' }],
        }),
        notes: [
          'HTTP 202 Accepted；v2 信封 body.code 仍为 200',
          '仅 .xlsx；无效行记 rejected，有效行继续；无有效行则 400',
          '同 Idempotency-Key + 同内容 → 返回原任务当前状态；内容不一致 → 409',
          'USE_EXECUTOR=false → 503',
          'WS: batch:progress / batch:done',
        ],
      },
      {
        method: 'GET', path: '/api/v2/trajectories/batch/{batchId}',
        summary: '查询批量任务状态（分页明细）',
        params: [
          { name: 'batchId', type: 'string', required: true, in: 'path' },
          { name: 'page', type: 'number', in: 'query', example: '1' },
          { name: 'pageSize', type: 'number', in: 'query', example: '50' },
        ],
        notes: [
          '非终态 HTTP 202；终态 HTTP 200',
          'itemStatus: pending|analyzing|analyzed|queued|waiting_executor|preparing|recording|recorded|failed|rejected|cancelled',
          'jobStatus: accepted|running|waiting_executor|cancelling|cancelled|completed|completed_with_errors|failed',
        ],
      },
      {
        method: 'POST', path: '/api/v2/trajectories/batch/{batchId}/cancel',
        summary: '取消批量任务',
        desc: '未开始项标 cancelled；analyzing 丢弃 LLM 结果不建草稿；preparing/recording 安全停止并 detach。'
          + ' 已 recorded 永不回退。',
        params: [{ name: 'batchId', type: 'string', required: true, in: 'path' }],
      },
      {
        method: 'WS', path: 'batch:progress',
        summary: '批量导入/录制进度',
        tryable: false,
        respExample: J({
          type: 'batch:progress',
          payload: {
            batchId: 'uuid',
            itemId: 1,
            row: 2,
            trajectoryId: 42,
            itemStatus: 'recording',
            jobStatus: 'running',
            version: 3,
            summary: { total: 5, recorded: 1, failed: 0 },
          },
        }),
        notes: [
          '先写库再广播；允许丢失/乱序，前端用 version 去重并以 GET 状态为事实源',
          '批量页只需订阅 batch:*，无需编排 recording:*',
          '连接通道仍为 ws://<host>/ws',
        ],
      },
      {
        method: 'WS', path: 'batch:done',
        summary: '批量任务全部行终态',
        tryable: false,
        respExample: J({
          type: 'batch:done',
          payload: {
            batchId: 'uuid',
            jobStatus: 'completed_with_errors',
            summary: { total: 5, recorded: 4, failed: 1, rejected: 0 },
          },
        }),
        notes: ['连接通道仍为 ws://<host>/ws'],
      },
    ],
  },
  {
    id: 'recording',
    name: '交易录制',
    description: 'prepare → start → stop → stream/detach（断开画面）或 detach（释放执行资源）。stop / 断开画面不释放槽位；detach 才关浏览器并释放槽。离开工作室不自动 detach；2 小时无步骤写入自动回收。',
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
        desc: '幂等。① 复用本交易已存活 session（含「断开画面」后空闲浏览器）；② 否则优先复用执行机上空闲孤儿 CDP Chrome；③ 再新建浏览器。无空闲槽位则 409。登录/导航不写入 trajectory_step。画面推流成功时将 recordStatus 置为 live（占用，非 AI 录制）。通过 WS 广播 recording:prepare。推流身份以 remote_session.id 为准，按 trajectory 隔离。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({}),
        respExample: J({
          trajectoryId: 42, sessionId: 'uuid', executorNodeUuid: 'node-uuid',
          remoteSessionId: 7, ready: true, attached: true, reused: false, reusedChrome: true,
          recordStatus: 'live',
          login: { skipped: false, done: true, accountId: 10 },
          stream: { ok: true, remoteSessionId: 7 },
          stages: {
            session: { status: 'done' }, browser: { status: 'done' },
            stream: { status: 'done' }, login: { status: 'done' },
          },
        }),
        notes: [
          '409：无可用执行资源（含 holders）— 槽位已满或没有在线执行机',
          '503：会话/执行机其它不可用',
          '不杀孤儿 Chrome：检测到空闲 CDP 则 --cdp-url 复用',
          'stream.ok=true → recordStatus=live（列表可见占用中；人工录制可用）',
          'record/start → recording；stop → recorded；stream/detach(live) → draft；detach(live|recording) → draft',
        ],
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/record/start',
        summary: '开始 AI 录制',
        desc: '同步阻塞至录制完成。phaseIds 省略则录全部阶段。填表靠 phase 内【业务数据】（用户需求希望使用的值）+ LLM 理解对齐；业务数据 ≠ 系统回写并落库的案例数据（autofill 可随机补其余字段）。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({ phaseIds: [101, 102], accountId: 10 }),
        respExample: J({
          trajectoryId: 42, recordStatus: 'recorded',
          phaseIds: [101], systemAccountId: 10,
          events: [
            { type: 'phase_start', phaseNumber: 1 },
            { type: 'phase_boundary_obs', phaseNumber: 1, phase_boundary: { role: 'maintain' } },
            { type: 'phase_intent_obs', phaseNumber: 1 },
            { type: 'phase_done', phaseNumber: 1 },
          ],
          steps: [],
        }),
        notes: [
          '400：未 attach / 无匹配 phase / 缺账号',
          '409：session busy',
          'events[] 可含 phase_boundary_obs / phase_intent_obs（录制可观测，不入 MySQL）',
          'AI_PHASE_BOUNDARY 默认 on；设 off 回退旧意图合约',
        ],
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/record/stop',
        summary: '结束录制（不 detach）',
        desc: 'success=true → recordStatus=recorded；false → draft。会向执行机会话发送 cancel_step，当前 Agent 立即停止后续步骤（当前正在执行的一步结束后不再继续）。响应含 detached:false。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({ success: true }),
        respExample: J({
          trajectoryId: 42, recordStatus: 'recorded', detached: false,
          tree: { phases: [], orphanSteps: [] },
        }),
        notes: ['不释放执行机槽位；释放请 detach', 'busy 时也会发送 cancel_step；Agent 收到后置 stopped，不再开下一步'],
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/confirm',
        summary: '人工确认 / 取消确认（交易级）',
        desc: 'confirmed=true → recordStatus=completed；false → draft。不修改 trajectory_step.confirmed。live/recording 时 409。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({ confirmed: true }),
        respExample: J({
          trajectoryId: 42, recordStatus: 'completed', confirmed: true,
          tree: { phases: [], orphanSteps: [] },
        }),
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/resolve-element',
        summary: '按 label / actionType+params 从已附着页面解析定位器',
        desc: '需 record/prepare 且 BiB 已附着。单匹配返回 element；多匹配返回 ambiguous+matches[] 供用户选择后写入 add-step。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({
          labelText: '客户名称',
          actionType: 'fill_form_field',
          params: { label_text: '客户名称' },
        }),
        respExample: J({
          trajectoryId: 42,
          matchedLabel: '客户名称',
          element: {
            tag: 'input',
            xpath: "//div[contains(@class,'el-form-item')][.//label[contains(normalize-space(.),'客户名称')]]//input",
            xpath_smart: "//div[contains(@class,'el-form-item')][.//label[contains(normalize-space(.),'客户名称')]]//input",
            xpath_full: '/div[1]/form[1]/div[3]/input[1]',
            cssSelector: 'input.el-input__inner',
            attributes: { class: 'el-input__inner' },
            text: '',
            formLabel: '客户名称',
            locator_strategy: 'xpath_smart',
            locator_verified: true,
            target_kind: 'form_input',
            candidates: [
              { type: 'xpath_smart', value: "//div[contains(@class,'el-form-item')][.//label[contains(normalize-space(.),'客户名称')]]//input" },
              { type: 'xpath_full', value: '/div[1]/form[1]/div[3]/input[1]' },
            ],
          },
        }),
        notes: [
          '可选 actionType + params（menu_text / tab_name / row_text+button_text / …）做动作感知解析',
          '多可见匹配：HTTP 200 { ambiguous:true, matches:[{ matchedLabel, element, preview }] } — 不静默择一',
          '菜单示例：客户管理优先稳定 data-id；否则 class-token + 文案 + occurrence',
          '表单字段：xpath / xpath_smart 为 label 锚定相对 xpath（无 label 时用 placeholder）；xpath_full 绝对兜底',
          'POST/PATCH trajectory-steps：单目标动作无可用 xpath 时 400 locator-capture-error',
          'PATCH 仅在 actionType/params/element 变更时重校验定位器',
          '400：未 attach / BiB 未就绪；404：无匹配',
        ],
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/manual-record',
        summary: '开关人工录制',
        desc: 'AI 录制中（recordStatus=recording）时开启会 409。live（推流占用）下可开人工录制。phaseId 省略则追加到最后阶段。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({ enabled: true, phaseId: 102 }),
        respExample: J({ trajectoryId: 42, enabled: true, phaseId: 102 }),
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/steps/replay',
        summary: 'live 会话中重放选中步骤（HTTP 202 + WS 进度；遇错 AI 单步自愈；结构检查点走表单结构自愈）',
        desc:
          '在已 prepare 的 live 会话中，按落库步骤顺序逐步走 replay_actions（_replay.py）。'
          + '请求体 isReplay（默认 true）抑制入库（含 AI 修步）。'
          + 'HTTP **202 Accepted**；v2 信封 **body.code 仍为 200**，data={ trajectoryId, trajectoryDbId, accepted:true, stepIds }。'
          + '进度只走 WS：replay:started → replay:step / replay:form_structure → replay:finished。'
          + '普通步：success → confirmed=1；failed → confirmed=0 后【单步自愈 healType=step】，自愈成功不改回 confirmed，并继续后续步。'
          + 'action_type=save_form_snapshot 为表单结构检查点：verifyFormStructure 按录制 container（main/drawer:/dialog:）选根；有 diff 时走 Type B。'
          + '护栏：container 找不到或 expected/actual 差异过大（错容器扫描）→ 检查点失败，禁止删步/改 snapshot'
          + '（删 missing 同 phase+label 步骤、AI 填 adding、控制面结构化插入 confirmed=0 的新步，本批不执行新步）。'
          + 'payload 含 trajectoryId（及 trajectoryDbId，同值）便于前端过滤。',
        params: [
          { name: 'id', type: 'number', required: true, in: 'path', example: '42' },
          { name: 'stepIds', type: 'number[]', required: true, in: 'body', desc: '已落库 trajectory_step.id 列表', example: '[501, 502]' },
          {
            name: 'isReplay', type: 'boolean', in: 'body',
            desc: '执行时是否抑制入库（默认 true）。Type B 结构化插入绕过此抑制。',
            example: 'true',
          },
        ],
        reqExample: J({ stepIds: [501, 502], isReplay: true }),
        respExample: J({
          trajectoryId: 42,
          trajectoryDbId: 42,
          accepted: true,
          stepIds: [501, 502],
        }),
        notes: [
          'HTTP 202；信封 code=200（勿用 body.code=202）',
          '以 WS replay:finished 为批次结束信号；勿仅用 HTTP 收尾',
          '请求体 isReplay 仅为运行时抑制入库；表字段 is_replay 已删除',
          'trajectory_step.confirmed（回放确认）：1=通过，0=不通过（含触发自愈）',
          '两种自愈：healType=step（单步）vs healType=form_structure（表单结构）— 勿混淆',
          '用户可 POST .../steps/replay/stop 中断自愈/批次 → WS replay:finished { aborted:true, reason:"user_stop", error:null }',
          'WS replay:started { trajectoryId, trajectoryDbId, stepIds }',
          'WS replay:step { trajectoryId, trajectoryDbId, stepId, status, error?, healType? }',
          'WS replay:form_structure { trajectoryId, healType:"form_structure", container, missing_required, added_required, ... }',
          'WS replay:finished { trajectoryId, successCount, failedCount, failedStepIds, error?, healType?, aborted?, reason? }',
          '旧事件 recording:replay_heal 可带 healType；前端可按 healType 区分',
        ],
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/steps/replay/stop',
        summary: '停止进行中的 steps/replay（含 Type A/B 自愈）',
        desc:
          '置 abortReplay 并向执行机发送 cancel_step。不改变 recordStatus、不释放槽位。'
          + '自愈中任何 cancel（含误点 record/stop 触发的 cancel_step）均视为用户中断，避免假成功。'
          + '批次以 WS replay:finished { aborted:true, reason:"user_stop", error:null } 结束。'
          + '幂等：无进行中批次时仍返回 stopped:true。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({}),
        respExample: J({ trajectoryId: 42, trajectoryDbId: 42, stopped: true }),
        notes: [
          '需已 attach（record/prepare）；未附着 → 400',
          '确定性 replay_actions 当前步可能仍跑完，停止在自愈边界 / 下一步边界生效',
          'FE 应用 aborted 判断主动停止，勿把 error 当失败 toast（error 为 null）',
        ],
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/attach',
        summary: '低级附着（一般用 prepare）',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({}),
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/stream/detach',
        summary: '断开画面（只停推流）',
        desc: 'remote_session → idle，清 trajectory.remote_session_id；若 recordStatus=live 则改回 draft。Agent 会话与 Chrome 仍存活，可再附着。与 detach（释放执行资源）不同。广播 recording:stream_detached + remote:status。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({}),
        respExample: J({
          trajectoryId: 42, streamDetached: true, sessionKept: true,
          recordStatus: 'draft', remoteSessionId: 7,
        }),
        notes: ['幂等；不影响其他交易的推流', '再附着：prepare 或 attach-live + remote:subscribe({trajectoryId})'],
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/detach',
        summary: '释放执行资源（关闭浏览器）',
        desc: '关闭 Agent 会话并杀死 Chrome，释放执行机槽位。若当前 recordStatus 为 live 或 recording，则改回 draft（不覆盖 recorded/completed）。与「断开画面」（只停推流）不同。离开录制工作室不会自动调用；无步骤写入超过 2 小时会由服务端自动回收。仅释放本交易资源，不串扰其他交易。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({}),
        respExample: J({ trajectoryId: 42, detached: true, recordStatus: 'draft' }),
      },
    ],
  },
  {
    id: 'replay',
    name: '回放（已弃用：组装 Playwright 全量）',
    description: 'DEPRECATED。产品请用 POST .../steps/replay（live replay_actions / _replay.py）。本路径仍可跑：服务端组装脚本，不向客户端返回 JS 源码；进度走 WS replay:*。',
    endpoints: [
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/replay/prepare',
        summary: '[DEPRECATED] 组装回放计划',
        desc: '已弃用。recordStatus 为 live 或 recording 时 409。脚本不返回给客户端。产品请改用 /steps/replay。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({}),
        respExample: J({
          replayPlanId: 'uuid', trajectoryId: 42, ready: true, stepCount: 15,
          steps: [{ stepId: 501, phaseId: 101, phaseNumber: 1, actionType: '...', confirmed: true }],
          stepMap: [{ assemblerStep: 1, stepId: 501, phaseId: 101, actionType: 'click_element_by_index' }],
        }),
        notes: ['DEPRECATED — 工程资产保留，非产品支持路径'],
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
            status: 'online', capacity: 16, connected: true, inUse: 1,
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
    name: '案例数据（legacy）',
    description:
      'LEGACY：旧 case_data / case_data_entry。用户需求业务数据走 trajectory.task【业务数据】；'
      + '目标系统回写/已校验填表参考值请用「系统参考数据」system_ref_*。旧路径 /api/case-data → 410 Gone。',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/case-data',
        summary: '分页列表（legacy）',
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
        summary: '详情（含 entries，legacy）',
        params: [{ name: 'recordId', type: 'string', required: true, in: 'path', example: 'case_xxx' }],
      },
      {
        method: 'GET', path: '/api/v2/case-data/{recordId}/file',
        summary: '物化为本地 JSON 文件路径（legacy）',
        params: [{ name: 'recordId', type: 'string', required: true, in: 'path', example: 'case_xxx' }],
      },
      {
        method: 'DELETE', path: '/api/v2/case-data/{recordId}',
        summary: '删除（legacy）',
        params: [{ name: 'recordId', type: 'string', required: true, in: 'path', example: 'case_xxx' }],
      },
    ],
  },
  {
    id: 'system-ref-data',
    name: '系统参考数据',
    description:
      '目标系统回写/经校验可复用的填表参考值（system_ref_data / system_ref_entry）。'
      + '≠ 用户需求业务数据；≠ legacy case_data。本迭代仅 CRUD 地基，录制暂不自动注入。',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/system-ref-data',
        summary: '分页列表（可按交易/校验状态过滤）',
        params: [
          { name: 'page', type: 'number', in: 'query', example: '1' },
          { name: 'pageSize', type: 'number', in: 'query', example: '20' },
          { name: 'trajectoryId', type: 'number', in: 'query', example: '42' },
          {
            name: 'verificationStatus', type: 'string', in: 'query',
            desc: 'raw | verified | rejected', example: 'verified',
          },
        ],
        respExample: J({
          rows: [{
            id: 1, recordId: 'sref_xxx', trajectoryId: 42,
            source: 'system_capture', verificationStatus: 'raw', keyCount: 2,
          }],
          total: 1, page: 1, pageSize: 20,
        }),
      },
      {
        method: 'GET', path: '/api/v2/system-ref-data/{id}',
        summary: '详情（含 entries）',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
      },
      {
        method: 'DELETE', path: '/api/v2/system-ref-data/{id}',
        summary: '删除头表（级联 entries）',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
      },
      {
        method: 'GET', path: '/api/v2/trajectories/{id}/system-ref-entries',
        summary: '按交易列出系统参考 KV',
        params: [
          { name: 'id', type: 'number', required: true, in: 'path', example: '42' },
          {
            name: 'verificationStatus', type: 'string', in: 'query',
            desc: 'raw | verified | rejected', example: 'verified',
          },
        ],
        respExample: J({
          trajectoryId: 42,
          entries: [
            { id: 1, fieldKey: '客户名称', fieldValue: '某某公司', verificationStatus: 'verified' },
          ],
        }),
      },
      {
        method: 'PUT', path: '/api/v2/trajectories/{id}/system-ref-entries',
        summary: '按交易全量替换系统参考 KV',
        desc:
          '先删后插。写入目标系统回写/人工导入的参考值；禁止把用户需求业务数据块当 system_ref 写入。'
          + 'verificationStatus=verified 表示经校验可复用。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({
          source: 'system_capture',
          verificationStatus: 'raw',
          entries: [
            { fieldKey: '客户名称', fieldValue: '某某科技有限公司' },
            { fieldKey: '证件号码', fieldValue: '91440101MA5XXXXXX' },
          ],
        }),
        respExample: J({
          trajectoryId: 42,
          entries: [{ id: 1, fieldKey: '客户名称', fieldValue: '某某科技有限公司', trajectoryId: 42 }],
          header: { id: 1, recordId: 'sref_xxx', verificationStatus: 'raw' },
        }),
      },
      {
        method: 'DELETE', path: '/api/v2/trajectories/{id}/system-ref-entries',
        summary: '删除该交易全部系统参考数据',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
      },
    ],
  },
  {
    id: 'memory',
    name: '记忆 / 审计',
    description:
      'AI 记忆系统（P0/P1/P2）：事件摄取、Fact Pack 检索（可含同功能历史复用）、决策记录、审计汇总与多模型对比。外部 Vue 审计页据此渲染。'
      + '决策类型：form_value / scenario_summary / heal（回放自愈）/ analyze_phase；agent_step 本迭代不做。'
      + 'AI_MEMORY_HISTORY 默认关；开启后 retrieve 传 functionId 并入历史事实（低权重）。'
      + 'GET /memory/compare：同需求多模型录制对比（步骤数 / 成功 / 审计通过率 / 填表值并集一致性）。',
    endpoints: [
      {
        method: 'POST', path: '/api/v2/memory/events',
        summary: '批量摄取记忆事件（旁路写）',
        desc: 'Body: { events: [...] } 或直接数组。事件可内嵌 facts[] / decision{}。Agent 主路径不等待落库。',
        reqExample: J({
          events: [{
            eventType: 'case_saved',
            trajectoryId: 42,
            phaseNumber: 1,
            payload: { key: '客户名称', value: '某某公司' },
          }],
        }),
        respExample: J({ inserted: 1, facts: 0, decisions: 0, relations: 0 }),
      },
      {
        method: 'POST', path: '/api/v2/memory/retrieve',
        summary: '检索 Fact Pack（阶段开始前注入用）',
        desc: '传 functionId 且 AI_MEMORY_HISTORY=true 时，并入同功能历史成功交易的当前版本事实（source=history, stance=inferred, weight×0.5，排序靠后，绝不覆盖本交易 requirement 事实）。',
        reqExample: J({ trajectoryId: 42, phaseNumber: 2, entity: '', limit: 50, maxChars: 2000, functionId: 7 }),
        respExample: J({
          facts: [
            { id: 7, entity: '客户名称', attribute: 'value', value: '某某公司', source: 'requirement', stance: 'authoritative', effectiveWeight: 1.2 },
            { id: 99, entity: '联系人', attribute: 'value', value: '历史联系人', source: 'history', stance: 'inferred', effectiveWeight: 0.3 },
          ],
          dropped: [],
          budget: { used: 800, max: 2000, limit: 50 },
        }),
      },
      {
        method: 'GET', path: '/api/v2/memory/decisions',
        summary: '决策列表（按交易/阶段/类型/状态过滤）',
        params: [
          { name: 'trajectoryId', type: 'number', in: 'query', example: '42' },
          { name: 'phaseNumber', type: 'number', in: 'query', example: '1' },
          {
            name: 'decisionType', type: 'string', in: 'query',
            desc: 'form_value | scenario_summary | heal | analyze_phase', example: 'scenario_summary',
          },
          { name: 'auditStatus', type: 'string', in: 'query', desc: 'pending | passed | failed', example: 'passed' },
          { name: 'limit', type: 'number', in: 'query', example: '50' },
          { name: 'offset', type: 'number', in: 'query', example: '0' },
        ],
      },
      {
        method: 'GET', path: '/api/v2/memory/decisions/{id}',
        summary: '决策详情（含 inputFacts 回填）',
        desc: 'inputFactIds 为引用事实 id；inputFacts 为对应事实正文（含被 supersede 版本），供审计复现「模型依据了什么」。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '9' }],
        respExample: J({
          id: 9, trajectoryId: 42, decisionType: 'scenario_summary', model: 'deepseek-chat',
          auditStatus: 'passed', inputFactIds: [7, 8],
          inputFacts: [
            { id: 7, entity: '客户名称', attribute: 'value', value: '某某公司', source: 'requirement', stance: 'authoritative', weight: 1.5, phaseNumber: 1 },
          ],
        }),
      },
      {
        method: 'GET', path: '/api/v2/memory/audit/summary',
        summary: '审计汇总（含 topReferencedFacts）',
        desc: '仅按 trajectoryId 聚合；topReferencedFacts 为该交易决策中被引用最多的事实 Top10。',
        params: [{ name: 'trajectoryId', type: 'number', required: true, in: 'query', example: '42' }],
        respExample: J({
          trajectoryId: 42, total: 12, byStatus: { pending: 0, passed: 11, failed: 1 }, overridden: 0,
          topReferencedFacts: [
            { id: 7, refs: 5, entity: '客户名称', attribute: 'value', value: '某某公司' },
          ],
        }),
      },
      {
        method: 'GET', path: '/api/v2/memory/compare',
        summary: '多模型对比报告（P2-4）',
        desc:
          '对已录制的多条交易（通常同需求、不同 model）汇总步骤数、成功状态、审计通过率与填表值一致性。'
          + 'formValues 仅含 source∈{llm,page,rule,agent,observer}（排除 requirement/history）。'
          + 'consistency 用 entity 并集分母（缺字段=不一致）；找到 <2 条时 consistency=null。'
          + '无 token 用量字段，用 isSuccessful + decisions.passRate 代理。'
          + '400=无有效 id；404=全部缺失；200=至少找到 1 条（含 missingIds）。',
        params: [{
          name: 'trajectoryIds', type: 'string', required: true, in: 'query',
          example: '10,11', desc: '逗号分隔交易 id（2–10；重复 query 亦可）',
        }],
        respExample: J({
          trajectories: [{
            id: 10, model: 'deepseek-chat', stepCount: 42, phaseCount: 5,
            isSuccessful: true, isDone: true, task: '…',
            decisions: { total: 12, byStatus: { pending: 0, passed: 11, failed: 1 }, passRate: 0.9167, overridden: 0 },
            formValues: { 客户名称: '某某公司' },
          }],
          consistency: {
            entitiesCompared: 8, exactMatchRate: 0.625,
            pairwise: [{ a: 10, b: 11, matchRate: 0.7, compared: 10 }],
          },
          missingIds: [],
          note: 'token usage not stored; use decisions.passRate and isSuccessful as success proxies',
        }),
      },
      {
        method: 'POST', path: '/api/v2/memory/audit/run',
        summary: '离线复检整条交易',
        reqExample: J({ trajectoryId: 42 }),
      },
      {
        method: 'GET', path: '/api/v2/trajectories/{id}/memory',
        summary: '交易记忆时间线（events + facts + decisions）',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
      },
      {
        method: 'GET', path: '/api/v2/memory/stats',
        summary: '记忆表统计',
        respExample: J({
          tables: { memoryEvent: 120, memoryFact: 45, memoryRelation: 30, decisionRecord: 12 },
          recentEventTypes: [{ eventType: 'case_saved', count: 20 }],
        }),
      },
    ],
  },
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
        notes: ['503：CDP/页面未就绪', '须传 sessionId；按 trajectoryId 写入 live 映射'],
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
        desc: 'remote_session → idle；可选 body.trajectoryId 做归属校验。Chrome 与 Agent 会话仍存活。产品路径优先用 POST /trajectories/{id}/stream/detach。与 trajectories/:id/detach（释放执行资源、关浏览器）不同。',
        params: [{ name: 'id', type: 'string', required: true, in: 'path', example: '7' }],
        reqExample: J({ trajectoryId: 42 }),
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
    description: '按 trajectory_step 绑定的 before/after 截图；回放中亦可经 WS replay:screenshot 获取临时 URL',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/trajectories/{trajectoryId}/screenshots',
        summary: '交易关联截图列表',
        params: [{ name: 'trajectoryId', type: 'number', required: true, in: 'path', example: '42' }],
        respExample: J([{
          id: 1, fileSize: 12345,
          mimeType: 'image/png', trajectoryStepId: 501, stepNumber: 1, kind: 'before',
        }]),
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
        summary: '产品前端通道',
        desc: '连接后可收 recording:*、replay:*、remote:*（含标签页列表）、二进制投屏帧。客户端可发 ws:ping、replay:start、remote:tabs、remote:switch_tab 等。',
        tryable: false,
        respExample: J({ type: 'server:init', payload: { /* 会话快照 */ } }),
        notes: [
          '客户端 → { type: "ws:ping", payload: {} } → 收到 ws:pong',
          '客户端 → { type: "replay:start", payload: { trajectoryId, replayPlanId? } }',
          '客户端 → { type: "remote:input", payload: { kind, ... } }（画布键鼠/文本透传，见 remote:input）',
          '客户端 → { type: "remote:tabs" | "remote:switch_tab", payload: {...} }（见下方条目）',
          '二进制帧：RSCF 投屏（产品前端画布）',
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
        method: 'WS', path: 'recording:detached',
        summary: '执行资源已释放（手动 detach / 空闲回收）',
        tryable: false,
        respExample: J({
          type: 'recording:detached',
          payload: { trajectoryId: 42, reason: 'idle', recordStatus: 'draft', sessionId: 'uuid' },
        }),
        notes: [
          'reason: idle（2 小时无步骤）| manual | batch_complete | batch_cancel | batch_failed | batch_recovery',
          '前端应按 trajectoryId 过滤；只清空本交易画布与 prepare 状态',
          '同时会广播 remote:status（attached=false, trajectoryId）',
        ],
      },
      {
        method: 'WS', path: 'recording:stream_detached',
        summary: '已断开画面（浏览器仍空闲）',
        tryable: false,
        respExample: J({
          type: 'recording:stream_detached',
          payload: {
            trajectoryId: 42, remoteSessionId: 7, recordStatus: 'draft', sessionId: 'uuid',
          },
        }),
        notes: [
          '对应 POST .../stream/detach',
          '前端可保留 preferredSessionId，再次附着即可',
          '勿与 recording:detached（关浏览器）混淆',
        ],
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
        method: 'WS', path: 'remote:input',
        summary: '画布键鼠 / 文本透传到远程 Chrome（CDP）',
        desc: '产品前端投屏画布将鼠标、键盘与已确认文本转发到执行端。中文等 IME 必须在 SPA 本机透明 input 完成 composition，只把已确认字符串用 kind:text 下发；禁止把拼音 keyDown 当字符透传。',
        tryable: false,
        reqExample: J({
          type: 'remote:input',
          payload: {
            kind: 'text',
            text: '分类名称',
            replace: false,
            trajectoryId: 36,
          },
        }),
        notes: [
          'kind: mouse | key | text | navigate',
          'mouse：{ type: mousePressed|mouseReleased|mouseMoved|mouseWheel, x, y }（x/y 为 0~1 归一化）',
          'key：{ type: keyDown|keyUp, key, code, keyCode, modifiers } — Backspace / Enter / 方向键等控制键',
          'text：{ text, replace?: boolean } — CDP Input.insertText；replace:true 时先选中 activeElement 再写入（空 text 则清空）',
          'navigate：{ action: back|forward|reload }',
          'IME 约定：SPA 在画布上盖透明本机 input；composition 期间不发 key/text；compositionend / 已确认增量发 kind:text；控制键仍走 kind:key',
          '打字前先 mouse 点中远程输入框，保证 remote activeElement 正确',
          'agentBusy / inputEnabled=false 时控制面拒绝写入（hover 检查可例外）',
          '路由字段：trajectoryId / sessionId / remoteSessionId 与其它 remote:* 一致',
        ],
      },
      {
        method: 'WS', path: 'remote:status',
        summary: 'BiB 附着状态变化',
        tryable: false,
        respExample: J({ type: 'remote:status', payload: { attached: true, remoteSessionId: 7 } }),
        notes: [
          '推流为二进制 RSCF JPEG；执行端约 30fps 上限、默认编码 1600×900 / quality≈65；画布显示默认自适应容器；编码跟视口走（不再强制抬到 1080p）',
          'Chrome screencast 在执行端即时 ack；客户端无需每帧 remote:ack',
          '控制面 / 客户端在 WS 积压时丢弃旧帧，优先最新画面',
        ],
      },
      {
        method: 'WS', path: 'remote:tabs',
        summary: '查询 / 推送浏览器标签页列表',
        desc: '客户端请求当前 Chrome 打开的 page targets；服务端在 BiB ready、列表刷新、切换标签后也会主动推送同结构消息。投屏与 Agent 操作应对齐到 activeTargetId 对应页。',
        tryable: false,
        reqExample: J({ type: 'remote:tabs', payload: {} }),
        respExample: J({
          type: 'remote:tabs',
          payload: {
            sessionId: 'uuid',
            activeTargetId: 'CDP-TARGET-ID',
            switched: false,
            tabs: [
              {
                targetId: 'CDP-TARGET-ID',
                url: 'https://example.com/app',
                title: '业务页',
                index: 0,
                active: true,
                pageId: null,
              },
            ],
          },
        }),
        notes: [
          '方向：客户端 → 控制面 → 执行机 session.bib_tabs；结果广播为 remote:tabs',
          'tabs[].targetId：CDP Target ID（切换必填）',
          'tabs[].active / activeTargetId：当前 BiB 投屏所在页',
          'BiB attach 成功（session.bib_ready）时也会推送一次 remote:tabs',
          '无独立 REST；产品前端走 /ws',
        ],
      },
      {
        method: 'WS', path: 'remote:switch_tab',
        summary: '切换 BiB 投屏标签（并同步 Agent 当前页）',
        desc: '将 screencast 切到指定 targetId，并通知 Agent switch_tab，避免「画面在 B 页、操作在 A 页」。',
        tryable: false,
        reqExample: J({
          type: 'remote:switch_tab',
          payload: {
            targetId: 'CDP-TARGET-ID',
            url: 'https://example.com/app',
            pageId: null,
          },
        }),
        respExample: J({
          type: 'remote:tabs',
          payload: {
            sessionId: 'uuid',
            activeTargetId: 'CDP-TARGET-ID',
            tabs: [
              { targetId: 'OTHER', url: '...', title: '...', index: 0, active: false },
              { targetId: 'CDP-TARGET-ID', url: 'https://example.com/app', title: '业务页', index: 1, active: true },
            ],
          },
        }),
        notes: [
          '方向：客户端 → 控制面 → 执行机 session.bib_switch_tab',
          'payload.targetId 必填；url / pageId 可选（用于对齐 Agent 当前 page）',
          '成功后服务端广播 remote:tabs（新 activeTargetId）',
          '同时可能收到 remote:status（附着/会话状态快照）',
          '无独立 REST；产品前端走 /ws',
        ],
      },
      {
        method: 'WS', path: 'replay:status',
        summary: '回放状态',
        tryable: false,
        respExample: J({ type: 'replay:status', payload: { replayId: 'uuid', trajectoryId: 42, phase: 'running' } }),
      },
      {
        method: 'WS', path: 'replay:step',
        summary: '回放单步进度（可含 healType）',
        tryable: false,
        respExample: J({
          type: 'replay:step',
          payload: {
            trajectoryId: 42, trajectoryDbId: 42, stepId: 501,
            status: 'failed', error: '…', healType: 'step',
          },
        }),
      },
      {
        method: 'WS', path: 'replay:form_structure',
        summary: '表单结构变化检测报告（Type B / healType=form_structure）',
        tryable: false,
        respExample: J({
          type: 'replay:form_structure',
          payload: {
            trajectoryId: 42,
            trajectoryDbId: 42,
            stepId: 510,
            healType: 'form_structure',
            container: 'main',
            missing_required: ['旧字段'],
            added_required: ['新字段'],
            missing_optional: [],
            added_optional: [],
            hasRequiredChange: true,
            hasOptionalChange: false,
            reordered: false,
          },
        }),
        notes: [
          '仅在 save_form_snapshot 检查点校验发现 diff 时发出',
          '随后可能删库 missing 步骤、AI 补填 adding，并结构化插入 confirmed=0 新步',
        ],
      },
      {
        method: 'WS', path: 'replay:screenshot',
        summary: '回放截图（before/after 各一次，含 kind）',
        tryable: false,
        respExample: J({
          type: 'replay:screenshot',
          payload: {
            replayId: 'uuid', trajectoryId: 42, stepId: 501,
            kind: 'after', fileName: 'step-1-after-….png', url: '/api/test/screenshots/...',
          },
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
  {
    id: 'export-mgmt',
    name: '导出管理',
    description: '对外外部系统（传统执行引擎等）的步骤导出。当前约定 5 字段：name/type/value/locateBy/target。',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/export/legacy-engine/schema',
        summary: '传统引擎字段契约',
        desc: '返回 5 字段说明（含中文名）、type 枚举、action→type 映射。引擎侧字段名未最终敲定前以此为准。',
        respExample: J({
          code: 200,
          message: 'ok',
          data: {
            schemaVersion: 1,
            fields: [
              { key: 'name', zh: '操作名称', type: 'string' },
              { key: 'type', zh: '类型', type: 'string', desc: '仅当前可录制动作：click/input/select:click/select:tree/radio/date' },
              { key: 'value', zh: '值', type: 'string' },
              { key: 'locateBy', zh: '定位方法', type: 'string', default: 'xpath' },
              { key: 'target', zh: '操作对象', type: 'string', desc: '优先相对 xpath；无则绝对 xpath' },
            ],
            types: ['click', 'date', 'input', 'radio', 'select:click', 'select:tree'],
            actionTypeMap: {
              fill_form_field: 'input',
              fill_date_field: 'date',
              select_option: 'select:click',
              select_tree_option: 'select:tree',
              click_radio: 'radio',
              click_element_by_index: 'click',
              click_menu_item: 'click',
              close_dialog: 'click',
              switch_tab: 'click',
            },
          },
        }),
        notes: [
          '仅映射当前可录制并落库的动作，不枚举传统引擎全部操作类型',
          'locateBy 默认 xpath',
          'target 优先 xpath_smart（语义锚点 + 可见 scope + 动态文本剥离 + tooltip 图标）；无相对 xpath 时回退 xpath_full，不丢弃步骤',
          'wait_for_loading / go_to_url 等非落库 UI 步骤跳过',
          'meta 含 element / params（步骤原始 JSON）及 targetSource 等，对接核心 5 字段时可剥离',
        ],
      },
      {
        method: 'GET', path: '/api/v2/export/trajectories/{id}/legacy-engine',
        summary: '导出轨迹步骤（传统引擎）',
        desc: '将 trajectory_step 映射为 operations[]。跳过扫描/记忆类 meta 动作。无相对 xpath 的步骤仍导出（target 回退绝对路径）。',
        params: [
          { name: 'id', type: 'number', required: true, in: 'path', desc: '轨迹 id', example: '53' },
          { name: 'stepIds', type: 'string', in: 'query', desc: '逗号分隔步骤 id', example: '2343,2344' },
          { name: 'phaseIds', type: 'string', in: 'query', desc: '逗号分隔阶段 id 或 phaseNumber', example: '1' },
          { name: 'includeMeta', type: 'boolean', in: 'query', desc: 'false 时只返回 5 字段', example: 'true' },
        ],
        respExample: J({
          code: 200,
          message: 'ok',
          data: {
            trajectoryId: 53,
            schemaVersion: 1,
            count: 2,
            skipped: { metaActions: 0, filtered: 0 },
            stats: { absoluteFallback: 0 },
            operations: [
              {
                name: '点击:产品管理',
                type: 'click',
                value: '',
                locateBy: 'xpath',
                target: "//li[contains(concat(' ', normalize-space(@class), ' '), ' menu-item ')][normalize-space()='产品管理']",
                meta: {
                  stepId: '2343',
                  action: 'click_element_by_index',
                  ok: true,
                  targetSource: 'xpath_smart',
                  warnings: [],
                  params: { text: '产品管理', index: -1, tag_name: 'li' },
                  element: { xpath_smart: "//li[…][normalize-space()='产品管理']" },
                },
              },
              {
                name: '点击:产品库管理',
                type: 'click',
                value: '',
                locateBy: 'xpath',
                target: "//*[contains(concat(' ', normalize-space(@class), ' '), ' submenu-item ')][normalize-space()='产品库管理']",
                meta: { stepId: '2344', action: 'click_element_by_index', ok: true, targetSource: 'xpath_smart', warnings: [] },
              },
            ],
          },
        }),
      },
      {
        method: 'POST', path: '/api/v2/export/trajectories/{id}/legacy-engine',
        summary: '导出轨迹步骤（body 过滤）',
        desc: '与 GET 相同；长 stepIds 列表用 body。',
        params: [
          { name: 'id', type: 'number', required: true, in: 'path', desc: '轨迹 id' },
          { name: 'stepIds', type: 'number[]', in: 'body', desc: '步骤 id 列表', example: '[2343,2344]' },
          { name: 'phaseIds', type: 'number[]', in: 'body', desc: '阶段过滤' },
          { name: 'includeMeta', type: 'boolean', in: 'body', desc: '是否附带 meta' },
        ],
        reqExample: J({ stepIds: [2343, 2344], includeMeta: false }),
      },
      {
        method: 'POST', path: '/api/v2/export/legacy-engine/preview',
        summary: '预览映射（不读库）',
        desc: '传入 steps[]（DB 步骤或 action entry 形态），返回 operations。供前端预览 / 契约联调。',
        params: [
          { name: 'steps', type: 'object[]', required: true, in: 'body', desc: '步骤数组' },
          { name: 'includeMeta', type: 'boolean', in: 'body' },
        ],
        reqExample: J({
          steps: [{
            actionType: 'fill_form_field',
            params: { label_text: '搜索关键字', value: '贷款' },
            element: {
              xpath_smart: "//input[contains(@placeholder,'搜索关键字')]",
            },
          }],
          includeMeta: false,
        }),
        respExample: J({
          code: 200,
          message: 'ok',
          data: {
            count: 1,
            operations: [{
              name: '填写:搜索关键字',
              type: 'input',
              value: '贷款',
              locateBy: 'xpath',
              target: "//div[contains(@class,'el-form-item')][.//label[contains(normalize-space(.),'搜索关键字')]]//input",
            }],
          },
        }),
      },
      {
        method: 'POST', path: '/api/v2/export/legacy-engine/map-step',
        summary: '单步映射调试',
        desc: '将单步映射为 5 字段；meta/scan 动作返回 422。',
        reqExample: J({
          step: {
            actionType: 'click_element_by_index',
            params: { text: '产品管理' },
            element: { xpath_smart: "//li[contains(concat(' ', normalize-space(@class), ' '), ' menu-item ')][normalize-space()='产品管理']" },
          },
        }),
      },
    ],
  },
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
];

export const RECORDING_FLOW = [
  'analyze → POST /trajectories（带 phases）',
  'PATCH /trajectories/:id 绑定 systemAccountId',
  'POST .../record/prepare（复用空闲资源 / 占槽 + 登录，幂等）',
  'POST .../record/start（可选 phaseIds；可关页后台继续）',
  'POST .../record/stop（不释放槽位）',
  'POST .../confirm（人工确认 → completed；取消 → draft）',
  'POST .../resolve-element（可选：按 label 抓定位器写入步骤 element_json）',
  'POST .../stream/detach（断开画面；或 .../detach 释放执行资源关浏览器）',
];

export const BATCH_RECORDING_FLOW = [
  'GET /trajectories/batch/template → 填写 交易名称 / 需求描述',
  'POST /trajectories/batch/import（file + functionId + systemAccountId + Idempotency-Key）→ HTTP 202',
  '后台：analyze → 草稿 → prepare → record/start → detach（并行，全局 FIFO）',
  'WS batch:progress / batch:done；或 GET /trajectories/batch/{batchId} 轮询',
  '可选 POST .../batch/{batchId}/cancel',
];
