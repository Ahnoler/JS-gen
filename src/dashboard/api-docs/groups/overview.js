/**
 * API group(s): overview, system-mgmt — extracted from catalog.js.
 * Keep in sync with src/routes/v2/*.js
 */

/** @typedef {{ name: string, type: string, required?: boolean, in?: 'path'|'query'|'body', desc: string, example?: string }} Param */
/** @typedef {{ method: string, path: string, summary: string, desc?: string, params?: Param[], reqExample?: string, respExample?: string, notes?: string[], deprecated?: boolean, tryable?: boolean }} Endpoint */
/** @typedef {{ id: string, name: string, description: string, endpoints: Endpoint[] }} TagGroup */

import { J } from './_j.js';

/** @type {TagGroup[]} */
export const GROUP_OVERVIEW = [
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
        desc: 'type=1（系统）可同时传 accounts[] 一次创建多个系统账号；账号字段见参数说明。',
        params: [
          { name: 'type', type: 'number', required: true, in: 'body', desc: '1 系统 / 2 模块 / 3 功能' },
          { name: 'name', type: 'string', required: true, in: 'body', desc: '名称' },
          { name: 'parentId', type: 'number', in: 'body', desc: '父节点；系统节点固定为 0' },
          { name: 'url', type: 'string', in: 'body', desc: '系统地址（仅 type=1）', example: 'https://example.com' },
          { name: 'accounts', type: 'array', in: 'body', desc: '系统账号数组（仅 type=1）：[{ name, account, password, loginUrl?, remark?, sortOrder? }]' },
        ],
        reqExample: J({
          type: 1,
          parentId: 0,
          name: '核心系统',
          url: 'https://example.com',
          accounts: [{ name: '测试者', account: 701994, password: 1 }],
          description: '',
        }),
        respExample: J({
          id: 1,
          type: 1,
          name: '核心系统',
          url: 'https://example.com',
          parentId: 0,
          accounts: [{ id: 10, systemId: 1, name: '测试者', account: '701994', password: '1' }],
        }),
      },
      {
        method: 'PUT', path: '/api/v2/system-mgmt/nodes/{id}',
        summary: '修改节点',
        desc: 'type=1（系统）可传 accounts[] 全量替换该系统下的账号：按 id 更新、无 id 按 name 匹配，未出现的老账号删除；不传 accounts 则不动账号。',
        params: [
          { name: 'id', type: 'number', required: true, in: 'path', example: '1' },
          { name: 'accounts', type: 'array', in: 'body', desc: '系统账号数组（仅 type=1）：[{ id?, name, account, password, loginUrl?, remark?, sortOrder? }]' },
        ],
        reqExample: J({
          name: '系统节点-新名称',
          url: 'https://example.com/login',
          accounts: [{ name: '测试者', account: 701994, password: 1 }],
          description: '...',
        }),
        respExample: J({
          id: 1,
          name: '系统节点-新名称',
          url: 'https://example.com/login',
          accounts: [{ id: 10, systemId: 1, name: '测试者', account: '701994', password: '1' }],
        }),
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
      {
        method: 'POST', path: '/api/v2/system-mgmt/nodes/:id/import-json',
        summary: '导入菜单 JSON（建模组件关系）',
        desc: 'multipart/form-data，字段 file=被测系统《建模组件关系》.json。解析 umlRelInfo，在 :id 系统节点下建立两级菜单树（顶层子领域→模块、叶子子领域→功能，中间层不建节点），记录菜单唯一ID(umlEcd，建模码形如 UML…；与 AI 扫描写入的数字串 id 为两种来源格式)、功能节点落地 pageId（仅 managePage，0/1；写入 `system.pd_cmpt_ecd` + 至多一行 `system_page`）、来源标记 json_import；重复导入按 umlEcd 幂等更新，同名同类型已存在的非 JSON 节点会被收编。成功返回 201 与统计、重建后的树。',
        tryable: false,
        reqExample: 'form-data: file=@全部领域-建模组件关系.json',
        respExample: J({ created: 120, updated: 0, adopted: 24, markedOffline: 0, pagesImported: 411, tree: [] }),
        notes: [':id 必须是系统类型节点 (type=1)', '落地 pageId 只收第一个非空 managePage.pdCmptEcd；guidePages 不入库；模块不挂落地页', 'JSON 中消失的旧 json_import 菜单会保留并标记 unmatchedFlag'],
      },
        {
          method: 'POST', path: '/api/v2/system-mgmt/nodes/:id/scan-menu',
          summary: '触发菜单扫描（后台）',
          desc: '打开被测系统浏览器并自动登录，一次提取全部菜单（名称/层级/xpath），按中文名匹配回写 system.menu_xpath；SUT 有而 JSON 无的菜单按实际层级新增（source=ai）。apply 后对空 pd_cmpt_ecd 的 L2 功能点读天元（组件单码→场景编号）写入落地 pageId。后台异步执行，立即返回 202 与 scanId。同一时刻仅允许一个扫描任务（409 冲突）。导入 JSON 成功后默认自动触发（?autoScan=false 可关闭）。',
          tryable: false,
          reqExample: 'POST /api/v2/system-mgmt/nodes/1/scan-menu',
          respExample: J({ scanId: '<uuid>' }),
          notes: ['系统节点需已配置 url 与登录账号（system_account）', '状态轮询：GET /api/v2/system-mgmt/menu-scan/:scanId'],
        },
        {
          method: 'POST', path: '/api/v2/system-mgmt/nodes/:id/fill-pageid',
          summary: '仅补采落地 pageId（默认 AI）',
          desc: '登录被测系统后，对空 pd_cmpt_ecd 的 L2 点读天元写入落地 pageId；默认只处理 source=ai。不扫菜单树、不改菜单结构。与 scan-menu 共用单飞锁与状态轮询 GET menu-scan/:scanId。',
          tryable: false,
          reqExample: 'POST /api/v2/system-mgmt/nodes/1/fill-pageid\nPOST /api/v2/system-mgmt/nodes/1/fill-pageid?sources=ai',
          respExample: J({ scanId: '<uuid>' }),
          notes: ['query.sources 逗号分隔，默认 ai', 'stats：pageIdCandidates/pageIdFilled/pageIdSkipped', '读不到或 L2 点击失败 skip；不写 AILZ；不覆盖已有 pageId'],
        },
        {
          method: 'GET', path: '/api/v2/system-mgmt/menu-scan/:scanId',
          summary: '菜单扫描状态轮询',
          desc: 'running 返回 202，completed/failed 返回 200。stats 含 totalScanned/matched/created/clearedUnmatched/unmatchedScanned/pageIdCandidates/pageIdFilled/pageIdSkipped（fill-pageid 任务仅含 pageId* 与 sources）。',
          tryable: false,
          reqExample: 'GET /api/v2/system-mgmt/menu-scan/<scanId>',
          respExample: J({ scanId: '<uuid>', systemNodeId: 1, status: 'completed', stats: { totalScanned: 410, matched: 232, created: 178, clearedUnmatched: 0, unmatchedScanned: [], pageIdCandidates: 12, pageIdFilled: 8, pageIdSkipped: 4 }, error: null, startedAt: '<iso>', finishedAt: '<iso>' }),
          notes: ['读不到天元编号时 skip 不失败', '不覆盖已有 pageId（仅空 pd_cmpt_ecd）', '不写 AILZ 到菜单'],
        },
        {
          method: 'GET', path: '/api/v2/system-mgmt/nodes/:id/change-log',
          summary: '菜单变更历史',
          desc: '按系统节点返回菜单变更逐事件流水（id 倒序）。source=import（JSON 导入）/ scan（菜单扫描）；change_type 含 renamed/updated/adopted/created/moved/transaction_migrated/deleted/merged/unmatched_marked/offline_marked（导入侧版本已下线）；detail 为 JSON 字符串。测试人员查版本演化（version 过滤），管理员按 transaction_migrated 记录手动迁移排查。',
          params: [
            { name: 'id', type: 'number', required: true, in: 'path', desc: '系统节点 ID', example: '1' },
            { name: 'version', type: 'number', in: 'query', desc: '菜单版本号过滤（对应 snapshot 版本）', example: '3' },
            { name: 'limit', type: 'number', in: 'query', desc: '返回条数，默认 200，最大 1000', example: '200' },
          ],
          tryable: false,
          reqExample: 'GET /api/v2/system-mgmt/nodes/1/change-log?version=3&limit=200',
          respExample: J([
            { id: 12, systemNodeId: 1, menuVersion: 3, source: 'import', changeType: 'renamed', nodeId: 42, detail: '{"oldName":"对私客户管理","name":"个人客户管理"}', createdAt: '<iso>' },
            { id: 11, systemNodeId: 1, menuVersion: 3, source: 'scan', changeType: 'unmatched_marked', nodeId: 55, detail: '{"name":"旧功能","pageIds":["ZJJK00067207"]}', createdAt: '<iso>' },
          ]),
          notes: ['detail 为 JSON 字符串，前端需自行 parse', 'transaction_migrated 的 detail 含 trajectoryId/fromFunctionId/toFunctionId/pageId，用于手动迁移排查'],
        },
        {
          method: 'POST', path: '/api/v2/system-mgmt/nodes/:id/push-menu',
          summary: '推送系统菜单至伙伴平台',
          desc: '从本仓系统节点组菜单，POST 伙伴 importData。`:id` 为本仓系统 id（菜单来源）；body 须带伙伴 `systemNodeId`（下拉 getSystemNodeLevel 所选）。',
          tryable: false,
          reqExample: 'POST /api/v2/system-mgmt/nodes/1/push-menu\n{ "systemNodeId": 51, "systemName": "系统1" }',
          respExample: J({ status: 'pushing', menuVersion: 8, menuCount: 42, partner: { code: 200, msg: '20260902100654-116736' }, partnerWire: { systemNodeId: 51, systemName: '系统1', menuVersion: 8, menuCount: 42 }, source: { systemId: 'JSGEN:1', systemName: 'JSGEN:信贷系统' }, autoSyncMs: 5000 }),
          notes: [
            ':id 必须是本仓系统类型节点 (type=1)，决定 menus[] 数据来源',
            'body.systemNodeId（或 partnerSystemId）= 伙伴平台系统 id，来自 GET /api/v2/export/partner/menu-push/systems',
            'body.systemName（或 partnerSystemName）= 伙伴平台系统名，与下拉选中项 name 一致，必填',
            'menus[].umlEcd / parentUmlEcd：json_import 为建模 UML… 码；AI 扫描为 String(node.id)；空库值推送时回退节点 id',
            '202 响应 source 为本仓来源标识（id/name 加前缀 JSGEN:，仅本仓可见，不发给伙伴）',
            'partnerWire 为实际 POST importData 的字段子集',
            'access_token 可选；优先请求头 access_token',
            'autoSyncMs 由 MENU_PUSH_AUTO_SYNC_MS 配置，默认 5000ms',
          ],
        },
        {
          method: 'GET', path: '/api/v2/system-mgmt/nodes/:id/push-menu/status',
          summary: '菜单推送状态轮询',
          desc: '返回 status/menuVersion/pushedAt/syncedAt/error。pushing 超过 autoSyncMs 时服务端自动纠偏为 synced。',
          params: [
            { name: 'id', type: 'number', required: true, in: 'path', desc: '系统节点 ID', example: '1' },
          ],
          tryable: false,
          reqExample: 'GET /api/v2/system-mgmt/nodes/1/push-menu/status',
          respExample: J({ status: 'synced', menuVersion: 8, pushedAt: '<iso>', syncedAt: '<iso>', error: '' }),
          notes: ['status: idle | pushing | synced | failed', 'autoSyncMs 窗口见 MENU_PUSH_AUTO_SYNC_MS（默认 5s）'],
        },
    ],
  },
];
