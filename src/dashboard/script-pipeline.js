// Script Generation + Auto Pipeline
// Extracted from test-dashboard.js (generation, refinement, execution, logs)

import { ts } from './utils.js';
import { escapeHtml } from './swagger-api.js';
import { on, send, isConnected } from './ws-client.js';
import { renderActionCards, wireActionButtons } from './trajectory-actions.js';

// ====== Pipeline Logging (scoped to dashboard) ======
export function addPipelineLog(type, msg) {
  const terminal = document.getElementById('pipelineLogTerminal');
  const t = ts();
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.innerHTML = `<span class="ts">${t}</span>${msg.replace(/</g,'&lt;').replace(/>/g,'&gt;')}`;
  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}

// ====== State ======
export const pipelineState = {
  currentTestId: null,
  currentFileName: null,
  currentScript: '',
  lastError: '',       // captured from last run failure
  actionFile: '',       // action JSON path (for self-heal)
  healSessionId: null,     // browser session for self-heal
  healSuccess: false,       // recording completed successfully
  healActionFile: '',       // new action file after heal
  healScript: '',           // assembled script after heal
  healTested: false,        // test passed after heal
};

// ====== Helpers ======
async function loadSessionOutput(sessionId) {
  if (!sessionId) return;
  addPipelineLog('step', 'Loading agent session output...');

  try {
    const res = await fetch(`/api/agent/session/${sessionId}/messages`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load session');

    if (!data || !data.length) {
      addPipelineLog('warn', 'No messages in session');
      return;
    }

    addPipelineLog('info', `--- Agent Session (${data.length} messages) ---`);

    for (const msg of data) {
      const role = msg.role || 'unknown';

      if (role === 'user') {
        const textParts = (msg.parts || []).filter(p => p.type === 'text');
        const text = textParts.map(p => p.text).join(' ').slice(0, 300);
        addPipelineLog('system', `[user] ${text}`);
      } else if (role === 'assistant') {
        const textParts = (msg.parts || []).filter(p => p.type === 'text');
        const text = textParts.map(p => p.text).join('\n').slice(0, 500);
        if (text) addPipelineLog('info', `[assistant] ${text}`);

        const toolParts = (msg.parts || []).filter(p => p.type === 'tool_use' || p.type === 'tool_result');
        for (const tp of toolParts) {
          if (tp.type === 'tool_use') {
            const fn = tp.name || tp.tool || 'unknown';
            const args = typeof tp.input === 'string' ? tp.input : JSON.stringify(tp.input || {});
            addPipelineLog('warn', `[tool] ${fn}(${args.slice(0, 150)})`);
          } else if (tp.type === 'tool_result') {
            const content = typeof tp.content === 'string' ? tp.content : JSON.stringify(tp.content || {});
            addPipelineLog('info', `[result] ${content.slice(0, 200)}`);
          }
        }
      }
    }

    addPipelineLog('success', '--- Session output loaded ---');
  } catch (err) {
    addPipelineLog('error', `Failed to load session output: ${err.message}`);
  }
}

async function runScriptOnce(script, fileName) {
  addPipelineLog('step', 'Executing test...');

  let runResult;
  try {
    const runRes = await fetch(`/api/test/run-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script, fileName }),
    });
    runResult = await runRes.json();
  } catch (err) {
    addPipelineLog('error', `Worker connection failed: ${err.message}`);
    return { success: false, error: err.message };
  }

  if (runResult.success) {
    addPipelineLog('success', 'Test passed!');
    if (runResult.screenshots && runResult.screenshots.length) {
      addPipelineLog('info', `Screenshots: ${runResult.screenshots.length} captured`);
    }
    return { success: true, screenshots: runResult.screenshots };
  }

  const errLog = (runResult.stderr || '') + (runResult.stdout || '').slice(-1000);
  addPipelineLog('error', `Test failed. Exit code: ${runResult.exitCode}`);
  addPipelineLog('info', `Stderr: ${(runResult.stderr || '').slice(0, 500)}`);
  return { success: false, error: errLog.slice(0, 500) };
}

export function displayGeneratedScript(data) {
  pipelineState.currentScript = data.script || '';
  pipelineState.actionFile = data.actionFile || pipelineState.actionFile || '';
  // Steps
  const stepsDiv = document.getElementById('genSteps');
  const stepsList = document.getElementById('genStepsList');
  if (data.steps && data.steps.length) {
    stepsDiv.style.display = 'block';
    stepsList.innerHTML = data.steps.map(s => `<div style="padding:2px 0">${s.step}. ${s.action}</div>`).join('');
  } else {
    stepsDiv.style.display = 'none';
  }

  // Script code with line numbers
  const pre = document.getElementById('genScriptPre');
  const lines = data.script.split('\n');
  pre.innerHTML = lines.map((line, i) => {
    const num = String(i + 1).padStart(3, ' ');
    return `<span style="display:flex"><span style="color:var(--slate-500);user-select:none;width:32px;flex-shrink:0;text-align:right;padding-right:12px">${num}</span><span>${escapeHtml(line) || ' '}</span></span>`;
  }).join('');
  document.getElementById('genScriptArea').style.display = 'block';
  const info = document.getElementById('genInfo');
  info.style.display = 'block';
  info.innerHTML = `测试ID: ${data.testId} | 文件: ${data.fileName} | Session: ${data.sessionId || 'N/A'}`;

  // Show Run area
  document.getElementById('genRunArea').style.display = 'block';
  // Keep heal area visible if preview is showing
  const healPreview = document.getElementById('genHealPreview');
  if (!healPreview || healPreview.style.display === 'none') {
    document.getElementById('genHealArea').style.display = 'none';
  }
  document.getElementById('genHealBtn').disabled = true;
  document.getElementById('genHealStatus').textContent = '';
  checkWorkerHealth();
}

// ====== Health Check ======
const WORKER_URL = '';

export async function checkWorkerHealth() {
  const dot = document.getElementById('genRunDot');
  const status = document.getElementById('genRunStatus');
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (data.status === 'ok') {
      dot.style.background = 'var(--emerald-400)';
      status.textContent = '服务已就绪';
      document.getElementById('genRunBtn').disabled = false;
    } else {
      dot.style.background = 'var(--red-400)';
      status.textContent = '服务异常';
    }
  } catch {
    dot.style.background = 'var(--red-400)';
    status.textContent = '服务未启动';
    document.getElementById('genRunBtn').disabled = true;
  }
}

// ====== DOM Event Wiring: Generation ======
export function initScriptPipeline() {
  document.getElementById('clearPipelineBtn').addEventListener('click', () => {
    document.getElementById('pipelineLogTerminal').innerHTML = '<div class="log-line system"><span class="ts">Cleared</div>';
  });

  // Copy button
  document.getElementById('genCopyBtn').addEventListener('click', () => {
    const text = pipelineState.currentScript;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('genCopyBtn');
      btn.textContent = '已复制';
      setTimeout(() => btn.textContent = '复制代码', 1500);
    });
  });

  // Download button
  document.getElementById('genDownloadBtn').addEventListener('click', () => {
    const text = pipelineState.currentScript;
    const name = pipelineState.currentFileName || 'generated-test.js';
    const blob = new Blob([text], { type: 'application/javascript' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // Run execution event handler (shared between WS and SSE paths)
  function createExecutionHandler() {
    const terminal = document.getElementById('genRunTerminal');
    const addRunLog = (type, msg) => {
      const line = document.createElement('div');
      line.className = `log-line ${type}`;
      const d = new Date();
      const t = d.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3,'0');
      line.innerHTML = `<span class="ts">${t}</span>${escapeHtml(msg)}`;
      terminal.appendChild(line);
      terminal.scrollTop = terminal.scrollHeight;
    };
    const handleEvent = (eventType, data) => {
      switch (eventType) {
        case 'log':
          addRunLog(data.type || 'info', data.message || '');
          break;

        case 'screenshots': {
          document.getElementById('genRunScreenshots').style.display = 'block';
          const list = document.getElementById('genRunScreenshotList');
          const urls = (data.screenshots || []).map(s => s.url);
          window.registerScreenshots(urls);
          list.innerHTML = (data.screenshots || []).map((s, i) =>
            `<div style="cursor:pointer" onclick="viewScreenshot('${s.url}')">
              <img src="${s.url}" style="width:120px;height:90px;object-fit:cover;border-radius:6px;border:1px solid var(--slate-200)" title="${s.fileName}">
              <div style="font-size:10px;color:var(--slate-400);text-align:center;margin-top:2px">${s.fileName}</div>
            </div>`
          ).join('');
          break;
        }

        case 'script-errors': {
          const errors = data.errors || [];
          if (errors.length > 0) {
            errors.forEach((e) => {
              const errDetail = e.details ? ` | ${e.details}` : '';
              const errVal = e.value ? ` | value: ${e.value}` : '';
              addRunLog('error', `[Step ${e.step}] ${e.action} "${e.label || ''}" → ${e.error}${errDetail}${errVal}`);
            });
            const resultDiv2 = document.getElementById('genRunResult');
            resultDiv2.style.display = 'block';
            resultDiv2.style.background = 'var(--amber-50)';
            resultDiv2.style.color = 'var(--amber-700)';
            resultDiv2.innerHTML = `<div>🔍 DETECTION — ${errors.length} error(s) captured</div>
              <div style="font-size:11px;margin-top:4px">${errors.map(e => `[Step ${e.step}] ${e.action} → ${e.error}`).join('<br>')}</div>`;
            document.getElementById('genRunDot').style.background = 'var(--amber-400)';
            document.getElementById('genRunStatus').textContent = '检测到错误';

            pipelineState.lastError = JSON.stringify(errors, null, 2);
            if (pipelineState.actionFile) {
              const formErr = errors.find(e => e.action === 'form_structure_changed');
              const stepErrs = errors.filter(e => e.step > 0 && e.action !== 'form_structure_changed' && e.action !== 'form_warning');
              const warnErrs = errors.filter(e => e.action === 'form_warning');
              document.getElementById('genHealArea').style.display = 'block';
              document.getElementById('genHealBtn').disabled = false;
              const parts = [];
              if (formErr) parts.push('form structure changed');
              if (stepErrs.length) parts.push(`${stepErrs.length} step error(s)`);
              if (warnErrs.length) parts.push(`${warnErrs.length} warning(s)`);
              document.getElementById('genHealStatus').textContent = 'Ready — ' + (parts.length ? parts.join(' + ') : 'errors detected');
            }
          }
          break;
        }

        case 'result': {
          const resultDiv = document.getElementById('genRunResult');
          resultDiv.style.display = 'block';
          if (data.success) {
            resultDiv.style.background = 'var(--emerald-50)';
            resultDiv.style.color = 'var(--emerald-700)';
            resultDiv.textContent = `✅ 测试通过 (exit code: ${data.exitCode})`;
            document.getElementById('genRunDot').style.background = 'var(--emerald-400)';
            pipelineState.lastError = '';
          } else {
            resultDiv.style.background = 'var(--red-50)';
            resultDiv.style.color = 'var(--red-600)';
            const errMsg = data.error || '';
            const stderr = data.stderr || '';
            const errorText = (errMsg || stderr || '').slice(0, 1000);

            let errorTag = '脚本错误';
            if (errorText.includes('CTRL is not defined')) errorTag = 'CTRL 未注入';
            else if (errorText.includes('strict mode violation')) errorTag = '定位器歧义';
            else if (errorText.includes('Timeout') || errorText.includes('locator.waitFor')) errorTag = '元素超时';
            else if (errorText.includes('ReferenceError') || errorText.includes('is not defined')) errorTag = '变量未定义';
            else if (errorText.includes('page.fill') || errorText.includes('fill(')) errorTag = '禁止使用 page.fill';
            else if (errorText.includes('selectOption') || errorText.includes("locator('select')") || errorText.includes('native select')) errorTag = '原生 select 误用';
            else if (errorText.includes('navigating to') && errorText.includes('ERR_')) errorTag = '导航错误';

            resultDiv.innerHTML = `<div>❌ 测试失败 <span style="display:inline-block;background:#fee2e2;color:#991b1b;padding:1px 10px;border-radius:10px;font-size:11px;margin-left:8px">${errorTag}</span></div><div style="font-size:11px;margin-top:4px;color:#dc2626">${escapeHtml(errorText.slice(0, 300))}</div>`;
            document.getElementById('genRunDot').style.background = 'var(--red-400)';
            if (!pipelineState.lastError) {
              pipelineState.lastError = errorText;
            }
            document.getElementById('genFeedback').value = `Error type: ${errorTag}\n\n${errorText}`;
          }
          break;
        }
      }
    };
    return { addRunLog, handleEvent };
  }

  // Run button — supports WebSocket (preferred) and HTTP+SSE (fallback)
  document.getElementById('genRunBtn').addEventListener('click', async () => {
    const script = pipelineState.currentScript;
    if (!script) { alert('没有可执行的脚本'); return; }

    isExecutionRunning = true;
    const terminal = document.getElementById('genRunTerminal');
    terminal.innerHTML = '';
    document.getElementById('genRunLog').style.display = 'block';
    document.getElementById('genRunScreenshots').style.display = 'none';
    document.getElementById('genRunResult').style.display = 'none';
    document.getElementById('genRunBtn').disabled = true;
    document.getElementById('genRunStatus').textContent = '正在执行...';
    document.getElementById('genRunDot').style.background = 'var(--amber-400)';

    const { addRunLog, handleEvent } = createExecutionHandler();
    addRunLog('system', `Executing script via server...`);

    try {
      if (isConnected()) {
        // ── WebSocket 路径 ──
        await new Promise((resolve) => {
          let settled = false;
          const finish = (fn) => () => {
            if (settled) return;
            settled = true;
            cleanup();
            fn();
          };

          const subs = [
            on('execution:log', (d) => handleEvent('log', d)),
            on('execution:screenshots', (d) => handleEvent('screenshots', d)),
            on('execution:script-errors', (d) => handleEvent('script-errors', d)),
            on('execution:result', (d) => handleEvent('result', d)),
            on('execution:done', finish(resolve)),
            on('execution:error', (d) => {
              addRunLog('error', d.message || 'Execution error');
              finish(resolve)();
            }),
            // WS 断线时立即结束等待,防止 Promise 永远挂起
            on('ws:disconnected', finish(() => {
              addRunLog('error', 'WebSocket 连接断开,执行已中断');
              resolve();
            })),
          ];

          // 超时保护:5 分钟无响应则放弃等待
          const timeout = setTimeout(finish(() => {
            addRunLog('error', '执行超时 (5 分钟)');
            resolve();
          }), 5 * 60 * 1000);

          function cleanup() {
            clearTimeout(timeout);
            subs.forEach(fn => fn());
          }

          if (!send('execution:start', { script, fileName: pipelineState.currentFileName || 'test.js' })) {
            addRunLog('error', 'WebSocket 未连接,无法发送执行请求');
            finish(resolve)();
          }
        });
      } else {
        // ── HTTP + SSE 回退路径 ──
        const res = await fetch(`/api/test/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ script, fileName: pipelineState.currentFileName || 'test.js' }),
        });
        if (!res.ok) {
          addRunLog('error', `Worker returned ${res.status}`);
          document.getElementById('genRunStatus').textContent = '执行失败';
          document.getElementById('genRunDot').style.background = 'var(--red-400)';
          document.getElementById('genRunBtn').disabled = false;
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';

          for (const event of events) {
            const lines = event.split('\n');
            const eventType = lines.find(l => l.startsWith('event:'))?.slice(7).trim();
            const dataLine = lines.find(l => l.startsWith('data:'))?.slice(6);
            if (!dataLine) continue;
            try {
              handleEvent(eventType, JSON.parse(dataLine));
            } catch {}
          }
        }
      }

      document.getElementById('genRunStatus').textContent = '执行完成';
    } catch (err) {
      addRunLog('error', `Connection failed: ${err.message}`);
      document.getElementById('genRunStatus').textContent = '连接失败';
      document.getElementById('genRunDot').style.background = 'var(--red-400)';
    } finally {
      isExecutionRunning = false;
      document.getElementById('genRunBtn').disabled = false;
    }
  });

  // Self-Heal button — triggers the rerun pipeline
  document.getElementById('genHealBtn').addEventListener('click', async () => {
    const actionFile = pipelineState.actionFile;
    if (!actionFile) { alert('No action file — assemble a trajectory first'); return; }

    let errors;
    try { errors = JSON.parse(pipelineState.lastError || '[]'); } catch { errors = []; }
    if (!errors.length) { alert('No errors captured — run the script first'); return; }

    // Collect all form-related errors: P2 (form_structure_changed) + P3/P4 (form_warning)
    const formErrors = errors.filter(e => e.action === 'form_structure_changed' || e.action === 'form_warning');
    const stepErrors = errors.filter(e => e.step > 0 && e.action !== 'form_structure_changed' && e.action !== 'form_warning');
    const formError = errors.find(e => e.action === 'form_structure_changed'); // P2 only
    const warnings = errors.filter(e => e.action === 'form_warning'); // P3/P4

    // Build form_changes from all form errors (multi-container support)
    let formChanges = null;
    let formActionIndex = null;
    const allFormChanges = [];
    for (const fe of formErrors) {
      const raw = fe.details || fe.value;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          allFormChanges.push(parsed);
          if (parsed.action_index) formActionIndex = parsed.action_index;
        } catch {}
      }
    }
    if (allFormChanges.length > 0) formChanges = allFormChanges;

    // failedStep: P1 step error > P2 form error step > action_index > 1 > 0
    const failedStep = stepErrors[0]?.step || formError?.step || formActionIndex || (formError ? 1 : 0);

    // Trigger self-heal for: P1 step errors, P2 form errors, or P3/P4 warnings
    const canHeal = stepErrors.length > 0 || formError || warnings.length > 0;
    if (!canHeal) { alert('No recoverable errors — run the script first'); return; }

    // Derive log path from action file
    // actionFile: "scripts/action/action_20260622_161836.json"
    const tsMatch = actionFile.match(/action[\/\\]action_(\d{8}_\d{6})\.json$/);
    const ts = tsMatch ? tsMatch[1] : '';
    const logFile = ts ? `scripts/log/log_${ts}.txt` : '';

    const healBtn = document.getElementById('genHealBtn');
    const healStatus = document.getElementById('genHealStatus');
    const terminal = document.getElementById('genRunTerminal');

    healBtn.disabled = true;
    healStatus.textContent = '正在启动自愈修复…';

    function addHealLog(type, msg) {
      const line = document.createElement('div');
      line.className = `log-line ${type}`;
      const d = new Date();
      const t = d.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
      line.innerHTML = `<span class="ts">${t}</span>${escapeHtml(msg)}`;
      terminal.appendChild(line);
      terminal.scrollTop = terminal.scrollHeight;
    }

    if (formError) {
      addHealLog('system', `🩹 Self-heal: form structure changed — _replay then re-record`);
    } else {
      addHealLog('system', `🩹 Self-heal: step ${failedStep} failed — _replay pre-failure then re-record`);
    }

    try {
      // Step 1: Create browser session (always fresh — self-heal is one-shot)
      addHealLog('step', '正在创建浏览器会话…');
      const sessRes = await fetch('/api/browser/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const sessData = await sessRes.json();
      if (!sessRes.ok) throw new Error(sessData.error || 'Session creation failed');
      const sessionId = sessData.sessionId;
      pipelineState.healSessionId = sessionId;
      addHealLog('success', `Session: ${sessionId}`);

      // Step 2: Trigger rerun via SSE
      addHealLog('step', `Rerun: action=${actionFile} log=${logFile} failed_step=${failedStep}`);
      const rerunBody = {
        action_file: actionFile,
        log_file: logFile,
        failedStep,
      };
      if (formChanges) rerunBody.form_changes = formChanges;
      const res = await fetch(`/api/browser/session/${sessionId}/rerun`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rerunBody),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Rerun returned ${res.status}`);
      }

      // SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const event of events) {
          const lines = event.split('\n');
          const eventType = lines.find(l => l.startsWith('event:'))?.slice(7).trim();
          const dataLine = lines.find(l => l.startsWith('data:'))?.slice(6);
          if (!dataLine) continue;
          try {
            const d = JSON.parse(dataLine);
            switch (eventType) {
              case 'log':
                addHealLog(d.type || 'info', d.message || '');
                break;
              case 'status':
                healStatus.textContent = d.label || '';
                break;
              case 'step':
                addHealLog('info', `Agent: ${d.next_goal || d.label || '...'}`);
                break;
              case 'phase_done':
                addHealLog('success', '🩹 Self-heal recording complete');
                healStatus.textContent = '✅ Recording done';
                document.getElementById('genRunDot').style.background = 'var(--emerald-400)';
                break;
              case 'done':
                if (d.success) {
                  addHealLog('success', 'Self-heal recording done');
                  pipelineState.healSuccess = true;
                } else {
                  addHealLog('error', `Self-heal failed: ${d.error || 'unknown'}`);
                  healStatus.textContent = '❌ Failed';
                  document.getElementById('genRunDot').style.background = 'var(--red-400)';
                }
                break;
              case 'error':
                addHealLog('error', d.message || '未知错误');
                break;
              default:
                addHealLog('info', `[${eventType}] ${JSON.stringify(d).slice(0, 100)}`);
                break;
            }
          } catch {}
        }
      }
      // Post-recording: save trajectory + show preview
      if (pipelineState.healSuccess) {
        try {
          // Save new trajectory from agent
          addHealLog('step', '正在保存录制的轨迹…');
          const saveRes = await fetch(`/api/browser/session/${sessionId}/trajectory`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task: 'Self-heal: recording from step ' + failedStep }),
          });
          const saveData = await saveRes.json();
          if (saveRes.ok && saveData.action_file) {
            const newActionFile = saveData.action_file;
            addHealLog('success', `New action: ${newActionFile}`);
            pipelineState.healActionFile = newActionFile;
            pipelineState.healTested = false;
            healStatus.textContent = '✅ Recording saved';

            // Show preview card
            showHealPreview(newActionFile);
          } else {
            addHealLog('error', `Save failed: ${saveData.error || 'unknown'}`);
          }
        } catch (e) {
          addHealLog('error', `Save error: ${e.message}`);
        }
      }
    } catch (err) {
      addHealLog('error', `Self-heal error: ${err.message}`);
      healStatus.textContent = '❌ ' + err.message;
    } finally {
      healBtn.disabled = false;
    }
  });

  // ====== Heal Preview + Assemble/Run/Apply ======
  function showHealPreview(actionFilePath) {
    const preview = document.getElementById('genHealPreview');
    const title = document.getElementById('genHealPreviewTitle');
    const stepsDiv = document.getElementById('genHealPreviewSteps');
    const assembleBtn = document.getElementById('genHealAssembleBtn');
    const runBtn = document.getElementById('genHealRunBtn');
    const applyBtn = document.getElementById('genHealApplyBtn');
    const result = document.getElementById('genHealActionResult');

    preview.style.display = 'block';
    title.textContent = '📋 Preview: ' + (actionFilePath || '');
    assembleBtn.disabled = false;
    runBtn.disabled = true;
    applyBtn.disabled = true;
    result.textContent = '';

    // Fetch raw action JSON and render as editable cards
    stepsDiv.style.maxHeight = '400px';
    const relPath = actionFilePath.replace(/\\/g, '/').replace(/^.*\/scripts\//, 'scripts/');
    fetch('/' + relPath).then(r => r.json()).then(jsonData => {
      const commands = jsonData?.tests?.[0]?.commands || [];
      const url = jsonData?.url || '';

      function showSaveBall() { saveBall.style.display = 'flex'; }
      function hideSaveBall() { saveBall.style.display = 'none'; }

      // Floating save ball (same pattern as trajectory viewer)
      let saveBall = document.getElementById('healSaveBall');
      if (!saveBall) {
        saveBall = document.createElement('div');
        saveBall.id = 'healSaveBall';
        saveBall.innerHTML = 'Save';
        Object.assign(saveBall.style, {
          position: 'fixed', left: '16px', bottom: '120px',
          width: '56px', height: '56px', borderRadius: '50%',
          background: 'var(--indigo-500)', color: '#fff',
          display: 'none', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontSize: '13px', fontWeight: '600',
          boxShadow: '0 4px 14px rgba(99,102,241,.4)',
          zIndex: '1000', transition: 'transform .15s, opacity .15s',
          border: 'none', fontFamily: 'inherit',
        });
        saveBall.onmouseenter = () => saveBall.style.transform = 'scale(1.08)';
        saveBall.onmouseleave = () => saveBall.style.transform = '';
        document.body.appendChild(saveBall);
      }
      hideSaveBall();

      // Store original data for save
      stepsDiv._healData = jsonData;

      function rerender() {
        renderActionCards(commands, stepsDiv, url, () => {
          wireActionButtons(commands, stepsDiv, showSaveBall, rerender);
        });
      }
      rerender();

      // Wire save ball
      saveBall.onclick = async () => {
        const cleaned = commands.filter(c => c !== null);
        jsonData.tests[0].commands = cleaned;
        try {
          saveBall.textContent = '...';
          const saveRes = await fetch('/api/test/assemble/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: actionFilePath, data: jsonData }),
          });
          const saveData = await saveRes.json();
          if (!saveRes.ok) throw new Error(saveData.error);
          saveBall.textContent = '✓';
          saveBall.style.background = 'var(--emerald-500)';
          setTimeout(() => {
            hideSaveBall();
            saveBall.textContent = 'Save';
            saveBall.style.background = 'var(--indigo-500)';
          }, 1500);
        } catch (err) {
          alert('Save failed: ' + err.message);
          saveBall.textContent = 'Save';
        }
      };
    }).catch(() => {
      stepsDiv.innerHTML = '<div style="color:var(--slate-400);padding:12px">Failed to load action file</div>';
    });

    // Assemble button: assemble the new action file
    assembleBtn.onclick = async () => {
      assembleBtn.disabled = true;
      result.textContent = 'Assembling...';
      try {
        const res = await fetch('/api/test/assemble', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actionFile: actionFilePath, preview: true }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        // Show script in preview area (not main area)
        const pre = document.getElementById('genHealScriptPre');
        const scriptDiv = document.getElementById('genHealPreviewScript');
        const lines = data.script.split('\n');
        pre.innerHTML = lines.map((line, i) => {
          const num = String(i + 1).padStart(3, ' ');
          return `<span style="display:flex"><span style="color:var(--slate-500);user-select:none;width:32px;flex-shrink:0;text-align:right;padding-right:12px">${num}</span><span>${escapeHtml(line) || ' '}</span></span>`;
        }).join('');
        scriptDiv.style.display = 'block';
        pipelineState.healScript = data.script;
        runBtn.disabled = false;
        result.textContent = '✅ Assembled (' + (data.stats?.deduped || '?') + ' steps)';
      } catch (e) {
        result.textContent = '❌ ' + e.message;
      } finally {
        assembleBtn.disabled = false;
      }
    };

    // Run button: run the assembled script via sync API
    runBtn.onclick = async () => {
      const script = pipelineState.healScript;
      if (!script) { alert('Assemble first'); return; }
      runBtn.disabled = true;
      result.textContent = 'Running...';
      pipelineState.healTested = false;
      try {
        const runRes = await fetch('/api/test/run-sync', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ script, fileName: 'heal-test-' + Date.now() + '.js' }),
        });
        const runData = await runRes.json();
        if (runData.success) {
          pipelineState.healTested = true;
          applyBtn.disabled = false;
          result.textContent = '✅ Test passed';
          document.getElementById('genRunDot').style.background = 'var(--emerald-400)';
        } else {
          result.textContent = '❌ Test failed (exit ' + runData.exitCode + ')';
          if (runData.stderr) addPipelineLog('error', runData.stderr.slice(-200));
        }
      } catch (e) {
        result.textContent = '❌ ' + e.message;
      } finally {
        runBtn.disabled = false;
      }
    };

    // Apply Fix: persist the fix
    applyBtn.onclick = async () => {
      if (!pipelineState.healTested) {
        alert('Run the test first to verify the fix');
        return;
      }
      applyBtn.disabled = true;
      result.textContent = 'Applying...';
      try {
        const oldPath = pipelineState.actionFile;
        const res = await fetch('/api/test/assemble/apply-fix', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldPath, newPath: actionFilePath }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        addPipelineLog('success', `Fix applied: ${actionFilePath}`);
        result.textContent = '✅ Fix applied';
        document.getElementById('genRunDot').style.background = 'var(--emerald-400)';
        document.getElementById('genHealStatus').textContent = '✅ Healed';
      } catch (e) {
        result.textContent = '❌ ' + e.message;
        applyBtn.disabled = false;
      }
    };
  }

  // ── WebSocket 事件驱动（替代 worker 健康轮询） ──
  // 执行期间跳过状态更新，避免"正在执行..."被覆盖
  let isExecutionRunning = false;

  function updateRunButtonHealth(data) {
    if (isExecutionRunning) return;  // 执行中，不覆盖状态
    const dot = document.getElementById('genRunDot');
    const status = document.getElementById('genRunStatus');
    if (!dot || !status) return;
    if (data.status === 'ok') {
      dot.style.background = 'var(--emerald-400)';
      status.textContent = '服务已就绪';
      document.getElementById('genRunBtn').disabled = false;
    } else {
      dot.style.background = 'var(--red-400)';
      status.textContent = '服务异常';
    }
  }

  on('server:init', (data) => {
    if (data.server) updateRunButtonHealth(data.server);
  });
  on('server:status', updateRunButtonHealth);
  on('ws:disconnected', () => {
    const dot = document.getElementById('genRunDot');
    const status = document.getElementById('genRunStatus');
    if (dot) dot.style.background = 'var(--red-400)';
    if (status) status.textContent = '服务未启动';
    document.getElementById('genRunBtn').disabled = true;
  });
}