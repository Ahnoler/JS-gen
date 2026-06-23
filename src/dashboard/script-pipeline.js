// Script Generation + Auto Pipeline
// Extracted from test-dashboard.js (generation, refinement, execution, logs)

import { ts } from './utils.js';
import { escapeHtml } from './swagger-api.js';

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
  healSessionId: null,  // browser session for self-heal
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
  document.getElementById('genRefineArea').style.display = 'block';
  document.getElementById('genFeedback').value = '';

  // Info
  const info = document.getElementById('genInfo');
  info.style.display = 'block';
  info.innerHTML = `测试ID: ${data.testId} | 文件: ${data.fileName} | Session: ${data.sessionId || 'N/A'}`;

  // Show Run area
  document.getElementById('genRunArea').style.display = 'block';
  document.getElementById('genHealArea').style.display = 'none';
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

  document.getElementById('genBtn').addEventListener('click', async () => {
    let description = document.getElementById('genDesc').value.trim();
    const url = document.getElementById('genUrl').value.trim();
    const username = document.getElementById('genUser').value.trim();
    const password = document.getElementById('genPass').value.trim();
    const statusEl = document.getElementById('genStatus');

    const trajPromptContent = document.getElementById('trajPromptContent');
    const trajPrompt = (trajPromptContent.value || '').trim();
    // Send trajectory table as separate field for structured prompt handling
    let trajectoryTable = '';
    if (trajPrompt) {
      // If trajectory is available but no user description, use trajectory as description
      if (!description) {
        description = trajPrompt;
      } else {
        trajectoryTable = trajPrompt;
      }
    }
    if (!description) { alert('请输入测试场景描述'); return; }

    const genModel = document.getElementById('genModel').value;
    const body = { description, url: url || undefined, model: genModel || undefined };
    if (trajectoryTable) body.trajectoryTable = trajectoryTable;
    if (username || password) body.credentials = {};
    if (username) body.credentials.username = username;
    if (password) body.credentials.password = password;

    const refFileInput = document.getElementById('genRefFile');
    if (refFileInput.files.length > 0) {
      if (refFileInput.files[0].size > 100 * 1024) {
        addPipelineLog('error', `参考脚本文件过大: ${(refFileInput.files[0].size/1024).toFixed(1)}KB，最大 100KB`);
        document.getElementById('genBtn').disabled = false;
        document.getElementById('genStatus').textContent = '❌ 参考脚本超过 100KB 限制';
        return;
      }
      body.referenceScript = await refFileInput.files[0].text();
      body.referenceScriptName = refFileInput.files[0].name;
    }

    // Clear pipeline log
    document.getElementById('pipelineLogTerminal').innerHTML = '';
    addPipelineLog('system', '=== Pipeline started ===');

    statusEl.textContent = '正在生成脚本...';
    document.getElementById('genBtn').disabled = true;
    document.getElementById('genScriptArea').style.display = 'none';
    document.getElementById('genRefineArea').style.display = 'none';
    document.getElementById('genSteps').style.display = 'none';
    document.getElementById('genInfo').style.display = 'none';
    document.getElementById('genRunArea').style.display = 'none';
    document.getElementById('genRunResult').style.display = 'none';

    addPipelineLog('info', `Generating script for: ${description.slice(0, 80)}`);
    if (body.referenceScriptName) addPipelineLog('info', `Reference script: ${body.referenceScriptName} (${(body.referenceScript.length/1024).toFixed(1)} KB)`);

    let genSessionId = null;

    try {
      // Step 1: Create session
      addPipelineLog('step', 'Creating agent session...');
      const sres = await fetch('/api/agent/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Script Generation', agent: 'build' }),
      });
      const sdata = await sres.json();
      if (!sres.ok) throw new Error(sdata.error || 'Session creation failed');
      genSessionId = sdata.sessionId;
      addPipelineLog('success', `Session: ${genSessionId}`);

      // Step 2: Start async generation
      addPipelineLog('step', 'Generating script via agent...');
      body.sessionId = genSessionId;
      const gres = await fetch('/api/test/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const gdata = await gres.json();
      if (!gres.ok) throw new Error(gdata.error || 'Generation failed');
      addPipelineLog('info', `Generation started — polling...`);

      // Step 3: Poll for result
      let data = null;
      let pollCount = 0;
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        pollCount++;
        
        try {
          const pollRes = await fetch(`/api/test/generate/${genSessionId}/status`);
          const pollData = await pollRes.json();
          
          if (pollData.status === 'done') {
            data = pollData;
            addPipelineLog('success', `Generation completed after ${pollCount} polls`);
            break;
          } else if (pollData.status === 'failed') {
            throw new Error(pollData.error || 'Generation failed');
          }
          
          if (pollCount % 10 === 0) {
            addPipelineLog('info', `Still generating... (${pollCount} polls)`);
          }
        } catch (err) {
          if (err.message.includes('Generation failed')) throw err;
          addPipelineLog('warn', `Poll failed: ${err.message}, retrying...`);
        }
      }

      await loadSessionOutput(genSessionId);

      pipelineState.currentTestId = data.testId;
      pipelineState.currentFileName = data.fileName;
      addPipelineLog('success', `Script generated: ${data.fileName} (${data.script.split('\n').length} lines)`);
      if (data.notes) addPipelineLog('warn', `AI notes: ${data.notes.replace(/\n/g, ' | ').slice(0, 500)}`);
      displayGeneratedScript(data);

      statusEl.textContent = '✅ 脚本已生成，点击 Run on Server 执行测试';
    } catch (err) {
      addPipelineLog('error', err.message);
      statusEl.textContent = '❌ ' + err.message;
    } finally {
      document.getElementById('genBtn').disabled = false;
    }
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

  // Trajectory prompt clear button
  document.getElementById('trajPromptClearBtn').addEventListener('click', () => {
    document.getElementById('trajPromptContent').value = '';
    document.getElementById('trajPromptCard').style.display = 'none';
  });

  // Reference file drop zone
  (function initRefDropZone() {
    const dropZone = document.getElementById('genRefDropZone');
    const refFileInput = document.getElementById('genRefFile');
    if (!dropZone || !refFileInput) return;

    dropZone.addEventListener('click', () => refFileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--indigo-400)'; dropZone.style.background = 'var(--indigo-50)'; });
    dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = 'var(--slate-200)'; dropZone.style.background = 'var(--slate-50)'; });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--slate-200)'; dropZone.style.background = 'var(--slate-50)';
      if (e.dataTransfer.files.length) { refFileInput.files = e.dataTransfer.files; refFileInput.dispatchEvent(new Event('change')); }
    });
    refFileInput.addEventListener('change', () => {
      const nameDiv = document.getElementById('genRefFileName');
      const label = document.getElementById('genRefFileLabel');
      if (refFileInput.files.length) {
        const file = refFileInput.files[0];
        nameDiv.style.display = 'flex';
        label.textContent = `${file.name} (${(file.size/1024).toFixed(1)} KB)`;
        dropZone.style.display = 'none';
      } else {
        nameDiv.style.display = 'none';
        dropZone.style.display = 'block';
      }
    });
    document.getElementById('genRefFileClear').addEventListener('click', () => {
      refFileInput.value = '';
      document.getElementById('genRefFileName').style.display = 'none';
      document.getElementById('genRefDropZone').style.display = 'block';
    });
  })();

  // Refine button
  document.getElementById('genRefineBtn').addEventListener('click', async () => {
    const feedback = document.getElementById('genFeedback').value.trim();
    if (!pipelineState.currentTestId) { alert('没有可执行的脚本'); return; }
    if (!feedback) { alert('请输入修改反馈'); return; }

    const refineStatus = document.getElementById('genRefineStatus');
    refineStatus.textContent = '正在重新生成...';
    refineStatus.style.color = 'var(--sky-500)';
    document.getElementById('genRefineBtn').disabled = true;

    addPipelineLog('step', 'Refining script with feedback: ' + feedback.slice(0, 80));

    try {
      const res = await fetch('/api/test/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testId: pipelineState.currentTestId, feedback, model: document.getElementById('genModel').value || undefined }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Refinement failed');

      displayGeneratedScript(data);
      refineStatus.textContent = `✅ 已更新: ${data.fileName}`;
      refineStatus.style.color = 'var(--emerald-500)';
      addPipelineLog('success', 'Script updated: ' + data.fileName);
      if (data.notes) addPipelineLog('warn', `AI notes: ${data.notes.replace(/\n/g, ' | ').slice(0, 500)}`);
      await loadSessionOutput(data.sessionId);
    } catch (err) {
      refineStatus.textContent = '❌ ' + err.message;
      refineStatus.style.color = 'var(--red-500)';
      addPipelineLog('error', err.message);
    } finally {
      document.getElementById('genRefineBtn').disabled = false;
    }
  });

  // Run button (SSE execution)
  document.getElementById('genRunBtn').addEventListener('click', async () => {
    const script = pipelineState.currentScript;
    if (!script) { alert('没有可执行的脚本'); return; }

    const terminal = document.getElementById('genRunTerminal');
    terminal.innerHTML = '';
    document.getElementById('genRunLog').style.display = 'block';
    document.getElementById('genRunScreenshots').style.display = 'none';
    document.getElementById('genRunResult').style.display = 'none';
    document.getElementById('genRunBtn').disabled = true;
    document.getElementById('genRunStatus').textContent = '正在执行...';
    document.getElementById('genRunDot').style.background = 'var(--amber-400)';

    function addRunLog(type, msg) {
      const line = document.createElement('div');
      line.className = `log-line ${type}`;
      const d = new Date();
      const t = d.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3,'0');
      line.innerHTML = `<span class="ts">${t}</span>${escapeHtml(msg)}`;
      terminal.appendChild(line);
      terminal.scrollTop = terminal.scrollHeight;
    }

    addRunLog('system', `Executing script via server...`);

    try {
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
            const data = JSON.parse(dataLine);

            switch (eventType) {
              case 'log':
                addRunLog(data.type || 'info', data.message || '');
                break;

              case 'screenshots':
                document.getElementById('genRunScreenshots').style.display = 'block';
                const list = document.getElementById('genRunScreenshotList');
                list.innerHTML = (data.screenshots || []).map(s =>
                  `<div style="cursor:pointer" onclick="viewScreenshot('${s.url}')">
                    <img src="${s.url}" style="width:120px;height:90px;object-fit:cover;border-radius:6px;border:1px solid var(--slate-200)" title="${s.fileName}">
                    <div style="font-size:10px;color:var(--slate-400);text-align:center;margin-top:2px">${s.fileName}</div>
                  </div>`
                ).join('');
                break;

              case 'script-errors':
                // DETECTION PHASE — display captured script errors
                const errors = data.errors || [];
                if (errors.length > 0) {
                  errors.forEach((e, i) => {
                    const errDetail = e.details ? ` | ${e.details}` : '';
                    const errVal = e.value ? ` | value: ${e.value}` : '';
                    addRunLog('error', `[Step ${e.step}] ${e.action} "${e.label || ''}" → ${e.error}${errDetail}${errVal}`);
                  });

                  // Show in result area
                  const resultDiv2 = document.getElementById('genRunResult');
                  resultDiv2.style.display = 'block';
                  resultDiv2.style.background = 'var(--amber-50)';
                  resultDiv2.style.color = 'var(--amber-700)';
                  resultDiv2.innerHTML = `<div>🔍 DETECTION — ${errors.length} error(s) captured</div>
                    <div style="font-size:11px;margin-top:4px">${errors.map(e => `[Step ${e.step}] ${e.action} → ${e.error}`).join('<br>')}</div>`;
                  document.getElementById('genRunDot').style.background = 'var(--amber-400)';
                  document.getElementById('genRunStatus').textContent = '检测到错误';

                  // Enable self-heal button if we have an action file
                  pipelineState.lastError = JSON.stringify(errors, null, 2);
                  if (pipelineState.actionFile) {
                    const stepErrors = errors.filter(e => e.step > 0);
                    const firstStep = stepErrors[0]?.step || errors[0]?.step || '?';
                    document.getElementById('genHealArea').style.display = 'block';
                    document.getElementById('genHealBtn').disabled = false;
                    document.getElementById('genHealStatus').textContent = `Ready — ${stepErrors.length} error(s) at step ${firstStep}`;
                  }
                }
                break;

              case 'result':
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
                  
                  // Classify error for display
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
                  // Capture error for refine
                  // Don't overwrite structured errors from script-errors event
                  if (!pipelineState.lastError) {
                    pipelineState.lastError = errorText;
                  }
                  document.getElementById('genFeedback').value = `Error type: ${errorTag}\n\n${errorText}`;
                }
                break;
            }
          } catch {}
        }
      }

      document.getElementById('genRunStatus').textContent = '执行完成';
    } catch (err) {
      addRunLog('error', `Connection failed: ${err.message}`);
      document.getElementById('genRunStatus').textContent = '连接失败';
      document.getElementById('genRunDot').style.background = 'var(--red-400)';
    } finally {
      document.getElementById('genRunBtn').disabled = false;
    }
  });

  // Self-Heal button — triggers the rerun pipeline
  document.getElementById('genHealBtn').addEventListener('click', async () => {
    const actionFile = pipelineState.actionFile;
    if (!actionFile) { alert('No action file — assemble a trajectory first'); return; }

    let errors;
    try { errors = JSON.parse(pipelineState.lastError || '[]'); } catch { errors = []; }
    const stepErrors = errors.filter(e => e.step > 0);
    if (!stepErrors.length) { alert('No step errors captured — run the script first'); return; }
    const failedStep = stepErrors[0]?.step || 1;

    // Derive traj and log paths from action file
    // actionFile: "scripts/action/action_20260622_161836.json"
    const tsMatch = actionFile.match(/action[\/\\]action_(\d{8}_\d{6})\.json$/);
    const ts = tsMatch ? tsMatch[1] : '';
    const trajFile = ts ? `scripts/trajectories/traj_${ts}.json` : '';
    const logFile = ts ? `scripts/log/log_${ts}.txt` : '';

    const healBtn = document.getElementById('genHealBtn');
    const healStatus = document.getElementById('genHealStatus');
    const terminal = document.getElementById('genRunTerminal');

    healBtn.disabled = true;
    healStatus.textContent = 'Starting self-heal...';

    function addHealLog(type, msg) {
      const line = document.createElement('div');
      line.className = `log-line ${type}`;
      const d = new Date();
      const t = d.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
      line.innerHTML = `<span class="ts">${t}</span>${escapeHtml(msg)}`;
      terminal.appendChild(line);
      terminal.scrollTop = terminal.scrollHeight;
    }

    addHealLog('system', `🩹 Self-heal: step ${failedStep} failed, replaying from trajectory...`);

    try {
      // Step 1: Create/ensure browser session
      let sessionId = pipelineState.healSessionId;
      if (!sessionId) {
        addHealLog('step', 'Creating browser session...');
        const sessRes = await fetch('/api/browser/session', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const sessData = await sessRes.json();
        if (!sessRes.ok) throw new Error(sessData.error || 'Session creation failed');
        sessionId = sessData.sessionId;
        pipelineState.healSessionId = sessionId;
        addHealLog('success', `Session: ${sessionId}`);
      }

      // Step 2: Trigger rerun via SSE
      addHealLog('step', `Rerun: traj=${trajFile} action=${actionFile} log=${logFile} failed_step=${failedStep}`);
      const res = await fetch(`/api/browser/session/${sessionId}/rerun`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trajectoryFile: trajFile,
          action_file: actionFile,
          log_file: logFile,
          failedStep,
        }),
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
              case 'rerun_start':
                addHealLog('step', `Replaying ${d.prefix_entries} history entries to step ${d.failed_step}...`);
                healStatus.textContent = `Replaying prefix...`;
                break;
              case 'rerun_replay_done':
                addHealLog('success', 'Prefix replay done — browser at error scene');
                break;
              case 'rerun_resume':
                addHealLog('step', 'Agent recording resumed...');
                healStatus.textContent = 'Recording...';
                break;
              case 'rerun_validate':
                if (d.step === 'assembling') {
                  addHealLog('step', `Validating: assembling merged script (${d.new_actions} new + ${d.prefix} prefix)...`);
                  healStatus.textContent = 'Validating...';
                } else if (d.step === 'running') {
                  addHealLog('step', 'Running merged script...');
                } else if (d.step === 'done') {
                  if (d.passed) {
                    addHealLog('success', `✅ Validation PASSED (exit=${d.exit_code}, errors=${d.errors})`);
                  } else {
                    addHealLog('error', `❌ Validation FAILED (exit=${d.exit_code}, errors=${d.errors})`);
                    if (d.stdout_tail) addHealLog('info', `stdout: ${d.stdout_tail.slice(-200)}`);
                    if (d.stderr_tail) addHealLog('error', `stderr: ${d.stderr_tail.slice(-200)}`);
                  }
                }
                break;
              case 'rerun_done':
                if (d.validated) {
                  addHealLog('success', `🩹 Self-heal complete! Fixed action: ${d.merged_file || '(saved)'}`);
                  addHealLog('success', `Actions: ${d.prefix_actions} prefix + ${d.new_actions} re-recorded`);
                  healStatus.textContent = `✅ Fixed — ${d.merged_file || ''}`;
                  document.getElementById('genRunDot').style.background = 'var(--emerald-400)';
                } else {
                  addHealLog('error', `❌ Self-heal failed — ${d.error || 'validation did not pass'}`);
                  healStatus.textContent = '❌ Failed';
                  document.getElementById('genRunDot').style.background = 'var(--red-400)';
                }
                break;
              case 'step':
                addHealLog('info', `Step: ${d.next_goal || d.label || '...'}`);
                break;
              case 'phase_done':
                addHealLog('step', 'Agent step completed');
                break;
              case 'error':
                addHealLog('error', d.message || 'Unknown error');
                break;
            }
          } catch {}
        }
      }
    } catch (err) {
      addHealLog('error', `Self-heal error: ${err.message}`);
      healStatus.textContent = '❌ ' + err.message;
    } finally {
      healBtn.disabled = false;
    }
  });
}
