/**
 * API group(s): websocket — extracted from catalog.js.
 * Keep in sync with src/routes/v2/*.js
 */
import { J } from './_j.js';

/** @type {TagGroup[]} */
export const GROUP_WEBSOCKET = [
  {
    id: 'websocket',
    name: 'WebSocket',
    description: '产品前端连接 ws://<host>/ws；消息格式 { type, payload }',
    endpoints: [
      {
        method: 'WS', path: '/ws',
        summary: '产品前端通道',
        desc: '连接后可收 recording:*、remote:*（含标签页列表）、二进制投屏帧，以及 live replay 的 replay:form_structure 等。客户端可发 ws:ping、remote:tabs、remote:switch_tab 等。',
        tryable: false,
        respExample: J({ type: 'server:init', payload: { /* 会话快照 */ } }),
        notes: [
          '客户端 → { type: "ws:ping", payload: {} } → 收到 ws:pong',
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
          'kind: mouse | key | text | navigate | clipboard',
          'mouse：{ type: mousePressed|mouseReleased|mouseMoved|mouseWheel, x, y }（x/y 为 0~1 归一化）',
          'key：{ type: keyDown|keyUp, key, code, keyCode, modifiers } — Backspace / Enter / 方向键等控制键',
          'text：{ text, replace?: boolean } — CDP Input.insertText；replace:true 时先选中 activeElement 再写入（空 text 则清空）',
          'navigate：{ action: back|forward|reload }',
          'clipboard：{ action: getSelection, requestId } — 取远端选区；结果见 remote:clipboard',
          'Ctrl/Cmd+C/V 由 SPA 拦截：V→kind:text；C→kind:clipboard（勿再 kind:key 透传）',
          'IME 约定：SPA 在画布上盖透明本机 input；composition 期间不发 key/text；compositionend / 已确认增量发 kind:text；控制键仍走 kind:key',
          '打字前先 mouse 点中远程输入框，保证 remote activeElement 正确',
          'agentBusy / inputEnabled=false 时控制面拒绝写入（hover 检查可例外）',
          '路由字段：trajectoryId / sessionId / remoteSessionId 与其它 remote:* 一致',
        ],
      },
      {
        method: 'WS', path: 'remote:clipboard',
        summary: 'BiB 远端选区文本（供本机 Ctrl+C）',
        tryable: false,
        respExample: J({
          type: 'remote:clipboard',
          payload: { requestId: 'uuid', ok: true, text: 'selected', sessionId: 'uuid' },
        }),
        notes: [
          '响应 remote:input kind:clipboard action:getSelection',
          '执行机 session.bib_clipboard → 控制面广播 remote:clipboard',
          '空选区 ok:true text:"" — 前端不得 writeText 空串覆盖本机剪贴板',
        ],
      },
      {
        method: 'WS', path: 'remote:status',
        summary: 'BiB 附着状态变化',
        tryable: false,
        respExample: J({ type: 'remote:status', payload: { attached: true, remoteSessionId: 7 } }),
        notes: [
          '推流为二进制 RSCF JPEG；执行端约 10–12fps 上限（可用 BIB_STREAM_MIN_FORWARD_MS / BIB_STREAM_EVERY_NTH_FRAME 调整）。默认编码跟视口（常见 1600×900 / quality≈65；画布显示默认自适应容器；编码不强制抬到 1080p）',
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
    ],
  },
];
