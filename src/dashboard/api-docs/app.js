/**
 * Swagger-like product API docs UI.
 * Open: /api/docs
 */
import { API_GROUPS, ENUMS, RECORDING_FLOW, BATCH_RECORDING_FLOW } from './catalog.js';
import { mountSlotMonitor } from './slot-monitor.js';

const $ = (sel, el = document) => el.querySelector(sel);

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function methodClass(m) {
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'WS'].includes(m) ? m : 'GET';
}

function buildUrl(ep, root, pathVals, queryVals) {
  let path = ep.path;
  for (const [k, v] of Object.entries(pathVals)) {
    if (v) path = path.replace(`{${k}}`, encodeURIComponent(v));
  }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(queryVals)) {
    if (v !== '' && v != null) qs.set(k, v);
  }
  const q = qs.toString();
  return q ? `${path}?${q}` : path;
}

function isHttpMethod(m) {
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m);
}

function renderOverview(container) {
  const base = `${location.protocol}//${location.host}`;
  container.innerHTML = `
    <div class="docs-intro">
      <h3>给前端的产品 API</h3>
      <p>本文档覆盖 <code>/api/v2/*</code> 与 <code>/ws</code>。工程调试接口（<code>/api/test</code>、<code>/api/browser</code>）不在此列。</p>
      <p>Base URL：<code>${escapeHtml(base)}</code> · 通用错误体：<code>{ "error": "..." }</code></p>
      <h3 style="margin-top:16px">统一响应信封</h3>
      <ul>
        <li>成功：<code>{ "code": 200, "message": "ok", "data": &lt;payload&gt; }</code></li>
        <li>鉴权失败：<code>{ "code": 401|403, "message": "&lt;原因&gt;", "data": null }</code></li>
        <li>错误：<code>{ "code": 5**, "message": "&lt;原因&gt;", "data": null }</code>（额外字段如 holders 放在 data）</li>
        <li>body <code>code</code> 约定：<strong>200</strong> 成功 · <strong>4**</strong> 鉴权失败 · <strong>5**</strong> 错误。原 HTTP 400/404/409 等在 body.code 中统一为 500。</li>
        <li>系统树 <code>data</code> 为<strong>嵌套树</strong>：子节点统一在 <code>children[]</code>（type：1 系统 / 2 模块 / 3 功能）。</li>
        <li>系统树 <code>GET /tree</code>：<code>data</code> 恒为 <code>[{ id:0, type:0, children:[系统…] }]</code>；筛选参数 <code>name</code> / <code>type</code>；无命中亦返回根（children 为空）。</li>
        <li>系统节点可带 <code>url</code>（系统地址）；由原账号 <code>loginUrl</code> 转储至 <code>system.url</code>，登录优先用系统 url。</li>
        <li>类型常量：<code>GET /api/v2/system-mgmt/meta</code> → <code>data.typeMap</code>。</li>
      </ul>
      <h3 style="margin-top:16px">推荐录制流程</h3>
      <div class="docs-flow">
        ${RECORDING_FLOW.map((s, i) => `<div class="docs-flow-step">${i + 1}. ${escapeHtml(s)}</div>`).join('')}
      </div>
      <h3 style="margin-top:16px">批量 Excel 导入录制</h3>
      <div class="docs-flow">
        ${BATCH_RECORDING_FLOW.map((s, i) => `<div class="docs-flow-step">${i + 1}. ${escapeHtml(s)}</div>`).join('')}
      </div>
      <h3 style="margin-top:16px">关键语义</h3>
      <ul>
        <li><code>record/stop</code> 只改 <code>recordStatus</code>，<strong>不</strong>释放执行机槽位。</li>
        <li>断开画面 <code>POST .../stream/detach</code> 只停推流（remote_session→idle，live→draft），<strong>不</strong>关浏览器。</li>
        <li>离开录制工作室<strong>不</strong>自动 detach；AI 可后台继续录。无步骤写入超过 2 小时由服务端自动回收。</li>
        <li><code>POST .../detach</code> 关闭会话并杀死 Chrome、释放槽位（手动释放执行资源）。</li>
        <li>多交易并行：推流按 <code>trajectoryId</code> / <code>remote_session.id</code> 隔离，互不串扰。</li>
        <li><code>record/prepare</code> 优先复用 live session / 空闲 CDP Chrome；无资源返回 409 + holders。登录不写入 <code>trajectory_step</code>。</li>
        <li>回放由服务端组装 Playwright 脚本，客户端只收 <code>replay:*</code> 进度，不拿 JS 源码。</li>
        <li>旧路径 <code>/api/trajectory</code>、<code>/api/case-data</code> → <strong>410 Gone</strong>。</li>
      </ul>
      <h3 style="margin-top:16px">常用枚举</h3>
      <div class="docs-enums">
        ${ENUMS.map((e) => `<div class="docs-enum"><strong>${escapeHtml(e.name)}</strong>${escapeHtml(e.values)}</div>`).join('')}
      </div>
    </div>
  `;
}

