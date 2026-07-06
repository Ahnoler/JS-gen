// Swagger-style API Reference
// Extracted from test-dashboard.js (swaggerEndpoints data + renderSwaggerUI + escapeHtml)

export const swaggerEndpoints = [
  {
    method: 'GET', color: 'var(--emerald-600)', bg: 'var(--emerald-100)',
    path: '/api/health',
    summary: '服务器健康检查与状态',
    desc: '返回当前服务器健康状态、OpenCode 连接状态、可用智能体和技能。',
    params: [],
    respExample: JSON.stringify({ status: 'ok', opencode: 'connected', agents: [{ name: 'build', description: '...' }], skills: [{ name: 'playwright-skill', description: '...' }] }, null, 2),
  },
  {
    method: 'GET', color: 'var(--emerald-600)', bg: 'var(--emerald-100)',
    path: '/api/agents',
    summary: '列出可用智能体',
    desc: '返回 OpenCode 系统中所有可用 AI 智能体的列表。',
    params: [],
    respExample: JSON.stringify({ agents: [{ name: 'build', description: 'The default agent' }] }, null, 2),
  },
  {
    method: 'GET', color: 'var(--emerald-600)', bg: 'var(--emerald-100)',
    path: '/api/skills',
    summary: '列出可用技能',
    desc: '返回所有可用技能的名称、描述和内容。',
    params: [],
    respExample: JSON.stringify({ skills: [{ name: 'playwright-skill', description: 'Browser automation skill', content: '...' }] }, null, 2),
  },
  {
    method: 'POST', color: 'var(--indigo-600)', bg: 'var(--indigo-100)',
    path: '/api/agent/execute',
    summary: '执行智能体任务 (JSON)',
    desc: '向指定智能体发送任务并返回响应，可选择加载技能作为上下文。',
    contentType: 'application/json',
    reqExample: JSON.stringify({ agent: 'general', task: 'Explain what opencode is', system: 'Answer in Chinese', skill: 'playwright-skill', model: { providerID: 'myprovider', modelID: 'GLM-5' } }, null, 2),
    respExample: JSON.stringify({ sessionId: 'ses_xxx', response: 'opencode is...', partCount: 4 }, null, 2),
    buildRequest(path, bodyObj) { return { url: path, options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj) } }; },
  },
  {
    method: 'POST', color: 'var(--indigo-600)', bg: 'var(--indigo-100)',
    path: '/api/agent/execute-async',
    summary: '即发即忘智能体任务',
    desc: '向智能体发送任务并立即返回，不等待完成。',
    contentType: 'application/json',
    reqExample: JSON.stringify({ agent: 'general', task: 'Long running task...' }, null, 2),
    respExample: JSON.stringify({ sessionId: 'ses_xxx', status: 'accepted' }, null, 2),
    buildRequest(path, bodyObj) { return { url: path, options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj) } }; },
  },
  {
    method: 'POST', color: 'var(--indigo-600)', bg: 'var(--indigo-100)',
    path: '/api/agent/session',
    summary: '创建新会话',
    desc: '创建新的 OpenCode 会话用于与 AI 智能体交互。',
    contentType: 'application/json',
    reqExample: JSON.stringify({ title: 'My Session', agent: 'build' }, null, 2),
    respExample: JSON.stringify({ sessionId: 'ses_xxx' }, null, 2),
    buildRequest(path, bodyObj) { return { url: path, options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj) } }; },
  },
  {
    method: 'POST', color: 'var(--indigo-600)', bg: 'var(--indigo-100)',
    path: '/api/agent/session/{id}/message',
    summary: '向会话发送消息',
    desc: '向已有会话发送新消息。将 {id} 替换为实际会话 ID。',
    contentType: 'application/json',
    params: [{ name: 'id', type: 'string', required: true, desc: '会话 ID', in: '路径', example: 'ses_xxx' }],
    reqExample: JSON.stringify({ agent: 'general', task: 'Continue the conversation...', system: '可选' }, null, 2),
    respExample: JSON.stringify({ sessionId: 'ses_xxx', response: 'Response text...' }, null, 2),
    buildRequest(path, bodyObj) { return { url: path, options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj) } }; },
  },
  {
    method: 'GET', color: 'var(--emerald-600)', bg: 'var(--emerald-100)',
    path: '/api/agent/session/{id}/messages',
    summary: '获取会话消息',
    desc: '检索会话中的所有消息。将 {id} 替换为实际会话 ID。',
    params: [{ name: 'id', type: 'string', required: true, desc: '会话 ID', in: '路径', example: 'ses_xxx' }],
    respExample: JSON.stringify([{ id: 'msg_xxx', role: 'assistant', parts: [{ type: 'text', text: '...' }] }], null, 2),
    buildRequest(path) { return { url: path, options: { method: 'GET' } }; },
  },
  {
    method: 'DELETE', color: 'var(--red-600)', bg: 'var(--red-100)',
    path: '/api/agent/session/{id}',
    summary: '删除会话',
    desc: '删除会话并永久移除所有关联数据。将 {id} 替换为实际会话 ID。',
    params: [{ name: 'id', type: 'string', required: true, desc: '会话 ID', in: '路径', example: 'ses_xxx' }],
    respExample: JSON.stringify({ status: 'deleted', sessionId: 'ses_xxx' }, null, 2),
    buildRequest(path) { return { url: path, options: { method: 'DELETE' } }; },
  },
  {
    method: 'SSE', color: 'var(--amber-600)', bg: 'var(--amber-100)',
    path: '/api/agent/execute-stream',
    summary: '流式智能体执行',
    desc: '通过 Server-Sent Events 连接，实时流式传输智能体执行进度、日志和部分文本响应。',
    params: [
      { name: 'agent', type: 'string', required: true, desc: '智能体名称', in: 'query', example: 'general' },
      { name: 'task', type: 'string', required: true, desc: '任务描述', in: 'query', example: 'Say hello' },
      { name: 'system', type: 'string', required: false, desc: '系统提示词覆盖', in: 'query' },
      { name: 'skill', type: 'string', required: false, desc: '要加载为上下文的技能名称', in: 'query' },
    ],
    respExample: 'event: step → { id, status, label }\nevent: log → { type, message }\nevent: text → { text }\nevent: result → { sessionId, response }\nevent: done → {}',
    buildRequest(path) { return { url: path, options: { method: 'GET' } }; },
  },
  {
    method: 'POST', color: 'var(--indigo-600)', bg: 'var(--indigo-100)',
    path: '/api/test/run',
    summary: '执行 Playwright 脚本 (SSE)',
    desc: '执行 Playwright 测试脚本并通过 Server-Sent Events 流式传输执行日志、截图和结果。',
    contentType: 'application/json',
    reqExample: JSON.stringify({ script: 'const { chromium } = require("playwright");\n(async () => { ... })()', fileName: 'my-test.js' }, null, 2),
    respExample: 'event: log → { type, message }\nevent: screenshots → { screenshots: [{ fileName, url }] }\nevent: result → { success, exitCode, stdout, stderr }\nevent: done → {}',
    buildRequest(path, bodyObj) { return { url: path, options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj) } }; },
  },
  {
    method: 'POST', color: 'var(--indigo-600)', bg: 'var(--indigo-100)',
    path: '/api/test/run-sync',
    summary: '执行 Playwright 脚本 (JSON)',
    desc: '执行 Playwright 测试脚本并以 JSON 格式返回结果（非流式）。',
    contentType: 'application/json',
    reqExample: JSON.stringify({ script: 'const { chromium } = require("playwright");\n(async () => { ... })()', fileName: 'my-test.js' }, null, 2),
    respExample: JSON.stringify({ success: true, exitCode: 0, stdout: '...', stderr: '', screenshots: [{ fileName: 'step1.png', url: '/api/test/screenshots/step1.png' }] }, null, 2),
    buildRequest(path, bodyObj) { return { url: path, options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj) } }; },
  },
];

