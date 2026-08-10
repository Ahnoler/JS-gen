/**
 * API group(s): export-mgmt (V1 legacy-engine) + batch-export (V2 partner transaction).
 * Keep in sync with src/routes/v2/export-mgmt.js
 */
import { J } from './_j.js';

/** @type {TagGroup[]} */
export const GROUP_EXPORT = [
  {
    id: 'export-mgmt',
    name: '导出管理',
    description: 'V1 传统执行引擎 5 字段导出（legacy-engine）。产品对接请用「批量导出管理」。',
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
  {
    id: 'batch-export',
    name: '批量导出管理',
    description: 'Partner transaction 导出（单轨 / 批量）。信封字段拼写（transcation*、mothed）为对接约定。成功导出后 trajectory.is_export=1；phase/step 变更置 0。',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/export/transaction/schema',
        summary: 'Partner transaction 字段契约',
        desc: '返回 envelope 字段说明（transcId / transcationName / transcationEventType 等）、eventTypeName 中文映射与 action→type 映射。拼写（transcation*、mothed）为对接约定，勿改。',
        respExample: J({
          schemaVersion: 1,
          fields: [
            { key: 'transcId', zh: '录制/交易 id' },
            { key: 'transcationName', zh: '交易名称' },
            { key: 'systemId', zh: '系统树 id' },
            { key: 'projectId', zh: '项目 id' },
            { key: 'transcationType', zh: '类型（默认 web）' },
            { key: 'testFrame', zh: '框架（默认 selenium）' },
            { key: 'transcationEventType', zh: '事件数组' },
          ],
          eventTypeName: {
            click: '点击',
            input: '文本框输入',
            'select:click': '下拉框点击选择',
          },
          actionTypeMap: { click_element_by_index: 'click', fill_form_field: 'input' },
          notes: ['Partner envelope spellings (transcation*, mothed) are intentional'],
        }),
        notes: [
          '与 legacy-engine/schema 共用 actionTypeMap；事件字段见 transaction-export 服务',
          'partial export（stepIds/phaseIds）尚未实现',
        ],
      },
      {
        method: 'GET', path: '/api/v2/export/trajectories/{id}/transaction',
        summary: '导出轨迹（partner transaction）',
        desc: '全量导出 trajectory_step 为 partner envelope；成功后将 trajectory.is_export 置 1。download=1 时响应体仅为 payload（仍置 is_export）。',
        params: [
          { name: 'id', type: 'number', required: true, in: 'path', desc: '轨迹 id', example: '53' },
          { name: 'systemId', type: 'string', required: true, in: 'query', desc: '系统树 id', example: '100' },
          { name: 'projectId', type: 'string', required: true, in: 'query', desc: '项目 id', example: '200' },
          { name: 'download', type: 'boolean', in: 'query', desc: 'true 时仅返回 payload JSON 附件', example: 'false' },
        ],
        respExample: J({
          trajectoryId: 53,
          isExport: 1,
          schemaVersion: 1,
          count: 1,
          skipped: { metaActions: 0 },
          stats: { absoluteFallback: 0, missingOptions: 0 },
          payload: {
            transcId: '53',
            transcationName: '产品库查询',
            systemId: '100',
            projectId: '200',
            transcationType: 'web',
            testFrame: 'selenium',
            transcationEventType: [{
              options: '',
              elementType: "//li[contains(concat(' ', normalize-space(@class), ' '), ' menu-item ')][normalize-space()='产品管理']",
              eventTypeName: '点击',
              eventTypeValue: 'click',
              transcationType: 'selenium',
              objectValue: '',
              propertiesName: '点击:产品管理',
              mothed: 'By.XPATH',
            }],
          },
        }),
        notes: [
          '缺 systemId / projectId → 400；轨迹不存在 → 404',
          '空轨迹 count:0 仍置 isExport=1（导出当前内容成功）',
        ],
      },
      {
        method: 'POST', path: '/api/v2/export/trajectories/{id}/transaction',
        summary: '导出轨迹（body 传 systemId/projectId）',
        desc: '与 GET 相同；systemId/projectId/download 可写在 body 或 query（body 优先）。',
        params: [
          { name: 'id', type: 'number', required: true, in: 'path', desc: '轨迹 id' },
          { name: 'systemId', type: 'string', required: true, in: 'body', desc: '系统树 id' },
          { name: 'projectId', type: 'string', required: true, in: 'body', desc: '项目 id' },
          { name: 'download', type: 'boolean', in: 'body', desc: 'true 时仅返回 payload' },
        ],
        reqExample: J({ systemId: '100', projectId: '200' }),
      },
      {
        method: 'POST', path: '/api/v2/export/transactions',
        summary: '批量导出 partner transaction',
        desc: '逐条独立 ok/fail；成功项 markExported 并返回 payload；失败项不翻转 isExport。',
        params: [
          { name: 'trajectoryIds', type: 'number[]', required: true, in: 'body', desc: '轨迹 id 列表（亦支持逗号分隔字符串，parseIdList）', example: '[53,54]' },
          { name: 'systemId', type: 'string', required: true, in: 'body', desc: '系统树 id' },
          { name: 'projectId', type: 'string', required: true, in: 'body', desc: '项目 id' },
        ],
        reqExample: J({ trajectoryIds: [53, 54], systemId: '100', projectId: '200' }),
        respExample: J({
          schemaVersion: 1,
          systemId: '100',
          projectId: '200',
          items: [
            {
              trajectoryId: 53,
              ok: true,
              isExport: 1,
              count: 1,
              skipped: { metaActions: 0 },
              stats: { absoluteFallback: 0, missingOptions: 0 },
              payload: {
                transcId: '53',
                transcationName: '产品库查询',
                systemId: '100',
                projectId: '200',
                transcationType: 'web',
                testFrame: 'selenium',
                transcationEventType: [{
                  options: '',
                  elementType: "//li[normalize-space()='产品管理']",
                  eventTypeName: '点击',
                  eventTypeValue: 'click',
                  transcationType: 'selenium',
                  objectValue: '',
                  propertiesName: '点击:产品管理',
                  mothed: 'By.XPATH',
                }],
              },
            },
            { trajectoryId: 999, ok: false, error: 'Trajectory not found' },
          ],
          summary: { ok: 1, failed: 1 },
        }),
      },
    ],
  },
];
