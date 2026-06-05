// Swagger-style API Reference
// Extracted from test-dashboard.js (swaggerEndpoints data + renderSwaggerUI + escapeHtml)

export const swaggerEndpoints = [
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
    respExample: 'event: step → { id, status, label }\nevent: log → { type, message }\nevent: text → { text }\nevent: result → { sessionId, response }\nevent: done → {}',
    buildRequest(path) { return { url: path, options: { method: 'GET' } }; },
  },
  {
    method: 'POST', color: 'var(--indigo-600)', bg: 'var(--indigo-100)',
    path: '/api/test/run',
    summary: 'Execute Playwright script (SSE)',
    desc: 'Executes a Playwright test script and streams execution logs, screenshots, and results via Server-Sent Events.',
    contentType: 'application/json',
    reqExample: JSON.stringify({ script: 'const { chromium } = require("playwright");\n(async () => { ... })()', fileName: 'my-test.js' }, null, 2),
    respExample: 'event: log → { type, message }\nevent: screenshots → { screenshots: [{ fileName, url }] }\nevent: result → { success, exitCode, stdout, stderr }\nevent: done → {}',
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

export function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

export function renderSwaggerUI() {
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