export function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function createEndpointHeader(ep) {
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
  return header;
}

function createParamsSection(params) {
  if (!params || !params.length) return null;
  const section = document.createElement('div');
  section.style.cssText = 'margin-bottom:10px';
  section.innerHTML = '<div style="font-size:12px;font-weight:600;color:var(--slate-600);margin-bottom:6px">Parameters</div>';
  params.forEach(p => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;padding:4px 0;font-size:12px';
    row.innerHTML = `
      <code style="color:var(--slate-700);font-weight:500">${p.name}</code>
      <span style="color:var(--slate-400)">${p.type}</span>
      <span style="color:${p.required ? 'var(--red-500)' : 'var(--slate-400)'}">${p.required ? '必填' : '可选'}</span>
      <span style="color:var(--slate-400);flex:1">${p.desc}</span>
      ${p.example ? `<code style="color:var(--indigo-600);font-size:11px">Example: ${p.example}</code>` : ''}
      ${p.in === '路径' ? `<span style="background:var(--slate-100);color:var(--slate-500);padding:1px 6px;border-radius:4px;font-size:10px">path</span>` : ''}
    `;
    section.appendChild(row);
  });
  return section;
}

function createCodeBlock(label, code, contentType) {
  const section = document.createElement('div');
  section.style.cssText = 'margin-bottom:10px';
  const labelExtra = contentType ? ` <span style="font-weight:400;color:var(--slate-400)">${contentType}</span>` : '';
  section.innerHTML = `
    <div style="font-size:12px;font-weight:600;color:var(--slate-600);margin-bottom:6px">${label}${labelExtra}</div>
    <pre class="ep-example" style="background:var(--slate-800);color:#e2e8f0;padding:10px;border-radius:6px;font-size:12px;line-height:1.5;overflow-x:auto">${escapeHtml(code)}</pre>
  `;
  return section;
}

