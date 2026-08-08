/**
 * API group(s): export-mgmt — extracted from catalog.js.
 * Keep in sync with src/routes/v2/*.js
 */
import { J } from './_j.js';

/** @type {TagGroup[]} */
export const GROUP_EXPORT = [
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
