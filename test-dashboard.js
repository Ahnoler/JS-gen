// DOM refs
const $ = s => document.querySelector(s);

// ====== Helpers ======
function ts() {
  const d = new Date();
  return d.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3,'0');
}

// ====== UI Events ======
document.getElementById('clearPipelineBtn').addEventListener('click', () => {
  document.getElementById('pipelineLogTerminal').innerHTML = '<div class="log-line system"><span class="ts">Cleared</div>';
});

// Image overlay
document.getElementById('overlayClose').addEventListener('click', () => {
  document.getElementById('imageOverlay').classList.remove('open');
});
document.getElementById('imageOverlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) document.getElementById('imageOverlay').classList.remove('open');
});

// ====== Swagger-style API Reference ======
const swaggerEndpoints = [
  {
    method: 'GET', color: 'var(--emerald-600)', bg: 'var(--emerald-100)',
    path: '/api/health',
    summary: 'Server health check & status',
    desc: 'Returns the current server health status, opencode connection state, available agents, and skills.',
    params: [],
    respExample: JSON.stringify({ status: 'ok', opencode: 'connected', agents: [{ name: 'build', description: '...' }], skills: [{ name: 'playwright-skill', description: '...' }] }, null, 2),
  },
  {
    method: 'GET', color: 'var(--emerald-600)', bg: 'var(--emerald-100)',
    path: '/api/agents',
    summary: 'List available agents',
    desc: 'Returns a list of all available AI agents in the OpenCode system.',
    params: [],
    respExample: JSON.stringify({ agents: [{ name: 'build', description: 'The default agent' }] }, null, 2),
  },
  {
    method: 'GET', color: 'var(--emerald-600)', bg: 'var(--emerald-100)',
    path: '/api/skills',
    summary: 'List available skills',
    desc: 'Returns a list of all available skills with their name, description, and content.',
    params: [],
    respExample: JSON.stringify({ skills: [{ name: 'playwright-skill', description: 'Browser automation skill', content: '...' }] }, null, 2),
  },
  {
    method: 'POST', color: 'var(--indigo-600)', bg: 'var(--indigo-100)',
    path: '/api/agent/execute',
    summary: 'Execute agent task (JSON)',
    desc: 'Sends a task to the specified agent and returns the response. Optionally loads a skill as context.',
    contentType: 'application/json',
    reqExample: JSON.stringify({ agent: 'general', task: 'Explain what opencode is', system: 'Answer in Chinese', skill: 'playwright-skill', model: { providerID: 'myprovider', modelID: 'GLM-5' } }, null, 2),
    respExample: JSON.stringify({ sessionId: 'ses_xxx', response: 'opencode is...', partCount: 4 }, null, 2),
    buildRequest(path, bodyObj) { return { url: path, options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj) } }; },
  },
  {
    method: 'POST', color: 'var(--indigo-600)', bg: 'var(--indigo-100)',
    path: '/api/agent/execute-async',
    summary: 'Fire-and-forget agent task',
    desc: 'Sends a task to the agent and returns immediately without waiting for completion.',
    contentType: 'application/json',
    reqExample: JSON.stringify({ agent: 'general', task: 'Long running task...' }, null, 2),
    respExample: JSON.stringify({ sessionId: 'ses_xxx', status: 'accepted' }, null, 2),
    buildRequest(path, bodyObj) { return { url: path, options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj) } }; },
  },
  {
    method: 'POST', color: 'var(--indigo-600)', bg: 'var(--indigo-100)',
    path: '/api/agent/session',
    summary: 'Create a new session',
    desc: 'Creates a new OpenCode session for interacting with AI agents.',
    contentType: 'application/json',
    reqExample: JSON.stringify({ title: 'My Session', agent: 'build' }, null, 2),
    respExample: JSON.stringify({ sessionId: 'ses_xxx' }, null, 2),
    buildRequest(path, bodyObj) { return { url: path, options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj) } }; },
  },
  {
    method: 'POST', color: 'var(--indigo-600)', bg: 'var(--indigo-100)',
    path: '/api/agent/session/{id}/message',
    summary: 'Send message to session',
    desc: 'Send a new message to an existing session. Replace {id} with the actual session ID.',
    contentType: 'application/json',
    params: [{ name: 'id', type: 'string', required: true, desc: 'Session ID', in: 'path', example: 'ses_xxx' }],
    reqExample: JSON.stringify({ agent: 'general', task: 'Continue the conversation...', system: 'optional' }, null, 2),
    respExample: JSON.stringify({ sessionId: 'ses_xxx', response: 'Response text...' }, null, 2),
    buildRequest(path, bodyObj) { return { url: path, options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj) } }; },
  },
  {
    method: 'GET', color: 'var(--emerald-600)', bg: 'var(--emerald-100)',
    path: '/api/agent/session/{id}/messages',
    summary: 'Get session messages',
    desc: 'Retrieve all messages in a session. Replace {id} with the actual session ID.',
    params: [{ name: 'id', type: 'string', required: true, desc: 'Session ID', in: 'path', example: 'ses_xxx' }],
    respExample: JSON.stringify([{ id: 'msg_xxx', role: 'assistant', parts: [{ type: 'text', text: '...' }] }], null, 2),
    buildRequest(path) { return { url: path, options: { method: 'GET' } }; },
  },
  {
    method: 'DELETE', color: 'var(--red-600)', bg: 'var(--red-100)',
    path: '/api/agent/session/{id}',
    summary: 'Delete a session',
    desc: 'Delete a session and permanently remove all associated data. Replace {id} with the actual session ID.',
    params: [{ name: 'id', type: 'string', required: true, desc: 'Session ID', in: 'path', example: 'ses_xxx' }],
    respExample: JSON.stringify({ status: 'deleted', sessionId: 'ses_xxx' }, null, 2),
    buildRequest(path) { return { url: path, options: { method: 'DELETE' } }; },
  },
  {
    method: 'SSE', color: 'var(--amber-600)', bg: 'var(--amber-100)',
    path: '/api/agent/execute-stream',
    summary: 'Streaming agent execution',
    desc: 'Connects via Server-Sent Events to stream agent execution progress, logs, and partial text responses in real-time.',
    params: [
      { name: 'agent', type: 'string', required: true, desc: 'Agent name', in: 'query', example: 'general' },
      { name: 'task', type: 'string', required: true, desc: 'Task description', in: 'query', example: 'Say hello' },
      { name: 'system', type: 'string', required: false, desc: 'System prompt override', in: 'query' },
      { name: 'skill', type: 'string', required: false, desc: 'Skill name to load as context', in: 'query' },
    ],
    respExample: 'event: step 鈫?{ id, status, label }\nevent: log 鈫?{ type, message }\nevent: text 鈫?{ text }\nevent: result 鈫?{ sessionId, response }\nevent: done 鈫?{}',
    buildRequest(path) { return { url: path, options: { method: 'GET' } }; },
  },
  {
    method: 'POST', color: 'var(--indigo-600)', bg: 'var(--indigo-100)',
    path: '/api/test/run',
    summary: 'Execute Playwright script (SSE)',
    desc: 'Executes a Playwright test script and streams execution logs, screenshots, and results via Server-Sent Events.',
    contentType: 'application/json',
    reqExample: JSON.stringify({ script: 'const { chromium } = require("playwright");\n(async () => { ... })()', fileName: 'my-test.js' }, null, 2),
    respExample: 'event: log 鈫?{ type, message }\nevent: screenshots 鈫?{ screenshots: [{ fileName, url }] }\nevent: result 鈫?{ success, exitCode, stdout, stderr }\nevent: done 鈫?{}',
    buildRequest(path, bodyObj) { return { url: path, options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj) } }; },
  },
  {
    method: 'POST', color: 'var(--indigo-600)', bg: 'var(--indigo-100)',
    path: '/api/test/run-sync',
    summary: 'Execute Playwright script (JSON)',
    desc: 'Executes a Playwright test script and returns results as JSON (non-streaming).',
    contentType: 'application/json',
    reqExample: JSON.stringify({ script: 'const { chromium } = require("playwright");\n(async () => { ... })()', fileName: 'my-test.js' }, null, 2),
    respExample: JSON.stringify({ success: true, exitCode: 0, stdout: '...', stderr: '', screenshots: [{ fileName: 'step1.png', url: '/api/test/screenshots/step1.png' }] }, null, 2),
    buildRequest(path, bodyObj) { return { url: path, options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj) } }; },
  },
];