function paramsTable(params) {
  if (!params?.length) return '';
  const rows = params.map((p) => `
    <tr>
      <td><code>${escapeHtml(p.name)}</code></td>
      <td>${escapeHtml(p.type)}</td>
      <td>${p.required ? '<span class="req">必填</span>' : '<span class="opt">可选</span>'}</td>
      <td><span class="loc">${escapeHtml(p.in || 'body')}</span></td>
      <td>${escapeHtml(p.desc || '')}${p.example ? ` <code>${escapeHtml(p.example)}</code>` : ''}</td>
    </tr>
  `).join('');
  return `
    <div class="ep-h">Parameters</div>
    <table class="ep-table">
      <thead><tr><th>名称</th><th>类型</th><th>必填</th><th>位置</th><th>说明</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function trySectionHtml(ep) {
  if (ep.tryable === false || !isHttpMethod(ep.method)) {
    return '<div class="try-box"><span style="font-size:12px;color:var(--docs-muted)">此接口不支持在线调试</span></div>';
  }
  const pathParams = (ep.params || []).filter((p) => p.in === 'path');
  const queryParams = (ep.params || []).filter((p) => p.in === 'query');
  const needsBody = ['POST', 'PUT', 'PATCH'].includes(ep.method);

  return `
    <div class="try-box">
      <button type="button" class="btn ep-try-toggle">Try it out</button>
      <div class="try-area" hidden>
        ${needsBody || ep.reqExample ? `
          <label class="try-label">Request Body（可编辑 JSON）</label>
          <textarea class="ep-editor" rows="7">${escapeHtml(ep.reqExample || '{}')}</textarea>
        ` : ''}
        ${pathParams.length ? `
          <label class="try-label">Path Parameters</label>
          ${pathParams.map((p) => `
            <div class="try-row">
              <code>${escapeHtml(p.name)}</code>
              <input class="ep-param-path" data-param="${escapeHtml(p.name)}" placeholder="${escapeHtml(p.example || '')}" />
              ${p.required ? '<span class="req">必填</span>' : '<span class="opt">可选</span>'}
            </div>
          `).join('')}
        ` : ''}
        ${queryParams.length ? `
          <label class="try-label">Query Parameters</label>
          ${queryParams.map((p) => `
            <div class="try-row">
              <code>${escapeHtml(p.name)}</code>
              <input class="ep-param-query" data-param="${escapeHtml(p.name)}" placeholder="${escapeHtml(p.example || '')}" />
              ${p.required ? '<span class="req">必填</span>' : '<span class="opt">可选</span>'}
            </div>
          `).join('')}
        ` : ''}
        <div class="try-actions">
          <button type="button" class="btn btn-primary ep-execute">Execute</button>
          <button type="button" class="btn ep-try-cancel">Cancel</button>
          <span class="try-curl ep-curl"></span>
        </div>
        <div class="ep-response" hidden>
          <div class="try-resp-meta ep-response-meta"></div>
          <pre class="ep-pre ep-response-body"></pre>
        </div>
      </div>
    </div>
  `;
}

function wireTry(epEl, ep) {
  const toggle = $('.ep-try-toggle', epEl);
  const area = $('.try-area', epEl);
  const cancel = $('.ep-try-cancel', epEl);
  const exec = $('.ep-execute', epEl);
  if (!toggle || !area) return;

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !area.hidden;
    area.hidden = open;
    toggle.textContent = open ? 'Try it out' : '关闭';
  });
  cancel?.addEventListener('click', (e) => {
    e.stopPropagation();
    area.hidden = true;
    toggle.textContent = 'Try it out';
  });

  exec?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const pathVals = {};
    const queryVals = {};
    epEl.querySelectorAll('.ep-param-path').forEach((inp) => { pathVals[inp.dataset.param] = inp.value.trim(); });
    epEl.querySelectorAll('.ep-param-query').forEach((inp) => { queryVals[inp.dataset.param] = inp.value.trim(); });

    const url = buildUrl(ep, location.origin, pathVals, queryVals);
    if (/\{[^}]+\}/.test(url)) {
      alert('请填写所有路径参数');
      return;
    }

    const options = { method: ep.method, headers: {} };
    let bodyObj = null;
    const editor = $('.ep-editor', epEl);
    if (editor && ['POST', 'PUT', 'PATCH'].includes(ep.method)) {
      try {
        bodyObj = JSON.parse(editor.value || '{}');
      } catch {
        const resp = $('.ep-response', epEl);
        const meta = $('.ep-response-meta', epEl);
        const body = $('.ep-response-body', epEl);
        resp.hidden = false;
        meta.innerHTML = '<span class="err">400</span> 请求体 JSON 无效';
        body.textContent = '请修正 Request Body';
        return;
      }
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(bodyObj);
    }

    const curl = $('.ep-curl', epEl);
    if (curl) {
      curl.textContent = bodyObj
        ? `curl -X ${ep.method} "${url}" -H "Content-Type: application/json" -d '${JSON.stringify(bodyObj)}'`
        : `curl -X ${ep.method} "${url}"`;
    }

    exec.disabled = true;
    exec.textContent = '执行中…';
    const resp = $('.ep-response', epEl);
    const meta = $('.ep-response-meta', epEl);
    const body = $('.ep-response-body', epEl);
    try {
      const res = await fetch(url, options);
      const text = await res.text();
      resp.hidden = false;
      const cls = res.ok ? 'ok' : 'err';
      meta.innerHTML = `<span class="${cls}">${res.status}</span> ${escapeHtml(res.statusText)} · ${(new Blob([text]).size / 1024).toFixed(1)} KB`;
      if (!text) {
        body.textContent = res.status === 204 ? '(No Content)' : '';
      } else {
        try { body.textContent = JSON.stringify(JSON.parse(text), null, 2); }
        catch { body.textContent = text; }
      }
    } catch (err) {
      resp.hidden = false;
      meta.innerHTML = '<span class="err">错误</span>';
      body.textContent = err.message;
    } finally {
      exec.disabled = false;
      exec.textContent = 'Execute';
    }
  });
}

function renderEndpoint(ep) {
  const el = document.createElement('div');
  el.className = 'ep';
  el.dataset.path = ep.path.toLowerCase();
  el.dataset.summary = (ep.summary || '').toLowerCase();
  el.dataset.method = ep.method;

  el.innerHTML = `
    <div class="ep-head">
      <span class="ep-method ${methodClass(ep.method)}">${escapeHtml(ep.method)}</span>
      <span class="ep-path">${escapeHtml(ep.path)}</span>
      <span class="ep-summary">${escapeHtml(ep.summary)}</span>
      <svg class="ep-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    </div>
    <div class="ep-body">
      ${ep.desc ? `<div class="ep-desc">${escapeHtml(ep.desc)}</div>` : ''}
      ${ep.notes?.length ? `<ul class="ep-notes">${ep.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''}
      ${paramsTable(ep.params)}
      ${ep.reqExample ? `<div class="ep-h">Request body</div><pre class="ep-pre">${escapeHtml(ep.reqExample)}</pre>` : ''}
      ${ep.respExample ? `<div class="ep-h">Response example</div><pre class="ep-pre">${escapeHtml(ep.respExample)}</pre>` : ''}
      ${trySectionHtml(ep)}
    </div>
  `;

  $('.ep-head', el).addEventListener('click', () => {
    el.classList.toggle('open');
  });
  wireTry(el, ep);
  return el;
}

function renderGroup(group) {
  const wrap = document.createElement('section');
  wrap.id = `group-${group.id}`;
  wrap.dataset.group = group.id;

  if (group.id === 'overview') {
    wrap.innerHTML = `<h2 class="docs-section-title">概览</h2>`;
    const box = document.createElement('div');
    renderOverview(box);
    wrap.appendChild(box);
    return wrap;
  }

  if (group.monitor || group.id === 'slot-monitor') {
    mountSlotMonitor(wrap);
    return wrap;
  }

  wrap.innerHTML = `
    <h2 class="docs-section-title">${escapeHtml(group.name)}</h2>
    <p class="docs-section-desc">${escapeHtml(group.description || '')}</p>
  `;
  for (const ep of group.endpoints) {
    wrap.appendChild(renderEndpoint(ep));
  }
  return wrap;
}

function initNav() {
  const nav = $('#docsNav');
  nav.innerHTML = '';
  for (const g of API_GROUPS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'docs-nav-item';
    btn.dataset.target = g.id;
    const count = g.endpoints?.length || 0;
    const badge = g.monitor ? '<span class="count">live</span>' : (count ? `<span class="count">${count}</span>` : '');
    btn.innerHTML = `${escapeHtml(g.name)}${badge}`;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.docs-nav-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const el = document.getElementById(`group-${g.id}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    nav.appendChild(btn);
  }
  nav.querySelector('.docs-nav-item')?.classList.add('active');
}

function initSearch() {
  const input = $('#docsSearch');
  input?.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll('.ep').forEach((ep) => {
      if (!q) {
        ep.style.display = '';
        return;
      }
      const hit =
        ep.dataset.path.includes(q) ||
        ep.dataset.summary.includes(q) ||
        ep.dataset.method.toLowerCase().includes(q);
      ep.style.display = hit ? '' : 'none';
    });
  });
}

function main() {
  $('#baseUrlDisplay').textContent = `${location.protocol}//${location.host}`;
  const content = $('#docsContent');
  content.innerHTML = '';
  for (const g of API_GROUPS) {
    content.appendChild(renderGroup(g));
  }
  initNav();
  initSearch();
}

main();
