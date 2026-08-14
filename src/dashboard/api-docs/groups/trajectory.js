/**
 * API group(s): trajectory, batch-import — extracted from catalog.js.
 * Keep in sync with src/routes/v2/*.js
 */
import { J } from './_j.js';

/** @type {TagGroup[]} */
export const GROUP_TRAJECTORY = [
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
            desc: '按录制状态筛选；支持单个或逗号分隔多值：draft | recording | failed | recorded | completed。别名 status',
            example: 'draft,recorded',
          },
          { name: 'sortBy', type: 'string', in: 'query', desc: 'created_at | name | step_count | record_status' },
          { name: 'order', type: 'string', in: 'query', desc: 'asc | desc' },
          { name: 'batchTaskName', type: 'string', in: 'query', desc: '按所属批量导入任务名模糊筛选（空=不过滤；LIKE %值%）', example: '批量录制导入模板' },
        ],
        respExample: J({
          rows: [{
            id: 42, name: '开户交易', task: '需求描述',
            recordStatus: 'draft', isExport: 0, stepCount: 0, phaseCount: 3,
            functionId: 3, systemAccountId: 10, model: 'deepseek-v4-flash',
            batchTaskName: '批量录制导入模板_0814-1251',
          }],
          total: 42, page: 1, pageSize: 20,
          stats: { total: 42, draft: 8, recording: 7, failed: 0, recorded: 20, completed: 7 },
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
        desc: 'caseEntries 为交易级 legacy KV（case_data_entry）。录制填表优先【业务数据】；目标系统已校验参考值用 system_ref_entry，勿混用。含 isExport（0|1，见 ENUMS）。phases[].doneLogs 为 `{ text, at, source }[]`（`agent`|`fail`）；trajectoryLog 仍为 agent 全文。',
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
        desc: '含 caseEntries（交易级案例 KV）。默认隐藏内部 meta 步骤（如 save_form_snapshot）；`includeMeta=1` 返回全部。步骤带 `isMeta`。',
        params: [
          { name: 'id', type: 'number', required: true, in: 'path', example: '42' },
          { name: 'includeMeta', type: 'boolean', in: 'query', desc: 'true/1 时包含 save_form_snapshot 等内部步骤', example: 'false' },
        ],
        respExample: J({
          trajectoryId: 42, name: '...', recordStatus: 'draft',
          caseEntries: [{ fieldKey: '姓名', fieldValue: '张三' }],
          phases: [{
            id: 101, phaseNumber: 1, description: '登录系统', status: 'pending',
            stitchScreenshotId: 88,
            stitchScreenshotUrl: '/api/v2/screenshots/88/image',
            steps: [{
              id: 501, stepNumber: 1, actionType: 'click_element_by_index',
              source: 'agent', confirmed: true, isMeta: false,
              params: {}, trajectoryPhaseId: 101,
            }],
          }],
          orphanSteps: [],
        }),
        notes: [
          '默认过滤 META_STEP_ACTIONS（save_form_snapshot / scan_* / task_* 等）',
          'stepCount 亦只计业务步骤；meta 仍入库供 Type B 回放',
          'steps/replay 会在选中业务步区间自动补入 meta 检查点',
          '阶段 `stitchScreenshotUrl` 指向 AI 阶段结束长图（`kind=phase_highlight`）',
        ],
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
        desc: '默认隐藏内部 meta 步骤；`includeMeta=1` 返回全部。每步含 `isMeta`。',
        params: [
          { name: 'id', type: 'number', required: true, in: 'path', desc: 'phaseId', example: '101' },
          { name: 'includeMeta', type: 'boolean', in: 'query', desc: 'true/1 时包含内部步骤', example: 'false' },
        ],
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
    description: 'Excel 批量导入交易。mode=record 时一站式自动录制（analyze → 草稿 → prepare → record/start → detach）；mode=draft 仅 analyze 并保存草稿。模板 / 状态查询 / 取消为辅助。进度可通过 WS batch:* 或轮询获取。',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/trajectories/batch/template',
        summary: '下载批量录制 Excel 模板',
        desc: '返回 .xlsx 二进制（非 JSON 信封）。列：交易名称 / 需求描述。',
        tryable: false,
        notes: [
          'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'filename*=UTF-8\'\'批量录制导入模板.xlsx（ASCII 回退 batch-import-template.xlsx）',
        ],
      },
      {
        method: 'POST', path: '/api/v2/trajectories/batch/import',
        summary: '批量导入 Excel 并自动录制（一站式）',
        desc: 'multipart 上传 .xlsx；mode=record 时对每行自动执行 analyze → 保存草稿 → prepare → record/start → detach；'
          + 'mode=draft 时仅 analyze 并保存草稿（itemStatus=drafted，不占执行机）。'
          + ' 立即返回 HTTP 202；record 模式后台并行录制（全局 FIFO，受执行机槽位限制）。'
          + ' 须带 Idempotency-Key。functionId / systemAccountId 由页面上下文随表单提交。',
        reqExample: 'form-data: file=@batch.xlsx; functionId=3; systemAccountId=10; model=deepseek-v4-flash; mode=draft|record; name=<任务名>\nHeader: Idempotency-Key: <uuid>',
        respExample: J({
          batchId: 'uuid',
          name: '批量录制导入模板_0814-1251',
          status: 'accepted',
          mode: 'draft',
          functionId: 3,
          systemAccountId: 10,
          summary: { total: 5, accepted: 4, rejected: 1, recorded: 0, drafted: 0, failed: 0 },
          items: [{ id: 1, rowNumber: 2, name: '开户交易', status: 'pending' }],
        }),
        notes: [
          'HTTP 202 Accepted；v2 信封 body.code 仍为 200',
          'mode 默认 record；可选 draft（仅 analyze+草稿，跳过 prepare/record/detach）',
          'name 可选，缺省按 文件名_MMDD-HHmm 生成；创建后不可改',
          'mode=draft 不要求 USE_EXECUTOR；mode=record 且 USE_EXECUTOR=false → 503',
          'mode 非法（非 record|draft）→ 400',
          'requestHash / 幂等校验包含 mode（同 Key 不同 mode → 409）',
          '仅 .xlsx；无效行记 rejected，有效行继续；无有效行则 400',
          '同 Idempotency-Key + 同内容 → 返回原任务当前状态；内容不一致 → 409',
          'WS: batch:progress / batch:done（payload 含 mode）',
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
        respExample: J({
          batchId: 'uuid',
          name: '批量录制导入模板_0814-1251',
          status: 'running',
          mode: 'record',
          jobStatus: 'running',
          summary: { total: 5, recorded: 1, drafted: 0, failed: 0, rejected: 0 },
          items: [{
            id: 1,
            rowNumber: 2,
            name: '开户交易',
            status: 'recording',
            trajectoryId: 42,
            progressPercent: 53,
            phaseCompleted: 1,
            phaseTotal: 4,
            phaseName: '查询客户',
            lastDoneText: '进了列表',
          }],
          page: 1,
          pageSize: 50,
          total: 5,
        }),
        notes: [
          '非终态 HTTP 202；终态 HTTP 200',
          'itemStatus: pending|analyzing|analyzed|queued|waiting_executor|preparing|recording|recorded|drafted|failed|rejected|cancelled',
          '响应含 mode（record|draft）；summary 含 drafted 计数',
          'jobStatus: accepted|running|waiting_executor|cancelling|cancelled|completed|completed_with_errors|failed',
          'items[] 含计算字段 progressPercent / phaseCompleted / phaseTotal / phaseName / lastDoneText（不落 batch_item 表）',
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
            mode: 'draft',
            itemId: 1,
            row: 2,
            trajectoryId: 42,
            itemStatus: 'drafted',
            jobStatus: 'running',
            version: 3,
            summary: { total: 5, recorded: 0, drafted: 1, failed: 0 },
            progressPercent: 53,
            phaseCompleted: 1,
            phaseTotal: 4,
            phaseName: '查询客户',
            lastDoneText: '进了列表',
          },
        }),
        notes: [
          'payload 含 mode（record|draft）',
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
            mode: 'record',
            jobStatus: 'completed_with_errors',
            summary: { total: 5, recorded: 4, drafted: 0, failed: 1, rejected: 0 },
          },
        }),
        notes: ['payload 含 mode（record|draft）', '连接通道仍为 ws://<host>/ws'],
      },
    ],
  },
];