function renderSwaggerUI() {
  const container = document.getElementById('apiEndpointsContainer');
  container.innerHTML = '';

  swaggerEndpoints.forEach((ep, idx) => {
    const epDiv = document.createElement('div');
    epDiv.className = 'api-endpoint';
    epDiv.style.cssText = 'border:1px solid var(--slate-200);border-radius:10px;overflow:hidden';

    // === HEADER (always visible) ===
    const header = document.createElement('div');
    header.className = 'ep-header';
    header.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;transition:background .1s';
    header.onmouseenter = () => header.style.background = 'var(--slate-50)';
    header.onmouseleave = () => header.style.background = '';
    header.innerHTML = `
      <span style="background:${ep.bg};color:${ep.color};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:.5px;white-space:nowrap">${ep.method}</span>
      <code style="font-size:13px;font-weight:500;color:var(--slate-700)">${ep.path}</code>
      <span style="font-size:12px;color:var(--slate-400);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ep.summary}</span>
      <svg class="ep-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" style="color:var(--slate-400);flex-shrink:0;transition:transform .2s"><polyline points="9 18 15 12 9 6"/></svg>
    `;

    // === BODY (collapsible) ===
    const body = document.createElement('div');
    body.className = 'ep-body';
    body.style.cssText = 'display:none;padding:0 14px 14px;border-top:1px solid var(--slate-100)';

    // Description
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:13px;color:var(--slate-500);padding:10px 0;border-bottom:1px solid var(--slate-100);margin-bottom:10px';
    desc.textContent = ep.desc;
    body.appendChild(desc);

    // Parameters
    if (ep.params && ep.params.length) {
      const paramSection = document.createElement('div');
      paramSection.style.cssText = 'margin-bottom:10px';
      paramSection.innerHTML = '<div style="font-size:12px;font-weight:600;color:var(--slate-600);margin-bottom:6px">Parameters</div>';
      ep.params.forEach(p => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;align-items:center;padding:4px 0;font-size:12px';
        row.innerHTML = `
          <code style="color:var(--slate-700);font-weight:500">${p.name}</code>
          <span style="color:var(--slate-400)">${p.type}</span>
          <span style="color:${p.required ? 'var(--red-500)' : 'var(--slate-400)'}">${p.required ? 'required' : 'optional'}</span>
          <span style="color:var(--slate-400);flex:1">${p.desc}</span>
          ${p.example ? `<code style="color:var(--indigo-600);font-size:11px">Example: ${p.example}</code>` : ''}
          ${p.in === 'path' ? `<span style="background:var(--slate-100);color:var(--slate-500);padding:1px 6px;border-radius:4px;font-size:10px">path</span>` : ''}
        `;
        paramSection.appendChild(row);
      });
      body.appendChild(paramSection);
    }

    // Request Body (POST only)
    if (ep.reqExample) {
      const reqSection = document.createElement('div');
      reqSection.style.cssText = 'margin-bottom:10px';
      reqSection.innerHTML = `
        <div style="font-size:12px;font-weight:600;color:var(--slate-600);margin-bottom:6px">Request Body <span style="font-weight:400;color:var(--slate-400)">${ep.contentType || ''}</span></div>
        <pre class="ep-example" style="background:var(--slate-800);color:#e2e8f0;padding:10px;border-radius:6px;font-size:12px;line-height:1.5;overflow-x:auto">${escapeHtml(ep.reqExample)}</pre>
      `;
      body.appendChild(reqSection);
    }

    // Response Example
    if (ep.respExample) {
      const respSection = document.createElement('div');
      respSection.style.cssText = 'margin-bottom:10px';
      respSection.innerHTML = `
        <div style="font-size:12px;font-weight:600;color:var(--slate-600);margin-bottom:6px">Responses <code style="font-weight:400;font-size:11px;color:var(--emerald-600)">200</code></div>
        <pre class="ep-example" style="background:var(--slate-800);color:#e2e8f0;padding:10px;border-radius:6px;font-size:12px;line-height:1.5;overflow-x:auto">${escapeHtml(ep.respExample)}</pre>
      `;
      body.appendChild(respSection);
    }

    // Try it out section
    const pathParams = (ep.params || []).filter(p => p.in === 'path');
    const queryParams = (ep.params || []).filter(p => p.in === 'query');

    const trySection = document.createElement('div');
    trySection.innerHTML = `
      <div style="padding-top:10px;border-top:1px solid var(--slate-100)">
        <button class="ep-try-btn btn btn-outline btn-sm">Try it out</button>
        <div class="ep-try-area" style="display:none;margin-top:10px">
          ${ep.reqExample ? `<div style="margin-bottom:8px"><label style="font-size:12px;font-weight:500;color:var(--slate-600);display:block;margin-bottom:4px">Request Body <span style="font-weight:400;color:var(--slate-400)">(editable JSON)</span></label>
            <textarea class="ep-editor" rows="6" style="width:100%;background:var(--slate-800);color:#e2e8f0;border:1px solid var(--slate-600);border-radius:6px;padding:8px;font-family:var(--font-mono);font-size:12px;resize:vertical">${escapeHtml(ep.reqExample)}</textarea></div>` : ''}
          ${pathParams.length ? `<div style="margin-bottom:8px"><label style="font-size:12px;font-weight:500;color:var(--slate-600);display:block;margin-bottom:4px">Path Parameters</label>
            ${pathParams.map(p => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px"><code style="color:var(--slate-700);font-size:12px;min-width:50px">{${p.name}}</code><input class="ep-param-path" data-param="${p.name}" placeholder="${p.example || ''}" style="flex:1;padding:4px 8px;border:1px solid var(--slate-300);border-radius:4px;font-size:12px;font-family:var(--font-mono)"><span style="font-size:10px;color:var(--slate-400);min-width:40px">${p.required ? 'required' : 'optional'}</span></div>`).join('')}</div>` : ''}
          ${queryParams.length ? `<div style="margin-bottom:8px"><label style="font-size:12px;font-weight:500;color:var(--slate-600);display:block;margin-bottom:4px">Query Parameters</label>
            ${queryParams.map(p => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px"><code style="color:var(--slate-700);font-size:12px;min-width:50px">${p.name}</code><input class="ep-param-query" data-param="${p.name}" placeholder="${p.example || ''}" style="flex:1;padding:4px 8px;border:1px solid var(--slate-300);border-radius:4px;font-size:12px;font-family:var(--font-mono)"><span style="font-size:10px;color:var(--slate-400);min-width:40px">${p.required ? 'required' : 'optional'}</span></div>`).join('')}</div>` : ''}
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="ep-execute-btn btn btn-primary btn-sm">Execute</button>
            <button class="ep-cancel-btn btn btn-outline btn-sm">Cancel</button>
            <span class="ep-curl" style="font-size:11px;color:var(--slate-400);font-family:var(--font-mono)"></span>
          </div>
          <div class="ep-response" style="display:none;margin-top:10px">
            <div style="font-size:12px;font-weight:600;color:var(--slate-600);margin-bottom:6px">Response</div>
            <div class="ep-response-meta" style="font-size:11px;color:var(--slate-400);margin-bottom:4px"></div>
            <pre class="ep-response-body" style="background:var(--slate-800);color:#e2e8f0;padding:10px;border-radius:6px;font-size:12px;line-height:1.5;max-height:300px;overflow:auto;white-space:pre-wrap;word-break:break-all"></pre>
          </div>
        </div>
      </div>
    `;
    body.appendChild(trySection);

    // Toggle header
    header.addEventListener('click', () => {
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : 'block';
      header.querySelector('.ep-chevron').style.transform = isOpen ? '' : 'rotate(90deg)';
    });

    // Try it out button
    const tryBtn = trySection.querySelector('.ep-try-btn');
    const tryArea = trySection.querySelector('.ep-try-area');
    tryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = tryArea.style.display !== 'none';
      tryArea.style.display = isOpen ? 'none' : 'block';
      tryBtn.textContent = isOpen ? 'Try it out' : 'Close';
    });

    // Cancel button
    const cancelBtn2 = trySection.querySelector('.ep-cancel-btn');
    cancelBtn2.addEventListener('click', (e) => {
      e.stopPropagation();
      tryArea.style.display = 'none';
      tryBtn.textContent = 'Try it out';
      tryBtn.style.display = 'inline-flex';
    });

    // Execute button
    const execBtn = trySection.querySelector('.ep-execute-btn');
    const responseDiv = trySection.querySelector('.ep-response');
    const responseMeta = trySection.querySelector('.ep-response-meta');
    const responseBody = trySection.querySelector('.ep-response-body');
    const curlSpan = trySection.querySelector('.ep-curl');
    const editor = trySection.querySelector('.ep-editor');

    execBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      execBtn.disabled = true;
      execBtn.textContent = 'Executing...';

      // Build resolved path and body
      let resolvedPath = ep.path;

      // Read path params from input fields
      for (const p of pathParams) {
        const input = trySection.querySelector(`.ep-param-path[data-param="${p.name}"]`);
        const val = input ? input.value.trim() : '';
        if (val) resolvedPath = resolvedPath.replace(`{${p.name}}`, val);
      }

      // Build URL with query params from input fields
      let url = resolvedPath;
      if (queryParams.length) {
        const qs = new URLSearchParams();
        for (const p of queryParams) {
          const input = trySection.querySelector(`.ep-param-query[data-param="${p.name}"]`);
          const val = input ? input.value.trim() : '';
          if (val) qs.set(p.name, val);
        }
        const qstr = qs.toString();
        if (qstr) url += '?' + qstr;
      }

      // Build request
      let bodyObj;
      let fetchOptions;
      if (ep.buildRequest) {
        if (editor) {
          try { bodyObj = JSON.parse(editor.value); }
          catch { responseDiv.style.display = 'block'; responseMeta.textContent = '400 Bad Request'; responseBody.textContent = 'Invalid JSON in request body'; execBtn.disabled = false; execBtn.textContent = 'Execute'; return; }
          fetchOptions = ep.buildRequest(url, bodyObj);
        } else {
          fetchOptions = ep.buildRequest(url);
        }
      } else {
        fetchOptions = { url, options: { method: ep.method } };
      }

      // Show curl equivalent
      if (bodyObj) {
        curlSpan.textContent = `curl -X ${fetchOptions.options.method} "${fetchOptions.url}" -H "Content-Type: application/json" -d '${JSON.stringify(bodyObj)}'`;
      } else {
        curlSpan.textContent = `curl -X ${fetchOptions.options.method} "${fetchOptions.url}"`;
      }

      // Execute
      try {
        const res = await fetch(fetchOptions.url, fetchOptions.options);
        const text = await res.text();
        responseDiv.style.display = 'block';
        responseMeta.textContent = `${res.status} ${res.statusText}`;
        const statusColor = res.ok ? 'var(--emerald-500)' : 'var(--red-500)';
        responseMeta.innerHTML = `<span style="color:${statusColor};font-weight:600">${res.status}</span> ${res.statusText} <span style="color:var(--slate-400)">| ${(new Blob([text]).size / 1024).toFixed(1)} KB</span>`;
        try { responseBody.textContent = JSON.stringify(JSON.parse(text), null, 2); }
        catch { responseBody.textContent = text; }
      } catch (err) {
        responseDiv.style.display = 'block';
        responseMeta.textContent = 'Error';
        responseBody.textContent = err.message;
      }

      execBtn.disabled = false;
      execBtn.textContent = 'Execute';
    });

    epDiv.appendChild(header);
    epDiv.appendChild(body);
    container.appendChild(epDiv);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Toggle API Reference panel