function createTrySection(ep) {
  const pathParams = (ep.params || []).filter(p => p.in === '路径');
  const queryParams = (ep.params || []).filter(p => p.in === 'query');

  const section = document.createElement('div');
  section.innerHTML = `
    <div style="padding-top:10px;border-top:1px solid var(--slate-100)">
      <button class="ep-try-btn btn btn-outline btn-sm">Try it out</button>
      <div class="ep-try-area" style="display:none;margin-top:10px">
        ${ep.reqExample ? `<div style="margin-bottom:8px"><label style="font-size:12px;font-weight:500;color:var(--slate-600);display:block;margin-bottom:4px">Request Body <span style="font-weight:400;color:var(--slate-400)">(editable JSON)</span></label>
          <textarea class="ep-editor" rows="6" style="width:100%;background:var(--slate-800);color:#e2e8f0;border:1px solid var(--slate-600);border-radius:6px;padding:8px;font-family:var(--font-mono);font-size:12px;resize:vertical">${escapeHtml(ep.reqExample)}</textarea></div>` : ''}
        ${pathParams.length ? `<div style="margin-bottom:8px"><label style="font-size:12px;font-weight:500;color:var(--slate-600);display:block;margin-bottom:4px">Path Parameters</label>
          ${pathParams.map(p => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px"><code style="color:var(--slate-700);font-size:12px;min-width:50px">{${p.name}}</code><input class="ep-param-path" data-param="${p.name}" placeholder="${p.example || ''}" style="flex:1;padding:4px 8px;border:1px solid var(--slate-300);border-radius:4px;font-size:12px;font-family:var(--font-mono)"><span style="font-size:10px;color:var(--slate-400);min-width:40px">${p.required ? '必填' : '可选'}</span></div>`).join('')}</div>` : ''}
        ${queryParams.length ? `<div style="margin-bottom:8px"><label style="font-size:12px;font-weight:500;color:var(--slate-600);display:block;margin-bottom:4px">Query Parameters</label>
          ${queryParams.map(p => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px"><code style="color:var(--slate-700);font-size:12px;min-width:50px">${p.name}</code><input class="ep-param-query" data-param="${p.name}" placeholder="${p.example || ''}" style="flex:1;padding:4px 8px;border:1px solid var(--slate-300);border-radius:4px;font-size:12px;font-family:var(--font-mono)"><span style="font-size:10px;color:var(--slate-400);min-width:40px">${p.required ? '必填' : '可选'}</span></div>`).join('')}</div>` : ''}
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

  wireTrySectionEvents(section, ep, pathParams, queryParams);
  return section;
}

function wireTrySectionEvents(section, ep, pathParams, queryParams) {
  const tryBtn = section.querySelector('.ep-try-btn');
  const tryArea = section.querySelector('.ep-try-area');
  const cancelBtn = section.querySelector('.ep-cancel-btn');

  tryBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = tryArea.style.display !== 'none';
    tryArea.style.display = isOpen ? 'none' : 'block';
    tryBtn.textContent = isOpen ? '试用' : '关闭';
  });

  cancelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    tryArea.style.display = 'none';
    tryBtn.textContent = '试用';
    tryBtn.style.display = 'inline-flex';
  });

  const execBtn = section.querySelector('.ep-execute-btn');
  const responseDiv = section.querySelector('.ep-response');
  const responseMeta = section.querySelector('.ep-response-meta');
  const responseBody = section.querySelector('.ep-response-body');
  const curlSpan = section.querySelector('.ep-curl');
  const editor = section.querySelector('.ep-editor');

  execBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    execBtn.disabled = true;
    execBtn.textContent = '执行中…';

    const { url, bodyObj, fetchOptions } = buildFetchRequest(ep, section, pathParams, queryParams, editor, responseDiv, responseMeta, responseBody, execBtn);
    if (!fetchOptions) return;

    showCurlEquivalent(curlSpan, bodyObj, fetchOptions);
    await executeRequest(fetchOptions, responseDiv, responseMeta, responseBody);

    execBtn.disabled = false;
    execBtn.textContent = '执行';
  });
}

function buildFetchRequest(ep, section, pathParams, queryParams, editor, responseDiv, responseMeta, responseBody, execBtn) {
  let resolvedPath = ep.path;

  for (const p of pathParams) {
    const input = section.querySelector(`.ep-param-path[data-param="${p.name}"]`);
    const val = input ? input.value.trim() : '';
    if (val) resolvedPath = resolvedPath.replace(`{${p.name}}`, val);
  }

  let url = resolvedPath;
  if (queryParams.length) {
    const qs = new URLSearchParams();
    for (const p of queryParams) {
      const input = section.querySelector(`.ep-param-query[data-param="${p.name}"]`);
      const val = input ? input.value.trim() : '';
      if (val) qs.set(p.name, val);
    }
    const qstr = qs.toString();
    if (qstr) url += '?' + qstr;
  }

  let bodyObj;
  let fetchOptions;
  if (ep.buildRequest) {
    if (editor) {
      try { bodyObj = JSON.parse(editor.value); }
      catch {
        responseDiv.style.display = 'block';
        responseMeta.textContent = '400 请求错误';
        responseBody.textContent = '请求体中的 JSON 无效';
        execBtn.disabled = false;
        execBtn.textContent = '执行';
        return {};
      }
      fetchOptions = ep.buildRequest(url, bodyObj);
    } else {
      fetchOptions = ep.buildRequest(url);
    }
  } else {
    fetchOptions = { url, options: { method: ep.method } };
  }

  return { url, bodyObj, fetchOptions };
}

function showCurlEquivalent(curlSpan, bodyObj, fetchOptions) {
  if (bodyObj) {
    curlSpan.textContent = `curl -X ${fetchOptions.options.method} "${fetchOptions.url}" -H "Content-Type: application/json" -d '${JSON.stringify(bodyObj)}'`;
  } else {
    curlSpan.textContent = `curl -X ${fetchOptions.options.method} "${fetchOptions.url}"`;
  }
}

async function executeRequest(fetchOptions, responseDiv, responseMeta, responseBody) {
  try {
    const res = await fetch(fetchOptions.url, fetchOptions.options);
    const text = await res.text();
    responseDiv.style.display = 'block';
    const statusColor = res.ok ? 'var(--emerald-500)' : 'var(--red-500)';
    responseMeta.innerHTML = `<span style="color:${statusColor};font-weight:600">${res.status}</span> ${res.statusText} <span style="color:var(--slate-400)">| ${(new Blob([text]).size / 1024).toFixed(1)} KB</span>`;
    try { responseBody.textContent = JSON.stringify(JSON.parse(text), null, 2); }
    catch { responseBody.textContent = text; }
  } catch (err) {
    responseDiv.style.display = 'block';
    responseMeta.textContent = '错误';
    responseBody.textContent = err.message;
  }
}

export function renderSwaggerUI() {
  const container = document.getElementById('apiEndpointsContainer');
  container.innerHTML = '';

  swaggerEndpoints.forEach((ep) => {
    const epDiv = document.createElement('div');
    epDiv.className = 'api-endpoint';
    epDiv.style.cssText = 'border:1px solid var(--slate-200);border-radius:10px;overflow:hidden';

    const header = createEndpointHeader(ep);

    const body = document.createElement('div');
    body.className = 'ep-body';
    body.style.cssText = 'display:none;padding:0 14px 14px;border-top:1px solid var(--slate-100)';

    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:13px;color:var(--slate-500);padding:10px 0;border-bottom:1px solid var(--slate-100);margin-bottom:10px';
    desc.textContent = ep.desc;
    body.appendChild(desc);

    const paramsSection = createParamsSection(ep.params);
    if (paramsSection) body.appendChild(paramsSection);

    if (ep.reqExample) body.appendChild(createCodeBlock('请求体', ep.reqExample, ep.contentType));
    if (ep.respExample) body.appendChild(createCodeBlock('Responses <code style="font-weight:400;font-size:11px;color:var(--emerald-600)">200</code>', ep.respExample));

    body.appendChild(createTrySection(ep));

    header.addEventListener('click', () => {
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : 'block';
      header.querySelector('.ep-chevron').style.transform = isOpen ? '' : 'rotate(90deg)';
    });

    epDiv.appendChild(header);
    epDiv.appendChild(body);
    container.appendChild(epDiv);
  });
}
