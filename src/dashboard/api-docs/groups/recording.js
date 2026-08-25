/**
 * API group(s): recording, replay, executor — extracted from catalog.js.
 * Keep in sync with src/routes/v2/*.js
 */
import { J } from './_j.js';

/** @type {TagGroup[]} */
export const GROUP_RECORDING = [
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
          accounts: [{ id: 10, name: '测试员', loginUrl: '...', account: 'u', password: 'p' }],
        }),
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/record/prepare',
        summary: '一键准备（占槽 + 登录 + 推流）',
        desc: '幂等。① 复用本交易已存活 session（含「断开画面」后空闲浏览器）；② 否则优先复用执行机上空闲孤儿 CDP Chrome；③ 再新建浏览器。无空闲槽位则 409。登录为硬编码 go_to_url + login（不启动 Agent），不写入 trajectory_step。prepare 仅打开浏览器/推流，不等于录制：不再把 record_status 改为 recording，保持当前持久状态（未录制/待确认/已确认/录制异常）。通过 WS 广播 recording:prepare。推流身份以 remote_session.id 为准，按 trajectory 隔离。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({}),
        respExample: J({
          trajectoryId: 42, sessionId: 'uuid', executorNodeUuid: 'node-uuid',
          remoteSessionId: 7, ready: true, attached: true, reused: false, reusedChrome: true,
          recordStatus: 'completed',
          login: { skipped: false, done: true, accountId: 10 },
          stream: { ok: true, remoteSessionId: 7 },
          stages: {
            session: { status: 'done' }, browser: { status: 'done' },
            stream: { status: 'done' }, login: { status: 'done' },
          },
        }),
        notes: [
          '409：无可用执行资源（含 holders）— 槽位已满或没有在线执行机',
          '409 `grace_owned`：宽限期内他交易 idle Chrome 仍归属原 traj — body 含 `code`、`ownerTrajectoryId`、`graceUntil`（见 attach / attach-live）',
          '503：会话/执行机其它不可用',
          '不杀孤儿 Chrome：检测到空闲 CDP 则 --cdp-url 复用',
          '状态模型（V3）：draft/recording/failed/recorded/completed，其中 recording 是临时态，持久态为 draft/failed/recorded/completed；非终结性释放（关浏览器/断开/回收/重启）恢复到持久基线，不降级。',
          'prepare（启动浏览器/占用执行资源成功）→ recording（临时态）；record/start(draft|failed|recorded|completed) → recording（临时态）；stop(success) → recorded（待确认）；stop(!success)/失败 → failed（录制异常）；detach/stream-detach/回收/清理 → 恢复到录制前持久状态基线（不降级为未录制）。',
        ],
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/record/start',
        summary: '开始 AI 录制',
        desc: '同步阻塞至录制完成。phaseIds 省略则录全部阶段。填表靠 phase 内【业务数据】（用户需求希望使用的值）+ LLM 理解对齐（autofill 可随机补其余字段）。',
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
        desc: '结束录制（不 detach）。状态流转 V3：success → recordStatus=recorded(待确认)；success=false → recordStatus=failed(录制异常)。会向执行机会话发送 cancel_step，当前 Agent 立即停止后续步骤（当前正在执行的一步结束后不再继续）。响应含 detached:false。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({ success: true }),
        respExample: J({
          trajectoryId: 42, recordStatus: 'recorded', detached: false,
          tree: { phases: [], orphanSteps: [] },
        }),
        notes: ['不释放执行机槽位；释放请 detach', 'busy 时也会发送 cancel_step；Agent 收到后置 stopped，不再开下一步', '已确认(completed) 交易再次录制 stop(success) → 待确认(recorded)，需再次人工确认回已确认'],
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/confirm',
        summary: '人工确认 / 取消确认（交易级）',
        desc: 'confirmed=true → recordStatus=completed；false → recorded。不修改 trajectory_step.confirmed。recording/failed 时 409。',
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
        desc: '需 record/prepare 且 BiB 已附着。默认 `mode: inventory`（全页可操作控件池，可选 label/action 过滤）；`mode: needle` 为旧版按 label 针搜。无 labelText 且命中 ≥1 时 inventory 始终返回 ambiguous 列表供 UI 选择；0 命中 → 404。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({
          mode: 'inventory',
          pageLabel: '客户管理',
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
          '默认 mode=inventory：全页可操作控件池；可选 labelText / actionType+params 过滤',
          '可选 pageLabel / page_label：当 layers[0] 尚未为 page 时，在 layers 头插 { role:\'page\', label }；无 schema',
          '无 labelText 且命中 ≥1：inventory 始终 { ambiguous:true, matches }；0 命中 → 404',
          'mode=needle：旧版按 label 针搜；无 label/action 时 400',
          '可选 actionType + params（menu_text / tab_name / row_text+button_text / …）做动作感知解析',
          '多可见匹配：HTTP 200 { ambiguous:true, matches:[{ matchedLabel, element, preview }], truncated? } — 不静默择一；`preview.layers` 为 `{ role, label }[]`（外→内），缺省时回退 `display_group`，不要拆 `region_id`',
          '分区在后端完成：SPA 按 `preview.display_group` 原样分组展示（空则回退 `region_label`）；`display_group` 可以是 tab / collapse / titlebox 用 ` / ` 连接的中文路径，SPA 仍原样展示、不要拆 `region_id`；禁止用 `region_role` 或从 xpath 再推导分区；待办 `region_label` 为中文标题，业务主键在 `region_id`，同标题撞车时 display_group 带主键后缀',
          'truncated:true 表示命中 INVENTORY_CAP（120）上限，列表可能被截断',
          '菜单示例：客户管理优先稳定 data-id；否则 class-token + 文案 + occurrence',
          '表单字段：xpath / xpath_smart 为 label 锚定相对 xpath（无 label 时用 placeholder）；xpath_full 绝对兜底',
          'POST/PATCH trajectory-steps：单目标动作无可用 xpath 时 400 locator-capture-error',
          'PATCH 仅在 actionType/params/element 变更时重校验定位器',
          '400：未 attach / BiB 未就绪（inventory 无 label 不 400）；404：无匹配',
        ],
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/manual-record',
        summary: '开关人工录制',
        desc: 'AI 录制活跃时开启会 409。recording（纯推流占用，非 AI 录制）下可开人工录制。phaseId 省略则追加到最后阶段。',
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
        notes: [
          '409 `grace_owned`：宽限期内他交易认领 idle remote_session → `{ error, code: "grace_owned", ownerTrajectoryId, graceUntil }`',
        ],
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/stream/detach',
        summary: '断开画面（只停推流）',
        desc: 'remote_session → idle 并设 `grace_until`（默认 15min，env `REMOTE_SESSION_GRACE_MS`）；清 `trajectory.remote_session_id` 缓存但 grace 内保留 `remote_session.trajectory_id`；若 recordStatus=recording 则恢复到录制前持久状态基线（已确认/待确认/录制异常保持，首次未录制→未录制，不降级）。Agent 会话与 Chrome 仍存活；宽限内原 traj 可再附着，他交易认领同 Chrome → 409 `grace_owned`。与 detach（释放执行资源）不同。广播 recording:stream_detached + remote:status。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({}),
        respExample: J({
          trajectoryId: 42, streamDetached: true, sessionKept: true,
          recordStatus: 'completed', remoteSessionId: 7,
        }),
        notes: ['幂等；不影响其他交易的推流', '再附着：prepare 或 attach-live + remote:subscribe({trajectoryId})'],
      },
      {
        method: 'POST', path: '/api/v2/trajectories/{id}/detach',
        summary: '释放执行资源（关闭浏览器）',
        desc: '关闭 Agent 会话并杀死 Chrome，释放执行机槽位。若当前 recordStatus 为 recording（含浏览器占用中或 AI 录制中）：按 V3 属于非终结性释放，恢复到录制前持久状态基线，不降级 recorded/completed/failed 为未录制，也不自动标记为录制异常。与「断开画面」（只停推流）不同。离开录制工作室不会自动调用；无步骤写入超过 2 小时会由服务端自动回收。仅释放本交易资源，不串扰其他交易。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '42' }],
        reqExample: J({}),
        respExample: J({ trajectoryId: 42, detached: true, recordStatus: 'completed' }),
      },
      {
        method: 'GET', path: '/api/v2/recording/agent-stderr/active',
        summary: '活动 Agent stderr 目录',
        desc: '列出 remote_session 占用中的会话（active/idle），交叉 lease 与 trajectory 元数据；并对在线执行机查询 `session.list`，附上各槽 CDP 端口。复制 rows[] 中一行，粘贴到 POST /recording/agent-stderr 即可导出该 slot 日志。',
        respExample: J({
          rows: [{
            slotIndex: 0,
            sid: '72d5d9b4',
            sessionId: '72d5d9b4-9fad-4d96-956f-af44e9f7b4ee',
            trajectoryId: 33,
            trajectoryName: '1对公客户转正',
            recordStatus: 'recording',
            remoteSessionId: 632,
            remoteStatus: 'active',
            executorNodeId: 2,
            executorNodeUuid: '2f21bad1-aad6-4cb6-a9a5-2471627205d1',
            cdpPort: 19242,
            hasStderrLog: true,
          }],
          slotPorts: [{
            executorNodeUuid: '2f21bad1-aad6-4cb6-a9a5-2471627205d1',
            slots: [
              { slotIndex: 0, sessionId: '72d5d9b4-9fad-4d96-956f-af44e9f7b4ee', cdpPort: 19242, ready: true, busy: false },
              { slotIndex: 1, sessionId: null, cdpPort: 19243, ready: false, busy: false },
            ],
          }],
        }),
        notes: [
          '工程辅助接口；多 slot 并行录制时用于定位 stderr 来源',
          'hasStderrLog 表示控面已收到 WS 落盘文件',
          'cdpPort / slotPorts：在线执行机实时值；离线或查询失败时可能为 null / 缺节点',
          '空闲槽仍可能有 cdpPort（执行机默认 base+slotIndex，尚未占用）',
        ],
      },
      {
        method: 'POST', path: '/api/v2/recording/agent-stderr',
        summary: '粘贴 /active 行导出 Agent stderr（推荐）',
        desc: '请求体直接粘贴 `GET .../agent-stderr/active` 返回的 rows[] 中一行（多余字段忽略）。优先用 `sessionId` 打开落盘文件，再用 `slotIndex`/`sid` 滤行。默认 `format=text` → `text/plain`；可在 body 加 `"format":"json"`。',
        reqExample: J({
          slotIndex: 0,
          sid: '72d5d9b4',
          sessionId: '72d5d9b4-9fad-4d96-956f-af44e9f7b4ee',
          trajectoryId: 33,
          trajectoryName: '1对公客户转正',
          recordStatus: 'recording',
          remoteSessionId: 632,
          remoteStatus: 'active',
          executorNodeId: 2,
          executorNodeUuid: '2f21bad1-aad6-4cb6-a9a5-2471627205d1',
          hasStderrLog: true,
        }),
        respExample: 'Agent step 3 done\n',
        notes: [
          '识别字段：slotIndex|slot、sid、sessionId、trajectoryId（至少其一）',
          'format=text → text/plain（非信封）；format=json → 信封 { lines, count, filter }',
          '导出时剥掉落盘前缀 `[slot:N sid:…]`，正文即为 Agent stderr',
          '无匹配 → 200 空正文',
        ],
      },
      {
        method: 'POST', path: '/api/v2/recording/agent-stderr/clear',
        summary: '清空单会话 Agent stderr 落盘文件',
        desc: '删除控面 `logs/agent-stderr/{sessionId}.log`。范围仅该 session 文件，不影响其他会话/槽位。Body 同 /active 行（优先 sessionId；也可用 trajectoryId/sid 解析当前占用会话）。',
        reqExample: J({
          sessionId: '72d5d9b4-9fad-4d96-956f-af44e9f7b4ee',
          slotIndex: 0,
          sid: '72d5d9b4',
          trajectoryId: 33,
        }),
        respExample: J({
          cleared: true,
          sessionId: '72d5d9b4-9fad-4d96-956f-af44e9f7b4ee',
          path: 'D:/dev/JS-gen/logs/agent-stderr/72d5d9b4-9fad-4d96-956f-af44e9f7b4ee.log',
        }),
        notes: [
          'cleared=false：文件本就不存在（仍 200）',
          '404：无法从 trajectoryId/sid 解析到 sessionId',
          '执行机监视面板「清空日志」调用本接口',
        ],
      },
      {
        method: 'GET', path: '/api/v2/recording/agent-stderr',
        summary: '按 query 导出 Agent stderr',
        desc: 'query 过滤（对齐 logAnalysis）。日常调试优先 POST 粘贴 /active 行。至少提供一个过滤条件；多条件 AND。',
        params: [
          { name: 'slot', type: 'number', in: 'query', example: '0', desc: '滤 `[slot:N` 前缀' },
          { name: 'sid', type: 'string', in: 'query', example: '72d5d9b4', desc: 'sessionId 前 8 位（小写）' },
          { name: 'sessionId', type: 'string', in: 'query', example: '72d5d9b4-9fad-4d96-956f-af44e9f7b4ee' },
          { name: 'trajectoryId', type: 'number', in: 'query', example: '33' },
          { name: 'format', type: 'string', in: 'query', example: 'text', desc: 'text（默认）或 json' },
        ],
        respExample: 'Agent step 3 done\n',
        notes: [
          '400：未提供 slot / sid / sessionId / trajectoryId 任一',
          'format=text → text/plain（非信封）',
          '导出剥掉 `[slot:N sid:…]` 前缀',
        ],
      },
      {
        method: 'GET', path: '/api/v2/trajectories/{id}/agent-stderr',
        summary: '单交易 Agent stderr 快捷导出',
        desc: '等价于 query `trajectoryId={id}`。推荐改用 POST /recording/agent-stderr 粘贴 /active 整行（含 sessionId，断开占用后仍可查）。',
        params: [
          { name: 'id', type: 'number', required: true, in: 'path', example: '33' },
          { name: 'slot', type: 'number', in: 'query', example: '0' },
          { name: 'sid', type: 'string', in: 'query', example: '72d5d9b4' },
          { name: 'format', type: 'string', in: 'query', example: 'text', desc: 'text（默认）或 json' },
        ],
        respExample: 'phase_start\n',
        notes: [
          'format=text → text/plain（非信封）',
          '导出剥掉 `[slot:N sid:…]` 前缀',
          'trajectory 无占用且无 sessionId → 可能 200 空；优先 POST 粘贴行',
        ],
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
];