document.getElementById('apiDocHeader').addEventListener('click', () => {
  const content = document.getElementById('apiDocContent');
  const toggle = document.getElementById('apiDocToggle');
  const isOpen = content.style.display !== 'none';
  content.style.display = isOpen ? 'none' : 'block';
  toggle.textContent = isOpen ? 'Show' : 'Hide';
  if (!isOpen && !document.querySelector('.api-endpoint')) renderSwaggerUI();
});

// Render on first open via toggle - but also pre-render for the open-by-default case
if (document.getElementById('apiDocContent').style.display !== 'none') renderSwaggerUI();

// ====== Reference File Drop Zone ======
(function() {
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

// ====== Tab Switching ======
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
    const target = document.getElementById('tab' + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1));
    if (target) target.style.display = 'block';
    if (btn.dataset.tab === 'history') loadHistory();
    if (btn.dataset.tab === 'trajectories') loadTrajectoryHistory();
    if (btn.dataset.tab === 'execRecords') loadExecutionRecords();
  });
});

// Explore mode toggle (One-Shot / Multi-Turn Session)
document.querySelectorAll('.explore-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.explore-mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const mode = btn.dataset.mode;
    const oneShot = document.getElementById('exploreOneShot');
    const session = document.getElementById('exploreSession');
    if (oneShot) oneShot.style.display = mode === 'oneshot' ? 'block' : 'none';
    if (session) session.style.display = mode === 'session' ? 'block' : 'none';
    if (mode === 'session' && typeof loadActiveSessions === 'function') loadActiveSessions();
  });
});

// ====== Script Generation + Auto Pipeline ======
let currentTestId = null;
let currentFileName = null;
let currentScript = '';

function addPipelineLog(type, msg) {
  const terminal = document.getElementById('pipelineLogTerminal');
  const d = new Date();
  const t = d.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3,'0');
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.innerHTML = `<span class="ts">${t}</span>${msg.replace(/</g,'&lt;').replace(/>/g,'&gt;')}`;
  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}

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

document.getElementById('genBtn').addEventListener('click', async () => {
  let description = document.getElementById('genDesc').value.trim();
  const url = document.getElementById('genUrl').value.trim();
  const username = document.getElementById('genUser').value.trim();
  const password = document.getElementById('genPass').value.trim();
  const statusEl = document.getElementById('genStatus');

  const trajPromptContent = document.getElementById('trajPromptContent');
  const trajPrompt = trajPromptContent.textContent.trim();
  if (trajPrompt) {
    description = description ? trajPrompt + '\n\n' + description : trajPrompt;
  }
  if (!description) { alert('请输入测试场景描述'); return; }

  const genModel = document.getElementById('genModel').value;
  const body = { description, url: url || undefined, model: genModel || undefined };
  if (username || password) body.credentials = {};
  if (username) body.credentials.username = username;
  if (password) body.credentials.password = password;

  const refFileInput = document.getElementById('genRefFile');
  if (refFileInput.files.length > 0) {
    if (refFileInput.files[0].size > 100 * 1024) {
      addPipelineLog('error', `参考脚本文件过大:  ${(refFileInput.files[0].size/1024).toFixed(1)}KB，最大 100KB`);
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

    currentTestId = data.testId;
    currentFileName = data.fileName;
    addPipelineLog('success', `Script generated: ${data.fileName} (${data.script.split('\n').length} lines)`);
    if (data.notes) addPipelineLog('warn', `AI notes: ${data.notes.replace(/\n/g, ' | ').slice(0, 500)}`);
    displayGeneratedScript(data);

    // Step 3: Run test once
    addPipelineLog('system', '--- Starting test execution ---');
    const runResult = await runScriptOnce(data.script, data.fileName);

    if (runResult.success) {
      addPipelineLog('success', '✅ Test completed successfully');
      statusEl.textContent = '✅ 测试通过';
    } else {
      addPipelineLog('error', '❌ Test failed');
      statusEl.textContent = '❌ 测试失败';
    }
  } catch (err) {
    addPipelineLog('error', err.message);
    statusEl.textContent = '❌ ' + err.message;
  } finally {
    document.getElementById('genBtn').disabled = false;
  }
});

function displayGeneratedScript(data) {
  currentScript = data.script || '';
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
  checkWorkerHealth();
}

// Copy button
document.getElementById('genCopyBtn').addEventListener('click', () => {
  const text = currentScript;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('genCopyBtn');
    btn.textContent = '已复制';
    setTimeout(() => btn.textContent = '复制代码', 1500);
  });
});

