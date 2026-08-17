/**
 * API group(s): export-mgmt (V1 legacy-engine) + batch-push (V2 partner transaction).
 * Keep in sync with src/routes/v2/export-mgmt.js
 */
import { J } from './_j.js';

/** @type {TagGroup[]} */
export const GROUP_EXPORT = [
  {
    id: 'export-mgmt',
    name: '导出管理',
    description: 'V1 传统执行引擎 5 字段导出（legacy-engine）。产品对接请用「批量推送管理」。',
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
          'target 优先 xpath_smart；无相对 xpath 时回退 xpath_full，不丢弃步骤',
          'wait_for_loading / go_to_url 等非落库 UI 步骤跳过',
        ],
      },
      {
        method: 'GET', path: '/api/v2/export/trajectories/{id}/legacy-engine',
        summary: '导出轨迹步骤（传统引擎）',
        desc: '将 trajectory_step 映射为 operations[]。',
        params: [
          { name: 'id', type: 'number', required: true, in: 'path', desc: '轨迹 id', example: '53' },
          { name: 'stepIds', type: 'string', in: 'query', desc: '逗号分隔步骤 id' },
          { name: 'phaseIds', type: 'string', in: 'query', desc: '逗号分隔阶段 id' },
          { name: 'includeMeta', type: 'boolean', in: 'query', desc: 'false 时只返回 5 字段', example: 'true' },
        ],
      },
      {
        method: 'POST', path: '/api/v2/export/trajectories/{id}/legacy-engine',
        summary: '导出轨迹步骤（body 过滤）',
        desc: '与 GET 相同；长 stepIds 列表用 body。',
        reqExample: J({ stepIds: [2343, 2344], includeMeta: false }),
      },
      {
        method: 'POST', path: '/api/v2/export/legacy-engine/preview',
        summary: '预览映射（不读库）',
        desc: '传入 steps[]，返回 operations。',
        reqExample: J({
          steps: [{
            actionType: 'fill_form_field',
            params: { label_text: '搜索关键字', value: '贷款' },
            element: { xpath_smart: "//input[contains(@placeholder,'搜索关键字')]" },
          }],
          includeMeta: false,
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
            element: { xpath_smart: "//li[normalize-space()='产品管理']" },
          },
        }),
      },
    ],
  },
  {
    id: 'batch-push',
    name: '批量推送管理',
    description: '产品「批量推送」：勾选交易 → 选对方项目/系统 → 本仓组装 envelope 并代调 importDemand。请求头 access_token（Vue localStorage.token）。成功后 trajectory.is_export=1。',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/export/partner/projects',
        summary: '对方项目列表（代理）',
        desc: '转发对方 POST /api/system/systemproject/list，返回精简 { id, name }[]。需 access_token。',
        params: [
          { name: 'access_token', type: 'string', required: true, in: 'query', desc: '通常放请求头 access_token（与 Vue 拦截器一致）' },
        ],
        respExample: J({
          projects: [{ id: 31, name: '示例项目' }],
          count: 1,
        }),
        notes: ['缺 token → 400；对方网关/不可达 → 502「网络异常，自动化平台无法连接」'],
      },
      {
        method: 'GET', path: '/api/v2/export/partner/systems',
        summary: '对方系统树（按项目，代理）',
        desc: '转发对方 lazySystemTree；项目变更后前端应清空已选系统再调本接口。',
        params: [
          { name: 'projectId', type: 'string', required: true, in: 'query', desc: '对方项目 id', example: '31' },
          { name: 'parentId', type: 'string', in: 'query', desc: '可选，懒加载子节点' },
        ],
        respExample: J({
          projectId: '31',
          systems: [{ id: 98, name: '李淼一测试系统' }],
          count: 1,
        }),
      },
      {
        method: 'GET', path: '/api/v2/export/transaction/schema',
        summary: 'Partner transaction 字段契约',
        desc: '返回导入体字段说明（外层 transcationEventTypeList；轨内 transcationProperties 等）。',
        respExample: J({
          schemaVersion: 2,
          fields: [
            { key: 'transcationEventTypeList', zh: '交易列表（单轨也包一层数组）' },
            { key: 'transcationProperties', zh: '事件步骤数组' },
            { key: 'testFrame', zh: '框架（默认 playwright）' },
            { key: 'regionId', zh: '步骤所属区域节点 id' },
            { key: 'parentRegionId', zh: '父区域节点 id' },
            { key: 'phases', zh: '阶段数组（截图引用 + 元数据）' },
          ],
        }),
      },
      {
        method: 'GET', path: '/api/v2/export/trajectories/{id}/transaction',
        summary: '导出/可选推送单轨',
        desc: '默认只组装并 markExported；push=true 时代调 importDemand（成功才 mark）。仅 recordStatus=completed（已确认）可推送；draft/recording/failed → 409 not_pushable_status。raw/forImport 返回裸 envelope。systemId/projectId 缺省 98/31。',
        params: [
          { name: 'id', type: 'number', required: true, in: 'path', desc: '轨迹 id', example: '36' },
          { name: 'systemId', type: 'string', in: 'query', desc: '缺省 98', example: '98' },
          { name: 'projectId', type: 'string', in: 'query', desc: '缺省 31', example: '31' },
          { name: 'push', type: 'boolean', in: 'query', desc: 'true 时代推 importDemand（需已确认 completed）', example: 'false' },
          { name: 'raw', type: 'boolean', in: 'query', desc: '仅返回 envelope', example: 'true' },
        ],
      },
      {
        method: 'POST', path: '/api/v2/export/trajectories/{id}/transaction',
        summary: '导出/可选推送单轨（body）',
        desc: '与 GET 相同；参数可写 body。push=true 时非已确认（draft/recording/failed）→ 409。',
        reqExample: J({ systemId: '98', projectId: '31', push: true }),
      },
      {
        method: 'POST', path: '/api/v2/export/transactions',
        summary: '批量推送（组装 + 代调 importDemand）',
        desc: '产品确认推送入口。逐条组装后合并为一条 importDemand body；对方成功后才 markExported。真实推送时跳过 draft/recording/failed（item.code=not_pushable_status）；raw/dryRun 只组装不代推、不按状态拦截。缺 systemId/projectId 时默认 98/31。',
        params: [
          { name: 'trajectoryIds', type: 'number[]', required: true, in: 'body', desc: '勾选的轨迹 id', example: '[36]' },
          { name: 'systemId', type: 'string', in: 'body', desc: '对方系统 id（弹窗选择；缺省 98）', example: '98' },
          { name: 'projectId', type: 'string', in: 'body', desc: '对方项目 id（弹窗选择；缺省 31）', example: '31' },
          { name: 'access_token', type: 'string', in: 'body', desc: '可选；优先请求头 access_token' },
          { name: 'dryRun', type: 'boolean', in: 'body', desc: 'true 时不代推' },
          { name: 'raw', type: 'boolean', in: 'body', desc: 'true 时仅返回合并 envelope' },
        ],
        reqExample: J({ trajectoryIds: [36], systemId: '98', projectId: '31' }),
        respExample: J({
          schemaVersion: 2,
          systemId: '98',
          projectId: '31',
          pushed: true,
          partner: { code: 200, msg: '同步成功，共同步{}条数据', data: 1 },
          items: [{ trajectoryId: 36, ok: true, isExport: 1, count: 12 }],
          summary: { ok: 1, failed: 0 },
        }),
        notes: [
          '前端：先 GET partner/projects，再按项目 GET partner/systems；项目变更清空系统',
          '无 access_token（头/body/env）→ 400',
          '对方业务失败 → 502，不翻转 isExport',
          '仅 completed（已确认）可推送；draft/recording/failed 等 → item 失败 code=not_pushable_status（单轨 push → 409）',
          '每交易含 phases[]：阶段截图引用 + metadata（imageWidth/imageHeight/elements/regionTree）；前端经 stitchScreenshotUrl 拉图后按坐标动态高亮',
        ],
      },
      {
        method: 'GET', path: '/api/v2/export/trajectories/{id}/transaction-v3',
        summary: '导出/可选推送单轨（V3.0 控件点亮）',
        desc: 'V3.0：entry 新增 result.groups（对齐消费方约定）——页面组（一张长图=一个页面组，page-<n> 平级）+ 弹窗组（overlay 归属，附触发按钮 anchor）+ 控件节点（rect=element_json.bbox 内容坐标、target/kind/params）；transcationProperties 保留。前端拿长图 + rect 即可任意勾选点亮。参数同 V2.0。',
        params: [
          { name: 'id', type: 'number', required: true, in: 'path', desc: '轨迹 id', example: '38' },
          { name: 'systemId', type: 'string', in: 'query', desc: '缺省 98', example: '98' },
          { name: 'projectId', type: 'string', in: 'query', desc: '缺省 31', example: '31' },
          { name: 'push', type: 'boolean', in: 'query', desc: 'true 时代推 importDemand（需已确认 completed）', example: 'false' },
          { name: 'raw', type: 'boolean', in: 'query', desc: '仅返回 envelope', example: 'true' },
        ],
      },
      {
        method: 'POST', path: '/api/v2/export/trajectories/{id}/transaction-v3',
        summary: '导出/可选推送单轨（V3.0，body）',
        desc: '与 GET transaction-v3 相同；参数可写 body。',
        reqExample: J({ systemId: '98', projectId: '31', push: true }),
      },
      {
        method: 'POST', path: '/api/v2/export/transactions-v3',
        summary: '批量推送（V3.0 控件点亮）',
        desc: '同 V2.0 批量语义（组装/代推/dryRun/raw），entry 使用 V3.0 result.groups 结构。',
        params: [
          { name: 'trajectoryIds', type: 'number[]', required: true, in: 'body', desc: '勾选的轨迹 id', example: '[38]' },
          { name: 'systemId', type: 'string', in: 'body', desc: '对方系统 id（缺省 98）', example: '98' },
          { name: 'projectId', type: 'string', in: 'body', desc: '对方项目 id（缺省 31）', example: '31' },
          { name: 'dryRun', type: 'boolean', in: 'body', desc: 'true 时不代推' },
          { name: 'raw', type: 'boolean', in: 'body', desc: 'true 时仅返回合并 envelope' },
        ],
        reqExample: J({ trajectoryIds: [38], systemId: '98', projectId: '31' }),
        notes: [
          'result.groups 结构：page 组（screenshots[] = {phaseNumber, url}，无尺寸字段，前端按图片自然尺寸计算）、dialog 组（key 带 @@anchor=<触发按钮xpath>）、ele 控件（id=step-<n> 全局唯一、rect=内容坐标与长图同根）',
          '控件 rect 缺失（旧数据无 bbox）时省略该字段，统计在 stats.noRectControls',
          '弹窗第一版无独立截图（screenshots 空），弹窗控件 rect 相对所在阶段长图；未来弹窗独立截图后填充',
          'TODO：同阶段多页面按 URL 区分（当前一张长图=一个页面组）',
        ],
      },
    ],
  },
];