// Download button
document.getElementById('genDownloadBtn').addEventListener('click', () => {
  const text = currentScript;
  const name = currentFileName || 'generated-test.js';
  const blob = new Blob([text], { type: 'application/javascript' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
});

// Trajectory prompt clear button
document.getElementById('trajPromptClearBtn').addEventListener('click', () => {
  document.getElementById('trajPromptContent').textContent = '';
  document.getElementById('trajPromptCard').style.display = 'none';
});

// Refine button
document.getElementById('genRefineBtn').addEventListener('click', async () => {
  const feedback = document.getElementById('genFeedback').value.trim();
  if (!currentTestId) { alert('没有可执行的脚本'); return; }
  if (!feedback) { alert('请输入修改反馈'); return; }

  const refineStatus = document.getElementById('genRefineStatus');
  refineStatus.textContent = '正在重新生成...';
  refineStatus.style.color = 'var(--sky-500)';
  document.getElementById('genRefineBtn').disabled = true;

  addPipelineLog('step', 'Refining script with feedback: ' + feedback.slice(0, 80));

  let refineSessionId = null;

  try {
    const res = await fetch('/api/test/refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testId: currentTestId, feedback, model: document.getElementById('genModel').value || undefined }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Refinement failed');

    refineSessionId = data.sessionId;
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

// ====== Run on PC (test execution, merged into server) ======
const WORKER_URL = '';

async function checkWorkerHealth() {
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

let workerEventSource = null;

document.getElementById('genRunBtn').addEventListener('click', async () => {
  const script = currentScript;
  if (!script) { alert('没有可执行的脚本'); return; }

  // Reset UI
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
      body: JSON.stringify({ script, fileName: currentFileName || 'test.js' }),
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

            case 'result':
              const resultDiv = document.getElementById('genRunResult');
              resultDiv.style.display = 'block';
              if (data.success) {
                resultDiv.style.background = 'var(--emerald-50)';
                resultDiv.style.color = 'var(--emerald-700)';
                resultDiv.textContent = `✅ 测试通过 (exit code: ${data.exitCode})`;
                document.getElementById('genRunDot').style.background = 'var(--emerald-400)';
              } else {
                resultDiv.style.background = 'var(--red-50)';
                resultDiv.style.color = 'var(--red-600)';
                const errMsg = data.error ? ': ' + data.error : '';
                resultDiv.textContent = `❌ 测试失败 (exit code: ${data.exitCode})${errMsg}`;
                document.getElementById('genRunDot').style.background = 'var(--red-400)';
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

// Screenshot viewer for worker images
function viewScreenshot(url) {
  const overlay = document.getElementById('imageOverlay');
  const img = document.getElementById('overlayImage');
  img.src = url;
  overlay.classList.add('open');
}

// Check worker health every 15s
setInterval(checkWorkerHealth, 15000);

// ====== History Management ======
async function loadHistory() {
  const loading = document.getElementById('historyLoading');
  const empty = document.getElementById('historyEmpty');
  const list = document.getElementById('historyList');
  const body = document.getElementById('historyBody');

  loading.style.display = 'block';
  empty.style.display = 'none';
  list.style.display = 'none';

  try {
    const res = await fetch('/api/test/history');
    const data = await res.json();
    loading.style.display = 'none';

    if (!data.length) {
      empty.style.display = 'block';
      return;
    }

    list.style.display = 'block';
    body.innerHTML = data.map(r => `
      <tr style="border-bottom:1px solid var(--slate-100)">
        <td style="padding:8px;font-family:var(--font-mono);font-size:11px">${escapeHtml(r.fileName)}</td>
        <td style="padding:8px;color:var(--slate-600)">${escapeHtml(r.description || '').slice(0, 40)}</td>
        <td style="padding:8px;color:var(--slate-400)">${r.stepCount || 0}</td>
        <td style="padding:8px;color:var(--slate-400);font-size:11px">${formatTime(r.createdAt)}</td>
        <td style="padding:8px;text-align:right">
          <button class="btn btn-outline btn-sm hist-view" data-id="${r.testId}" style="margin-right:4px">查看</button>
          <button class="btn btn-outline btn-sm hist-dl" data-id="${r.testId}" data-file="${r.fileName}" style="margin-right:4px">下载</button>
          <button class="btn btn-outline btn-sm hist-del" data-id="${r.testId}" style="color:var(--red-500);border-color:var(--red-200)">删除</button>
        </td>
      </tr>
    `).join('');

    // Bind history buttons
    body.querySelectorAll('.hist-view').forEach(b => b.addEventListener('click', () => viewHistory(b.dataset.id)));
    body.querySelectorAll('.hist-dl').forEach(b => b.addEventListener('click', () => downloadHistory(b.dataset.id, b.dataset.file)));
    body.querySelectorAll('.hist-del').forEach(b => b.addEventListener('click', () => deleteHistory(b.dataset.id)));
  } catch (err) {
    loading.style.display = 'none';
    empty.style.display = 'block';
    empty.innerHTML = '<p style="font-size:13px;color:var(--red-400)">加载失败: ' + err.message + '</p>';
  }
}

async function viewHistory(testId) {
  try {
    const res = await fetch('/api/test/history/' + testId);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Switch to generate tab and show the script
    document.querySelector('.tab-btn[data-tab="gen"]').click();
    currentTestId = data.testId;
    currentFileName = data.fileName;
    document.getElementById('genDesc').value = data.description || '';
    document.getElementById('genUrl').value = data.url || '';
    displayGeneratedScript(data);
    document.getElementById('genStatus').textContent = `📄  已加载 ${data.fileName}`;
  } catch (err) {
    alert('查看失败: ' + err.message);
  }
}

async function downloadHistory(testId, fileName) {
  try {
    const res = await fetch('/api/test/history/' + testId);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const blob = new Blob([data.script || ''], { type: 'application/javascript' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName || 'test-script.js';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    alert('下载失败: ' + err.message);
  }
}

async function deleteHistory(testId) {
  if (!confirm('确定删除这条记录？')) return;
  try {
    const res = await fetch('/api/test/history/' + testId, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error || 'Delete failed');
    loadHistory();
  } catch (err) {
    alert('删除失败: ' + err.message);
  }
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ====== Server Health ======
async function checkHealth() {
  try {
    const r = await fetch('/api/health');
    const data = await r.json();
    const dot = document.querySelector('#serverStatus .status-dot');
    dot.className = 'status-dot ' + (data.status === 'ok' ? 'online' : 'offline');
    document.getElementById('serverStatus').innerHTML = `<span class="status-dot ${data.status === 'ok' ? 'online' : 'offline'}"></span>${data.opencode}`;
    const agents = data.agents || [];
    document.getElementById('agentBadge').textContent = agents.length + ' agents';
    const skills = data.skills || [];
    document.getElementById('skillBadge').textContent = skills.length + ' skills';
  } catch (e) {
    document.getElementById('serverStatus').innerHTML = '<span class="status-dot offline"></span>Disconnected';
  }
}

// Independent model loader (separate from health check)
async function loadModels() {
  const genModel = document.getElementById('genModel');
  if (!genModel) return;
  try {
    const r = await fetch('/api/models');
    const data = await r.json();
    if (!data.models || !data.models.length) return;
    const currentVal = genModel.value;
    genModel.innerHTML = '<option value="">\u2014 Default \u2014</option>' +
      data.models.map(m => `<option value="${m.id}" ${m.id === data.defaultModel ? 'selected' : ''}>${m.provider} / ${m.name}</option>`).join('');
    if (currentVal && Array.from(genModel.options).some(o => o.value === currentVal)) genModel.value = currentVal;
  } catch (e) {
    console.error('Model load failed:', e);
  }
}

checkHealth();
loadModels();
setInterval(checkHealth, 10000);
setInterval(loadModels, 15000);

// ====== Trajectory History ======

let trajCurrentDetailId = null;

async function loadTrajectoryHistory() {
  const loading = document.getElementById('trajLoading');
  const empty = document.getElementById('trajEmpty');
  const list = document.getElementById('trajList');
  const body = document.getElementById('trajBody');
  const detail = document.getElementById('trajDetailPanel');

  loading.style.display = 'block';
  empty.style.display = 'none';
  list.style.display = 'none';
  if (detail) detail.style.display = 'none';
  trajCurrentDetailId = null;

  try {
    const res = await fetch('/api/trajectory');
    const data = await res.json();
    loading.style.display = 'none';

    if (!data.length) {
      empty.style.display = 'block';
      return;
    }

    list.style.display = 'block';
    body.innerHTML = data.map(r => {
      const statusBadge = r.isSuccessful === true
        ? '<span style="background:#ecfdf5;color:#065f46;padding:1px 8px;border-radius:10px;font-size:11px">Success</span>'
        : r.isSuccessful === false
          ? '<span style="background:#fef2f2;color:#991b1b;padding:1px 8px;border-radius:10px;font-size:11px">Failed</span>'
          : '<span style="color:var(--slate-400);font-size:11px">-</span>';
      return `
        <tr style="border-bottom:1px solid var(--slate-100)">
          <td style="padding:8px;font-family:var(--font-mono);font-size:11px;color:var(--indigo-600)" title="${escapeHtml(r.trajectoryId)}">${escapeHtml(r.trajectoryId.slice(0, 24))}...</td>
          <td style="padding:8px;color:var(--slate-600);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.task || '')}">${escapeHtml((r.task || '').slice(0, 60))}</td>
          <td style="padding:8px;color:var(--slate-500);font-size:12px">${r.stepCount || 0} / ${r.actionCount || 0}</td>
          <td style="padding:8px">${statusBadge}</td>
          <td style="padding:8px;color:var(--slate-400);font-size:11px">${formatTime(r.createdAt)}</td>
          <td style="padding:8px;text-align:right;white-space:nowrap">
            <button class="btn btn-outline btn-sm traj-view" data-id="${escapeHtml(r.trajectoryId)}" style="margin-right:4px">View</button>
            <button class="btn btn-outline btn-sm traj-sendgen" data-id="${escapeHtml(r.trajectoryId)}" style="margin-right:4px">Send to Script Gen</button>
            <button class="btn btn-outline btn-sm traj-del" data-id="${escapeHtml(r.trajectoryId)}" style="color:var(--red-500);border-color:var(--red-200)">Delete</button>
          </td>
        </tr>`;
    }).join('');

    body.querySelectorAll('.traj-view').forEach(b => b.addEventListener('click', () => viewTrajectoryDetail(b.dataset.id)));
    body.querySelectorAll('.traj-sendgen').forEach(b => b.addEventListener('click', () => sendToScriptGen(b.dataset.id)));
    body.querySelectorAll('.traj-del').forEach(b => b.addEventListener('click', () => deleteTrajectory(b.dataset.id)));
  } catch (err) {
    loading.style.display = 'none';
    empty.style.display = 'block';
    empty.innerHTML = '<p style="font-size:13px;color:var(--red-400)">Load failed: ' + err.message + '</p>';
  }
}

async function viewTrajectoryDetail(trajectoryId) {
  const detail = document.getElementById('trajDetailPanel');
  const idSpan = document.getElementById('trajDetailId');
  const info = document.getElementById('trajDetailInfo');
  const summary = document.getElementById('trajDetailSummary');
  const jsonPre = document.getElementById('trajDetailJson');
  const sendBtn = document.getElementById('trajSendToGenBtn');
  const modelSelect = document.getElementById('trajDetailModel');

  trajCurrentDetailId = trajectoryId;
  idSpan.textContent = trajectoryId;
  detail.style.display = '';
  jsonPre.textContent = '';

  if (modelSelect.options.length <= 1) {
    try {
      const r = await fetch('/api/models');
      const d = await r.json();
      const models = d.models || [];
      modelSelect.innerHTML = '<option value="">Default</option>' +
        models.map(m => `<option value="${m.id}">${m.provider} / ${m.name}</option>`).join('');
    } catch {}
  }

  try {
    const res = await fetch('/api/trajectory/' + trajectoryId);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    info.innerHTML = '<b>Task:</b> ' + escapeHtml(data.task || '') +
      ' | <b>Model:</b> ' + escapeHtml(data.model || '-') +
      ' | <b>Steps:</b> ' + (data.stepCount || 0) +
      ' | <b>Actions:</b> ' + (data.actionCount || 0) +
      ' | <b>Created:</b> ' + formatTime(data.createdAt);

    if (data.steps) {
      summary.innerHTML = data.steps.map(s =>
        `<div style="padding:2px 0"><span style="color:var(--slate-400);font-family:var(--font-mono);font-size:11px">#${s.step}</span> ${escapeHtml(s.goal)}</div>`
      ).join('');
    }

    fetch('/api/trajectory/' + trajectoryId + '?full=1').then(r => r.json()).then(d => {
      if (d.trajectory) jsonPre.textContent = JSON.stringify(d.trajectory, null, 2);
      else jsonPre.textContent = '(no trajectory data)';
    }).catch(() => {
      jsonPre.textContent = '(failed to load)';
    });
  } catch (err) {
    summary.textContent = 'Error: ' + err.message;
    console.error(err);
  }
}

async function sendToScriptGen(trajectoryId) {
  const genBtn = document.getElementById('trajSendToGenBtn');
  genBtn.disabled = true;
  genBtn.textContent = 'Loading...';

  try {
    const [basicRes, fullRes] = await Promise.all([
      fetch('/api/trajectory/' + trajectoryId),
      fetch('/api/trajectory/' + trajectoryId + '?full=1'),
    ]);
    const basic = await basicRes.json();
    const full = await fullRes.json();
    if (!basicRes.ok) throw new Error(basic.error);

    // Build compact table from trajectory flow
    let desc = '根据以下浏览器操作轨迹生成 Playwright 测试脚本。\n\n## 操作轨迹\n| # | 操作 | 目标 | 元素 | XPath | 标签 | 值 |\n|---|------|------|------|-------|------|------|\n';
    if (full.trajectory) {
      const history = full.trajectory.history || [];
      let row = 0;
      for (const h of history) {
        const mo = h.model_output;
        if (!mo) continue;
        const actions = mo.action || [];
        const goal = mo.current_state?.next_goal || '';
        for (let ai = 0; ai < actions.length; ai++) {
          const a = actions[ai];
          if (!a || typeof a !== 'object') continue;
          const type = Object.keys(a)[0];
          const p = a[type] || {};
          const el = (h.state?.interacted_element || [])[ai] || {};
          const xpath = el.xpath || '';
          const tag = el.tag_name || '';
          let label = p.label_text || p.label || '';
          let value = p.text || p.value || '';
          if (p.url) value = p.url;
          row++;
          desc += `| ${row} | ${type} | ${goal} | ${tag} | ${xpath || '-'} | ${label} | ${value} |\n`;
        }
      }
    } else {
      // Fallback: use basic steps
      const steps = basic.steps || [];
      for (const s of steps) {
        desc += `| ${s.step} | | ${s.goal} | | |\n`;
      }
    }

    const genTab = document.querySelector('.tab-btn[data-tab="gen"]');
    if (genTab) genTab.click();

    document.getElementById('trajPromptContent').textContent = desc;
    document.getElementById('trajPromptCard').style.display = '';
    document.getElementById('genDesc').value = '';
    document.getElementById('genUrl').value = '';
    document.getElementById('genScriptArea').style.display = 'none';
    document.getElementById('genSteps').style.display = 'none';
    document.getElementById('genInfo').style.display = 'none';
    document.getElementById('genRefineArea').style.display = 'none';
    document.getElementById('genRunArea').style.display = 'none';
    document.getElementById('genStatus').textContent = 'Ready — click Generate';
  } catch (err) {
    alert('Failed to load trajectory: ' + err.message);
  } finally {
    genBtn.disabled = false;
    genBtn.textContent = 'Send to Script Gen';
  }
}

async function deleteTrajectory(trajectoryId) {
  if (!confirm('Delete trajectory ' + trajectoryId.slice(0, 20) + '...?')) return;
  try {
    const res = await fetch('/api/trajectory/' + trajectoryId, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error || 'Delete failed');

    if (trajCurrentDetailId === trajectoryId) {
      document.getElementById('trajDetailPanel').style.display = 'none';
      trajCurrentDetailId = null;
    }
    loadTrajectoryHistory();
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}

// Refresh button
document.getElementById('trajRefreshBtn').addEventListener('click', loadTrajectoryHistory);

// Detail close button
document.getElementById('trajDetailCloseBtn').addEventListener('click', () => {
  document.getElementById('trajDetailPanel').style.display = 'none';
  trajCurrentDetailId = null;
});

// Execution Records - Refresh
document.getElementById('execRecordsRefreshBtn').addEventListener('click', loadExecutionRecords);

// Execution Record Detail close
document.getElementById('execRecordDetailCloseBtn').addEventListener('click', () => {
  document.getElementById('execRecordDetailPanel').style.display = 'none';
  execRecordCurrentId = null;
});

// Detail panel Send to Script Gen button
document.getElementById('trajSendToGenBtn').addEventListener('click', () => {
  if (trajCurrentDetailId) sendToScriptGen(trajCurrentDetailId);
});

// ====== AI Explore (Browser Use + Playwright Pipeline) ======

(function initAIExplore() {
  const exploreModel = document.getElementById('exploreModel');
  const exploreTask = document.getElementById('exploreTask');
  const exploreStartBtn = document.getElementById('exploreStartBtn');
  const exploreCancelBtn = document.getElementById('exploreCancelBtn');
  const exploreStatus = document.getElementById('exploreStatus');
  const exploreTimeline = document.getElementById('exploreTimeline');
  const exploreLogTerminal = document.getElementById('exploreLogTerminal');
  const exploreTrajectoryId = document.getElementById('exploreTrajectoryId');

  let exploreSSE = null;
  let exploreRunning = false;
  let exploreAbortController = null;

  function exploreLog(type, msg) {
    const line = document.createElement('div');
    line.className = 'log-line ' + type;
    line.innerHTML = '<span class="ts">' + ts() + '</span>' + msg.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    exploreLogTerminal.appendChild(line);
    exploreLogTerminal.scrollTop = exploreLogTerminal.scrollHeight;
  }

  function exploreStep(id, status, label, detail) {
    const emptyState = exploreTimeline.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const icons = {
      pending: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>',
      running: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
      failed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    };

    const existing = document.getElementById('explore-step-' + id);
    if (existing) {
      const dot = existing.querySelector('.timeline-dot');
      dot.className = 'timeline-dot ' + status;
      dot.innerHTML = icons[status] || icons.pending;
      const sl = existing.querySelector('.timeline-status');
      sl.className = 'timeline-status ' + (status === 'success' ? 'pass' : status === 'failed' ? 'fail' : status);
      sl.textContent = status.toUpperCase();
      existing.querySelector('.timeline-label-text').textContent = label;
      if (detail) {
        existing.querySelector('.timeline-detail').innerHTML = '<pre>' + detail + '</pre>';
        existing.querySelector('.timeline-detail').classList.add('open');
      }
      return;
    }

    const item = document.createElement('div');
    item.className = 'timeline-item';
    item.id = 'explore-step-' + id;
    item.innerHTML = `
      <div class="timeline-dot ${status}">${icons[status]}</div>
      <div class="timeline-content">
        <div class="timeline-label">
          <span class="timeline-label-text">${label}</span>
          <span class="timeline-status ${status === 'success' ? 'pass' : status === 'failed' ? 'fail' : status}">${status.toUpperCase()}</span>
        </div>
        <div class="timeline-detail${detail ? ' open' : ''}">${detail ? '<pre>' + detail + '</pre>' : ''}</div>
      </div>`;
    exploreTimeline.appendChild(item);
  }

  // Load models on page init
  async function loadExploreModels() {
    try {
      const r = await fetch('/api/models');
      const data = await r.json();
      exploreModel.innerHTML = '';
      const sessModelEl = document.getElementById('sessModel');
      const models = data.models || [];
      if (models.length === 0) {
        exploreModel.innerHTML = '<option value="">No models available</option>';
        if (sessModelEl) sessModelEl.innerHTML = '<option value="">No models</option>';
        return;
      }
      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.id;
        if (m.id === data.defaultModel) opt.selected = true;
        exploreModel.appendChild(opt);
        if (sessModelEl) {
          const opt2 = document.createElement('option');
          opt2.value = m.id;
          opt2.textContent = m.id;
          if (m.id === data.defaultModel) opt2.selected = true;
          sessModelEl.appendChild(opt2);
        }
      });
      exploreStartBtn.disabled = false;
    } catch (e) {
      exploreModel.innerHTML = '<option value="">Failed to load models</option>';
      const sessModelEl = document.getElementById('sessModel');
      if (sessModelEl) sessModelEl.innerHTML = '<option value="">Failed</option>';
    }
  }

  // Start exploration
  exploreStartBtn.addEventListener('click', async () => {
    const model = exploreModel.value;
    const task = exploreTask.value.trim();
    if (!task) return;

    // Reset UI
    exploreRunning = true;
    exploreStartBtn.disabled = true;
    exploreCancelBtn.disabled = false;
    exploreTrajectoryId.textContent = '';
    exploreTimeline.innerHTML = '';
    exploreLogTerminal.innerHTML = '';
    exploreLog('system', 'Starting exploration...');


    exploreStep('init', 'running', 'Starting Browser Use Agent', 'Task: ' + task.slice(0, 100));

    exploreAbortController = new AbortController();

    try {
      const response = await fetch('/api/browser-use/explore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, task }),
        signal: exploreAbortController.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'HTTP ' + response.status }));
        exploreLog('error', err.error || 'Request failed');
        exploreStatus.textContent = 'Failed';
        exploreRunning = false;
        exploreStartBtn.disabled = false;
        exploreCancelBtn.disabled = true;
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const parseSSE = (text) => {
        const lines = text.split('\n');
        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              handleSSEEvent(eventType, data);
            } catch (e) {}
            eventType = '';
          }
        }
      };

      const handleSSEEvent = (type, data) => {
        switch (type) {
          case 'status':
            exploreStatus.textContent = data.label;
            if (data.phase === 'explore_done') {
              exploreStep('init', 'success', 'Exploration complete', (data.steps || '') + ' steps recorded');
            }
            if (data.phase === 'workflow' && data.currentPhase) {
              exploreStep('phase-' + data.currentPhase, 'running', 'Phase ' + data.currentPhase + '/' + data.totalPhases, data.label.replace(/^.*?: /, ''));
            }
            if (data.phase === 'error') {
              exploreStep('error', 'error', 'Error', data.label);
            }
            break;

          case 'step':
            const stepId = 'browser-step-' + data.step;
            const actions = (data.actions || []).join(', ');
            exploreStep(stepId, 'running', 'Step ' + data.step, actions ? 'Actions: ' + actions : data.next_goal || '');
            exploreLog('info', 'Step ' + data.step + ': ' + (data.next_goal || actions || 'thinking...'));
            exploreStatus.textContent = 'Step ' + data.step + ': ' + data.next_goal;
            break;

          case 'phase_start':
            exploreLog('system', '▶ Phase ' + data.phase + '/' + data.total + ': ' + data.name);
            exploreStep('phase-' + data.phase, 'running', 'Phase ' + data.phase + '/' + data.total, data.name);
            break;

          case 'phase_done':
            exploreLog('success', '✓ Phase ' + data.phase + '/' + data.total + ' done: ' + data.name);
            exploreStep('phase-' + data.phase, 'success', '✓ Phase ' + data.phase + '/' + data.total, data.name);
            break;

          case 'phase_error':
            exploreLog('error', '✗ Phase ' + data.phase + ' failed: ' + (data.message || ''));
            exploreStep('phase-' + data.phase, 'error', '✗ Phase ' + data.phase + ' failed', data.message || '');
            break;

          case 'workflow_done':
            exploreLog('system', 'All ' + data.total_phases + ' phases completed');
            exploreStep('wf-done', 'success', 'Workflow complete', data.total_phases + ' phases executed');
            break;

          case 'trajectory':
            exploreTrajectoryId.textContent = 'Trajectory: ' + data.trajectoryId;
            exploreLog('system', 'Trajectory saved: ' + data.trajectoryId + ' (' + data.actions + ' actions)');
            exploreStep('traj', 'success', 'Trajectory saved', data.trajectoryId + ' | ' + data.actions + ' actions');
            break;

          case 'done':
            exploreRunning = false;
            exploreStartBtn.disabled = false;
            exploreCancelBtn.disabled = true;

            if (data.success && data.trajectoryId) {
              exploreTrajectoryId.textContent = 'Trajectory: ' + data.trajectoryId;
              exploreStatus.textContent = 'Exploration complete';
              exploreLog('success', 'Trajectory saved: ' + data.trajectoryId);
            } else if (data.success && data.phase === 'explore_only') {
              exploreStatus.textContent = data.message || 'Complete';
              exploreLog('success', data.message || 'All phases done');
            } else {
              exploreStatus.textContent = 'Failed';
              exploreLog('error', data.message || 'Exploration failed');
            }
            break;

          case 'error':
            const msg = data.message || 'Unknown error';
            exploreLog('error', msg);
            exploreStatus.textContent = 'Error: ' + msg.slice(0, 40);
            if (exploreRunning) {
              exploreRunning = false;
              exploreStartBtn.disabled = false;
              exploreCancelBtn.disabled = true;
            }
            break;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!exploreRunning) { reader.cancel(); break; }

        buffer += decoder.decode(value, { stream: true });
        // Process complete SSE frames (separated by \n\n)
        const parts = buffer.split('\n\n');
        buffer = parts.pop(); // keep incomplete last part

        for (const part of parts) {
          if (part.trim()) parseSSE(part + '\n');
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return; // user cancelled
      exploreLog('error', err.message);
      exploreStatus.textContent = 'Connection error';
      if (exploreRunning) {
        exploreRunning = false;
        exploreStartBtn.disabled = false;
        exploreCancelBtn.disabled = true;
      }
    }
  });

  // Cancel
  exploreCancelBtn.addEventListener('click', () => {
    if (exploreAbortController) {
      exploreAbortController.abort();
      exploreAbortController = null;
    }
    exploreRunning = false;
    exploreStartBtn.disabled = false;
    exploreCancelBtn.disabled = true;
    exploreStatus.textContent = 'Cancelled';
    exploreLog('system', 'Exploration cancelled by user');
  });

  // Load models on page load
  if (exploreModel) loadExploreModels();

})();

// ====== Multi-Turn Session Mode ======
(function initSessionMode() {
  const sessNewBtn = document.getElementById('sessNewBtn');
  const sessLoadBtn = document.getElementById('sessLoadBtn');
  const sessStepBtn = document.getElementById('sessStepBtn');
  const sessTrajBtn = document.getElementById('sessTrajBtn');
  const sessResetTrajBtn = document.getElementById('sessResetTrajBtn');
  const sessCancelBtn = document.getElementById('sessCancelBtn');
  const sessArchiveBtn = document.getElementById('sessArchiveBtn');
  const sessTask = document.getElementById('sessTask');
  const sessModel = document.getElementById('sessModel');
  const sessMaxSteps = document.getElementById('sessMaxSteps');
  const sessActive = document.getElementById('sessActive');
  const sessStatus = document.getElementById('sessStatus');
  const sessTimeline = document.getElementById('sessTimeline');
  const sessStepCount = document.getElementById('sessStepCount');
  const sessTrajectoryId = document.getElementById('sessTrajectoryId');
  const sessTrajPath = document.getElementById('sessTrajPath');
  const exploreLogTerminal = document.getElementById('exploreLogTerminal');

  if (!sessNewBtn) return;

  let sessAbortController = null;
  let sessRunning = false;
  let sessionPhases = [];

  function sessLog(type, msg) {
    const line = document.createElement('div');
    line.className = 'log-line ' + type;
    line.innerHTML = '<span class="ts">' + ts() + '</span>' + msg.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    if (exploreLogTerminal) {
      exploreLogTerminal.appendChild(line);
      exploreLogTerminal.scrollTop = exploreLogTerminal.scrollHeight;
    }
  }

  function sessTimelineStep(id, status, label, detail) {
    if (!sessTimeline) return;
    const emptyState = sessTimeline.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const icons = {
      pending: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>',
      running: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
      failed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    };

    let existing = document.getElementById('sess-ti-' + id);
    if (!existing) {
      existing = document.createElement('div');
      existing.className = 'timeline-item';
      existing.id = 'sess-ti-' + id;
      sessTimeline.appendChild(existing);
    }
    existing.innerHTML = '<div class="timeline-dot ' + status + '">' + (icons[status] || icons.pending) + '</div>' +
      '<div class="timeline-content"><div class="timeline-label">' + escapeHtml(label) + '</div>' +
      (detail ? '<div class="timeline-detail open"><pre>' + escapeHtml(detail) + '</pre></div>' : '') +
      '<div class="timeline-status ' + (status === 'success' ? 'pass' : status === 'failed' ? 'fail' : 'running') + '">' + status + '</div></div>';
  }

  function updateButtons() {
    const active = sessActive.value;
    const hasSession = !!active;
    sessStepBtn.disabled = !hasSession || sessRunning;
    sessTrajBtn.disabled = !hasSession || sessRunning;
    if (sessResetTrajBtn) sessResetTrajBtn.disabled = !hasSession || sessRunning;
    sessCancelBtn.disabled = !sessRunning;
    sessArchiveBtn.disabled = !hasSession || sessRunning;
    sessNewBtn.disabled = sessRunning;
    if (sessLoadBtn) sessLoadBtn.disabled = !hasSession || sessRunning;
    if (!hasSession) sessStatus.textContent = 'No active session';
  }

  function parseExplorePhases(text) {
    const phaseRegex = /【阶段(\d+)[：:]\s*(.+?)】/g;
    const phases = [];
    let prefix = '';
    phaseRegex.lastIndex = 0;
    const firstMatch = phaseRegex.exec(text);
    if (firstMatch) {
      prefix = text.slice(0, firstMatch.index).trim();
    }
    phaseRegex.lastIndex = 0;
    let match;
    const matches = [];
    while ((match = phaseRegex.exec(text)) !== null) {
      matches.push({ num: parseInt(match[1]), name: match[2].trim(), index: match.index, endIndex: phaseRegex.lastIndex });
    }
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const contentStart = m.endIndex;
      const contentEnd = i + 1 < matches.length ? matches[i + 1].index : text.length;
      let content = text.slice(contentStart, contentEnd).trim();
      if (i === 0 && prefix) content = prefix + '\n\n' + content;
      content = content.replace(/^\d+[\.\)、]\s*截图[^：:\n]*$/gm, '').trim();

      const navPhases = ['登录', '导航'];
      const isNav = navPhases.some(kw => m.name.includes(kw));
      phases.push({
        num: m.num,
        name: 'Phase ' + m.num + ': ' + m.name,
        task: content,
        maxSteps: isNav ? 50 : 40,
        status: 'pending',
      });
    }
    return phases;
  }

  function renderPhasePlan(phases) {
    const plan = document.getElementById('sessPhasePlan');
    const list = document.getElementById('sessPhaseList');
    const countEl = document.getElementById('sessPhaseCount');
    if (!plan || !list) return;
    if (!phases || phases.length === 0) { plan.style.display = 'none'; sessionPhases = []; return; }
    plan.style.display = 'block';
    sessionPhases = phases;
    countEl.textContent = phases.length + ' phases';
    list.innerHTML = phases.map((p, i) => {
      const shortTask = p.task.length > 150 ? p.task.slice(0, 150) + '...' : p.task;
      return '<div class="sess-phase-item" style="border:1px solid var(--slate-200);border-radius:var(--radius-sm);padding:12px;margin-bottom:8px;background:var(--slate-50)">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
        '<strong style="font-size:13px;color:var(--slate-700)">' + escapeHtml(p.name) + '</strong>' +
        '<div style="display:flex;gap:6px;align-items:center">' +
        '<span class="sess-phase-status" data-index="' + i + '" style="font-size:11px;color:var(--slate-400)">' + p.status + '</span>' +
        '<button class="btn btn-sm btn-primary sess-phase-exec" data-index="' + i + '" style="font-size:11px">Execute</button>' +
        '</div></div>' +
        '<pre style="font-size:11px;color:var(--slate-500);white-space:pre-wrap;max-height:80px;overflow:auto;margin:0;font-family:var(--font-mono)">' + escapeHtml(shortTask) + '</pre>' +
        '<div style="font-size:10px;color:var(--slate-400);margin-top:4px">Max steps: ' + p.maxSteps + '</div></div>';
    }).join('');
    list.querySelectorAll('.sess-phase-exec').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        const phase = phases[idx];
        if (!phase) return;
        if (!sessActive.value) { sessLog('error', 'No active session'); return; }
        executeSessionStep(sessActive.value, phase.task, phase.maxSteps, phase.name, idx);
      });
    });
  }

  function sessPhaseUpdateStatus(idx, status) {
    const list = document.getElementById('sessPhaseList');
    if (!list) return;
    const el = list.querySelector('.sess-phase-status[data-index="' + idx + '"]');
    if (!el) return;
    const colors = { running: 'var(--indigo-500)', success: 'var(--green-500)', failed: 'var(--red-500)', pending: 'var(--slate-400)' };
    el.textContent = status;
    el.style.color = colors[status] || 'var(--slate-400)';
    const execBtn = list.querySelector('.sess-phase-exec[data-index="' + idx + '"]');
    if (execBtn && (status === 'success' || status === 'failed')) execBtn.textContent = status === 'success' ? 'Re-run' : 'Retry';
  }

  async function executeSessionStep(sessionId, task, maxSteps, label, phaseIdx) {
    sessRunning = true;
    updateButtons();
    sessStatus.textContent = 'Executing...';
    const stepNum = (parseInt(sessStepCount.textContent) || 0) + 1;
    sessStepCount.textContent = stepNum + ' steps';
    sessTimelineStep('step-' + stepNum, 'running', label, task.slice(0, 80));
    sessLog('system', 'Step ' + stepNum + ': ' + label);
    if (phaseIdx !== undefined) sessPhaseUpdateStatus(phaseIdx, 'running');

    sessAbortController = new AbortController();
    try {
      const resp = await fetch('/api/browser/session/' + sessionId + '/step', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: task, maxSteps }),
        signal: sessAbortController.signal,
      });
      if (!resp.ok) { const err = await resp.json().catch(() => ({ error: 'HTTP ' + resp.status })); throw new Error(err.error || 'Request failed'); }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const parseSSE = (text) => {
        const lines = text.split('\n');
        let evt = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) evt = line.slice(7).trim();
          else if (line.startsWith('data: ') && evt) {
            try {
              const d = JSON.parse(line.slice(6));
              switch (evt) {
                case 'step': sessLog('info', 'Step ' + d.step + ': ' + (d.next_goal || (d.actions || []).join(', '))); break;
                case 'phase_start': sessLog('system', 'Started: ' + d.name); break;
                case 'phase_done':
                  sessLog('success', 'Completed: ' + label);
                  sessTimelineStep('step-' + stepNum, 'success', label, 'Done');
                  if (phaseIdx !== undefined) sessPhaseUpdateStatus(phaseIdx, 'success');
                  if (sessTrajPath && d.cumulative_file) {
                    sessTrajPath.style.display = 'block';
                    sessTrajPath.textContent = 'Trajectory: ' + d.cumulative_file;
                  }
                  setTimeout(() => loadActiveSessions(), 300);
                  break;
                case 'phase_error': case 'error':
                  sessLog('error', d.message || 'Error');
                  sessTimelineStep('step-' + stepNum, 'failed', label, d.message || '');
                  if (phaseIdx !== undefined) sessPhaseUpdateStatus(phaseIdx, 'failed');
                  break;
                case 'nav_step': sessLog('info', 'Nav: ' + d.label); break;
                case 'done': sessLog('system', 'Finished'); break;
              }
            } catch (e) {}
            evt = '';
          }
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!sessRunning) { reader.cancel(); break; }
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) { if (part.trim()) parseSSE(part + '\n'); }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        sessLog('system', 'Cancelled');
        sessTimelineStep('step-' + stepNum, 'failed', label, 'Cancelled');
        if (phaseIdx !== undefined) sessPhaseUpdateStatus(phaseIdx, 'failed');
      } else {
        sessLog('error', err.message);
        sessTimelineStep('step-' + stepNum, 'failed', label, err.message.slice(0, 100));
        if (phaseIdx !== undefined) sessPhaseUpdateStatus(phaseIdx, 'failed');
      }
    }
    sessRunning = false;
    sessAbortController = null;
    updateButtons();
  }

  window.loadActiveSessions = async function () {
    if (!sessActive) return;
    try {
      const res = await fetch('/api/browser/sessions');
      const list = await res.json();
      const currentVal = sessActive.value;
      sessActive.innerHTML = '<option value="">(none)</option>';
      list.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.sessionId;
        const short = s.sessionId.slice(0, 8);
        const busy = s.busy ? ' [busy]' : '';
        opt.textContent = short + '... [' + s.stepIndex + ']' + busy + ' ' + (s.model || '').slice(0, 20);
        sessActive.appendChild(opt);
      });
      if (currentVal && Array.from(sessActive.options).some(o => o.value === currentVal)) {
        sessActive.value = currentVal;
      }
      if (sessCloseBrowserBtn) sessCloseBrowserBtn.style.display = list.length > 0 ? '' : 'none';
      onSessionChange();
      return list;
    } catch (e) {
      console.error('Failed to load sessions:', e);
    }
  };

  function onSessionChange() {
    const active = sessActive.value;
    if (!active) {
      sessStatus.textContent = 'No active session';
      sessTrajectoryId.textContent = '';
      if (sessTrajPath) { sessTrajPath.style.display = 'none'; sessTrajPath.textContent = ''; }
      sessStepCount.textContent = '0 steps';
      sessTimeline.innerHTML = '<div class="empty-state" style="padding:20px"><p>Send a step instruction to begin</p></div>';
      document.getElementById('sessPhasePlan').style.display = 'none';
      sessionPhases = [];
      updateButtons();
      return;
    }
    fetch('/api/browser/session/' + active + '/trajectories').then(r => r.json()).then(data => {
      sessStatus.textContent = 'Active ' + active.slice(0, 8) + '... | ' + data.stepIndex + ' steps' + (data.busy ? ' (busy)' : '');
      sessStepCount.textContent = data.stepIndex + ' steps';
      if (sessTimeline && data.steps && data.steps.length > 0) {
        sessTimeline.innerHTML = '';
        data.steps.forEach(s => {
          const time = s.time ? new Date(s.time).toLocaleString() : '';
          sessTimelineStep('step-' + s.step, 'success', 'Step ' + s.step, time);
        });
      }
      updateButtons();
      if (data.busy) {
        sessStepBtn.disabled = true;
        sessCancelBtn.disabled = false;
      }
    }).catch(() => {
      sessStatus.textContent = 'Session gone (exited)';
      sessActive.value = '';
      updateButtons();
    });
  }

  sessActive.addEventListener('change', onSessionChange);

  sessNewBtn.addEventListener('click', async () => {
    const model = sessModel.value;
    sessNewBtn.disabled = true;
    sessStatus.textContent = 'Creating...';
    sessLog('system', 'Creating new session...');
    try {
      const res = await fetch('/api/browser/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      const data = await res.json();
      sessLog('success', 'Session created: ' + data.sessionId);
      await loadActiveSessions();
      sessActive.value = data.sessionId;
      onSessionChange();
    } catch (err) {
      sessLog('error', 'Create session failed: ' + err.message);
      sessStatus.textContent = 'Creation failed';
    }
    sessNewBtn.disabled = false;
    updateButtons();
  });

  sessLoadBtn.addEventListener('click', async () => {
    const sessionId = sessActive.value;
    const caseText = sessTask.value.trim();
    if (!sessionId) { sessLog('error', 'No active session — create one first'); return; }
    if (!caseText || !caseText.includes('【阶段')) {
      sessLog('warn', 'No phase markers found. Use 【阶段N：名称】 format in the textarea.');
      return;
    }

    // Reset cumulative trajectory for new test case
    sessLog('system', 'Clearing old trajectory...');
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const r = await fetch('/api/browser/session/' + sessionId + '/reset-trajectory', { method: 'POST' });
        if (r.status === 409) {
          sessLog('system', 'Browser busy, retrying in 2s... (' + (attempt + 1) + '/5)');
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        break;
      }
    } catch (e) { /* non-critical */ }

    // 1. Preserve executed phases (success/failed) from current cards
    const preservedMap = {};
    sessionPhases.forEach((p, i) => {
      if (p.status !== 'pending') preservedMap[p.num] = p;
    });
    const keptCount = Object.keys(preservedMap).length;

    // 2. Parse new phases from text — only import those not already executed
    const newPhases = parseExplorePhases(caseText);
    const merged = [];
    newPhases.forEach(p => {
      if (preservedMap[p.num] !== undefined) {
        merged.push(preservedMap[p.num]); // keep executed phase as-is
      } else {
        merged.push(p); // import new/updated phase as pending
      }
    });

    // 3. Append any preserved phases whose num no longer exists in new text
    const newNums = new Set(newPhases.map(p => p.num));
    Object.values(preservedMap).forEach(p => {
      if (!newNums.has(p.num)) merged.push(p);
    });

    // Sort by phase num
    merged.sort((a, b) => a.num - b.num);

    renderPhasePlan(merged);
    const imported = merged.length - keptCount - (Object.values(preservedMap).filter(p => !newNums.has(p.num)).length);
    sessLog('system', 'Loaded: ' + keptCount + ' preserved, ' + Math.max(0, merged.length - keptCount) + ' imported (' + merged.length + ' total)');
  });

  sessStepBtn.addEventListener('click', () => {
    const sessionId = sessActive.value;
    const task = sessTask.value.trim();
    const maxSteps = parseInt(sessMaxSteps.value) || 40;
    if (!sessionId || !task) return;
    executeSessionStep(sessionId, task, maxSteps, task.slice(0, 60));
  });

  sessCancelBtn.addEventListener('click', () => {
    if (sessAbortController) { sessAbortController.abort(); sessAbortController = null; }
    sessRunning = false;
    sessLog('system', 'Step cancelled');
    updateButtons();
  });

  sessTrajBtn.addEventListener('click', async () => {
    const sessionId = sessActive.value;
    if (!sessionId) return;
    if (!confirm('Save current trajectory to the trajectory store? This will persist the recorded actions.')) return;
    sessTrajBtn.disabled = true;
    sessLog('system', 'Saving trajectory...');
    try {
      const res = await fetch('/api/browser/session/' + sessionId + '/trajectory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: sessTask.value || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Server error');
      const data = await res.json();
      sessTrajectoryId.textContent = 'Traj: ' + data.trajectoryId.slice(0, 12) + '...';
      sessLog('success', 'Trajectory saved: ' + data.trajectoryId + ' (' + data.actions + ' actions)');
    } catch (err) {
      sessLog('error', 'Save trajectory failed: ' + err.message);
    }
    sessTrajBtn.disabled = false;
  });

  sessResetTrajBtn.addEventListener('click', async () => {
    const sessionId = sessActive.value;
    if (!sessionId) return;
    if (!confirm('Reset trajectory recording? A new cumulative trajectory file will be created. Old one stays in /tmp/.')) return;
    sessResetTrajBtn.disabled = true;
    sessLog('system', 'Resetting trajectory recording...');
    try {
      let res, data;
      for (let attempt = 0; attempt < 5; attempt++) {
        res = await fetch('/api/browser/session/' + sessionId + '/reset-trajectory', { method: 'POST' });
        if (res.status === 409) {
          sessLog('system', 'Browser busy, retrying in 2s... (' + (attempt + 1) + '/5)');
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        break;
      }
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || 'Server error');
      data = await res.json();
      if (sessTrajPath && data.cumulative_file) {
        sessTrajPath.style.display = 'block';
        sessTrajPath.textContent = 'Trajectory: ' + data.cumulative_file;
      }
      sessLog('success', 'New trajectory file: ' + (data.cumulative_file || 'ready'));
    } catch (err) {
      sessLog('error', 'Reset failed: ' + err.message);
    }
    sessResetTrajBtn.disabled = false;
  });

  sessArchiveBtn.addEventListener('click', async () => {
    const sessionId = sessActive.value;
    if (!sessionId) return;
    if (!confirm('Archive session ' + sessionId.slice(0, 12) + '... to execution records?')) return;
    sessArchiveBtn.disabled = true;
    sessLog('system', 'Archiving session...');
    try {
      const res = await fetch('/api/browser/session/' + sessionId, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Server error');
      sessLog('success', 'Archived: ' + sessionId);
      sessActive.value = '';
      onSessionChange();
      await loadActiveSessions();
    } catch (err) {
      sessLog('error', 'Archive failed: ' + err.message);
    }
    sessArchiveBtn.disabled = false;
    updateButtons();
  });

  document.getElementById('exploreClearLogBtn').addEventListener('click', () => {
    if (exploreLogTerminal) exploreLogTerminal.innerHTML = '<div class="log-line system"><span class="ts">&#9889;</span>Cleared</div>';
  });

  const sessCloseBrowserBtn = document.getElementById('sessCloseBrowserBtn');
  if (sessCloseBrowserBtn) {
    sessCloseBrowserBtn.addEventListener('click', async () => {
      if (!confirm('Close global browser? All sessions will be cleared.')) return;
      sessLog('system', 'Closing global browser...');
      try {
        await fetch('/api/browser/browser', { method: 'DELETE' });
        sessLog('success', 'Browser closed');
        sessActive.innerHTML = '<option value="">(none)</option>';
        onSessionChange();
      } catch (err) {
        sessLog('error', 'Close failed: ' + err.message);
      }
    });
  }

  setTimeout(() => loadActiveSessions(), 500);
  setInterval(() => loadActiveSessions(), 5000);
})();

// ====== Animated Particle Background ======
(function initParticleBackground() {
  const canvas = document.getElementById('bgCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let width, height;
  let particles = [];
  const PARTICLE_COUNT = Math.min(70, Math.floor(window.innerWidth / 22));
  const CONNECTION_DIST = 150;
  const MOUSE_DIST = 220;

  let mouse = { x: null, y: null };

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }

  class Particle {
    constructor() {
      this.x = Math.random() * width;
      this.y = Math.random() * height;
      this.vx = (Math.random() - 0.5) * 0.35;
      this.vy = (Math.random() - 0.5) * 0.35;
      this.size = Math.random() * 2.2 + 0.8;
      const colors = [
        '99,102,241',   // indigo-500
        '129,140,248',  // indigo-400
        '56,189,248',   // sky-400
        '96,165,250',   // blue-400
        '139,92,246',   // violet-500
      ];
      this.color = colors[Math.floor(Math.random() * colors.length)];
    }

    update() {
      this.x += this.vx;
      this.y += this.vy;

      if (this.x < 0 || this.x > width) this.vx *= -1;
      if (this.y < 0 || this.y > height) this.vy *= -1;

      if (mouse.x != null && mouse.y != null) {
        const dx = this.x - mouse.x;
        const dy = this.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MOUSE_DIST && dist > 0) {
          const force = (MOUSE_DIST - dist) / MOUSE_DIST;
          this.vx += (dx / dist) * force * 0.015;
          this.vy += (dy / dist) * force * 0.015;
        }
      }

      const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
      if (speed > 1.0) {
        this.vx = (this.vx / speed) * 1.0;
        this.vy = (this.vy / speed) * 1.0;
      }
    }

    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${this.color}, 0.45)`;
      ctx.fill();
    }
  }

  function init() {
    resize();
    particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push(new Particle());
    }
  }

  function drawConnections() {
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < CONNECTION_DIST) {
          const opacity = (1 - dist / CONNECTION_DIST) * 0.18;
          ctx.beginPath();
          ctx.strokeStyle = `rgba(99,102,241,${opacity})`;
          ctx.lineWidth = 0.8;
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }
  }

  function animate() {
    ctx.clearRect(0, 0, width, height);

    particles.forEach(p => {
      p.update();
      p.draw();
    });

    drawConnections();
    requestAnimationFrame(animate);
  }

  window.addEventListener('resize', () => {
    resize();
    init();
  });

  window.addEventListener('mousemove', e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });

  window.addEventListener('mouseleave', () => {
    mouse.x = null;
    mouse.y = null;
  });

  init();
  animate();
})();

// ====== Execution Records ======
let execRecordCurrentId = null;

async function loadExecutionRecords() {
  const loading = document.getElementById('execRecordsLoading');
  const empty = document.getElementById('execRecordsEmpty');
  const list = document.getElementById('execRecordsList');
  const body = document.getElementById('execRecordsBody');
  const detail = document.getElementById('execRecordDetailPanel');

  loading.style.display = 'block';
  empty.style.display = 'none';
  list.style.display = 'none';
  detail.style.display = 'none';
  execRecordCurrentId = null;

  try {
    const res = await fetch('/api/browser/session/execution-records');
    const records = await res.json();

    loading.style.display = 'none';

    if (!records || records.length === 0) {
      empty.style.display = 'block';
      return;
    }

    list.style.display = 'block';
    body.innerHTML = records.map(r => {
      const stepCount = r.stepIndex || r.steps?.length || 0;
      const created = r.createdAt ? new Date(r.createdAt).toLocaleString() : '-';
      const archived = r.archivedAt ? new Date(r.archivedAt).toLocaleString() : '-';
      const shortId = r.sessionId?.slice(0, 8) || '???';
      return `<tr style="border-bottom:1px solid var(--slate-100)">
        <td style="padding:8px;font-family:var(--font-mono);font-size:11px;color:var(--indigo-600)" title="${escapeHtml(r.sessionId)}">${escapeHtml(shortId)}...</td>
        <td style="padding:8px">${escapeHtml(r.model || '-')}</td>
        <td style="padding:8px">${stepCount}</td>
        <td style="padding:8px;font-size:12px;color:var(--slate-500)">${escapeHtml(created)}</td>
        <td style="padding:8px;font-size:12px;color:var(--slate-500)">${escapeHtml(archived)}</td>
        <td style="padding:8px">
          <button class="btn btn-outline btn-sm exec-record-view" data-id="${escapeHtml(r.sessionId)}" style="margin-right:4px">Review</button>
          <button class="btn btn-outline btn-sm exec-record-continue" data-id="${escapeHtml(r.sessionId)}" title="Create a new session to continue from this record" style="margin-right:4px;color:var(--green-600);border-color:var(--green-300)">Continue</button>
          <button class="btn btn-outline btn-sm exec-record-del" data-id="${escapeHtml(r.sessionId)}" style="color:var(--red-500);border-color:var(--red-200)">Delete</button>
        </td>
      </tr>`;
    }).join('');

    body.querySelectorAll('.exec-record-view').forEach(btn => {
      btn.addEventListener('click', () => viewExecutionRecord(btn.dataset.id));
    });
    body.querySelectorAll('.exec-record-continue').forEach(btn => {
      btn.addEventListener('click', () => continueExecutionRecord(btn.dataset.id));
    });
    body.querySelectorAll('.exec-record-del').forEach(btn => {
      btn.addEventListener('click', () => deleteExecutionRecord(btn.dataset.id));
    });
  } catch (err) {
    loading.style.display = 'none';
    empty.style.display = 'block';
    empty.innerHTML = `<p style="color:var(--red-500)">Failed to load: ${escapeHtml(err.message)}</p>`;
  }
}

async function viewExecutionRecord(sessionId) {
  const detail = document.getElementById('execRecordDetailPanel');
  const idSpan = document.getElementById('execRecordDetailId');
  const info = document.getElementById('execRecordDetailInfo');
  const stepsDiv = document.getElementById('execRecordSteps');

  execRecordCurrentId = sessionId;
  idSpan.textContent = sessionId.slice(0, 12) + '...';
  detail.style.display = 'block';
  info.textContent = 'Loading...';
  stepsDiv.textContent = '';

  try {
    const res = await fetch('/api/browser/session/execution-record/' + sessionId);
    if (!res.ok) throw new Error('Record not found');
    const r = await res.json();

    const created = r.createdAt ? new Date(r.createdAt).toLocaleString() : '-';
    const archived = r.archivedAt ? new Date(r.archivedAt).toLocaleString() : '-';
    info.innerHTML = `
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:4px 8px;color:var(--slate-500);width:100px">Session ID</td><td style="padding:4px 8px;font-family:var(--font-mono);font-size:12px">${escapeHtml(r.sessionId)}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--slate-500)">Model</td><td style="padding:4px 8px">${escapeHtml(r.model || '-')}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--slate-500)">Steps</td><td style="padding:4px 8px">${r.stepIndex || 0}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--slate-500)">Created</td><td style="padding:4px 8px">${escapeHtml(created)}</td></tr>
        <tr><td style="padding:4px 8px;color:var(--slate-500)">Archived</td><td style="padding:4px 8px">${escapeHtml(archived)}</td></tr>
      </table>
    `;

    if (r.steps && r.steps.length > 0) {
      stepsDiv.innerHTML = '<div style="padding:4px 0">' + r.steps.map((s, i) => {
        const time = s.time ? new Date(s.time).toLocaleString() : '-';
        return `<div style="padding:6px 12px;border-left:2px solid var(--indigo-200);margin-bottom:4px">
          <strong>Step ${i + 1}</strong>
          <span style="font-size:12px;color:var(--slate-500);margin-left:8px">${escapeHtml(time)}</span>
          <span style="font-size:11px;color:var(--slate-400);margin-left:8px;font-family:var(--font-mono)">${escapeHtml(s.path || '')}</span>
        </div>`;
      }).join('') + '</div>';
    } else {
      stepsDiv.textContent = 'No step history recorded.';
    }
  } catch (err) {
    info.textContent = 'Error: ' + err.message;
  }
}

async function continueExecutionRecord(sessionId) {
  try {
    const res = await fetch('/api/browser/session/execution-record/' + sessionId);
    if (!res.ok) throw new Error('Record not found');
    const record = await res.json();

    const createRes = await fetch('/api/browser/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: record.model || undefined }),
    });
    if (!createRes.ok) throw new Error('Failed to create session');
    const newSession = await createRes.json();

    document.querySelector('.tab-btn[data-tab="explore"]').click();

    const exploreTask = document.getElementById('exploreTask');
    const prefix = record.steps?.length > 0
      ? `[Continuing from archived session ${sessionId.slice(0, 8)}..., previously completed ${record.stepIndex} steps]\n\n`
      : '';
    exploreTask.value = prefix + (exploreTask.value || '');

    alert(`New session created: ${newSession.sessionId.slice(0, 12)}...\nSwitch to AI Explore tab to send steps.\nModel: ${newSession.model}`);
  } catch (err) {
    alert('Failed to continue: ' + err.message);
  }
}

async function deleteExecutionRecord(sessionId) {
  if (!confirm('Permanently delete execution record ' + sessionId.slice(0, 12) + '...?')) return;
  try {
    const res = await fetch('/api/browser/session/execution-record/' + sessionId, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    if (execRecordCurrentId === sessionId) {
      document.getElementById('execRecordDetailPanel').style.display = 'none';
      execRecordCurrentId = null;
    }
    loadExecutionRecords();
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
}
