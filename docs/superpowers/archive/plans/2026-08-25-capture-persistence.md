# 报文捞取 MVP — Capture Tool & Persistence (Tasks 7-10)

> Continuation of 2026-08-25-message-capture-mvp.md (Tasks 1-2) and 2026-08-25-rename-js-python.md (Tasks 3-6).

## Task 7: Create E2E API capture tool

Files:
- Create: scripts/tools/api-capture.mjs

Produces: standalone Playwright script that captures XHR/fetch request/response pairs to JSON files
Consumes: playwright npm package (already installed); PLAYWRIGHT_BROWSERS_PATH env var

- [ ] Step 1: Write api-capture.mjs

The script:
- Parses CLI args: --url (required), --filter (default "/api/"), --out (default "./samples/"), --headed (default "true"), --timeout (default "300000")
- Launches Chromium with chromium.launch({ headless: !HEADED, args: ['--ignore-certificate-errors'] })
- Creates context with ignoreHTTPSErrors: true
- Opens a page, navigates to --url
- Attaches page.on('response', async (response) => { ... }) listener
- For each XHR/fetch response matching --filter regex:
  - Captures: url, normalizedUrl (strip query, replace numeric IDs with {id}), method, request headers/body, response status/headers/body
  - JSON bodies auto-parsed; non-JSON truncated to 4KB
  - Writes individual JSON file per capture: {method}_{normalizedUrl}_{timestamp}.json
  - Prints to console: [N] METHOD normalizedUrl -> status (filename)
- After --timeout ms (or Ctrl+C), prints summary of unique interfaces captured and writes _summary.json
- Closes browser

Key functions:
- normalizeUrl(url): strip query/hash, replace /d+(?=/|$) with /{id}
- safeBody(bodyBytes): try JSON.parse, fallback to text truncated 4096 chars
- safeName(s): replace non-alphanumeric with underscore, truncate 80 chars

- [ ] Step 2: Test the tool manually

Run: node scripts/tools/api-capture.mjs --url https://httpbin.org --filter "/anything|/get|/post" --out ./samples/ --timeout 15000
Expected: Browser opens, navigates to httpbin.org, waits 15s, captures any XHR matching filter. Produces _summary.json with totalCaptured count (0 is OK if no XHR fires automatically).

- [ ] Step 3: Commit — "feat: add E2E API capture tool (scripts/tools/api-capture.mjs)"

---

## Task 8: Create network_capture.py — Python network listener

Files:
- Create: scripts/controller/actions/network_capture.py

Produces: attach_network_capture(page, business_data_store) — attaches response listener to a Playwright page; returns a cleanup function
Produces: _is_form_related(request, response) — filters form-related XHR/fetch
Produces: _normalize_url(url) — strips query, replaces numeric IDs with {id}
Consumes: emit_memory_event from scripts.memory.writer

- [ ] Step 1: Write network_capture.py

Module-level constants:
- _FORM_KEYWORDS = re.compile(r'/(form|save|load|query|submit|detail|create|update|delete|edit|add)', re.I)
- _EXCLUDE_PATTERN = re.compile(r'(heartbeat|poll|keepalive|/status|ping|health|metrics|/log)', re.I)

Functions:

def _is_form_related(request, response) -> bool:
  - Reject if request.resource_type not in ('xhr', 'fetch')
  - Reject if _EXCLUDE_PATTERN.search(url)
  - Accept if method in ('POST', 'PUT', 'DELETE', 'PATCH')
  - Accept if method == 'GET' and response content-type contains 'json' and _FORM_KEYWORDS.search(url)
  - Else reject

def _normalize_url(url: str) -> str:
  - Strip query string and hash
  - Replace /d+(?=/|$) with /{id}

def _safe_body(body_bytes):
  - Try JSON parse, fallback to text truncated 4096 chars

def attach_network_capture(page, business_data_store=None):
  - Import emit_memory_event from ...memory.writer
  - Define async def _on_response(response):
    - Get request = response.request
    - Check _is_form_related(request, response)
    - Await response.body() in try/except
    - Build entry dict: url, normalizedUrl, method, requestBody, responseStatus, responseBody, capturedAt
    - Call emit_memory_event('network_captured', entry)
  - Define sync _response_handler(response) that does asyncio.create_task(_on_response(response))
  - Register page.on('response', _response_handler)
  - Return cleanup function that calls page.remove_listener('response', _response_handler)

- [ ] Step 2: Verify module imports cleanly

Run: D:/anaconda3/envs/browser_use/python.exe -c "import sys; sys.path.insert(0, 'D:/dev/JS-gen'); from scripts.controller.actions.network_capture import _is_form_related, _normalize_url; print('OK'); print(_normalize_url('https://app.com/api/form/123/save?x=1'))"
Expected: prints OK and https://app.com/api/form/{id}/save

- [ ] Step 3: Commit — "feat: add network_capture.py — form-related XHR/fetch listener for recording"

---

## Task 9: Hook network listener into recording session + Node-side persistence

Files:
- Modify: scripts/session_runner.py
- Modify: src/memory/protocol.js
- Modify: src/memory/memory-service.js
- Modify: src/dao/system-ref-dao.js
- Modify: src/services/system-ref-service.js

Consumes: attach_network_capture from Task 8; emit_memory_event with network_captured event type; system-ref-dao save/list functions
Produces: network_captured event type in KNOWN_EVENT_TYPES; findByUrlPattern(urlPattern, method) DAO method; persistCapturedInterface(trajectoryId, payload) service method

- [ ] Step 1: Hook network listener into session_runner.py

After browser context creation and page is obtained (around line 216, after _ignore_certificate_errors etc.), add:
  from .controller.actions.network_capture import attach_network_capture
  page = await browser_context.get_current_page()
  _net_cleanup = attach_network_capture(page, business_data_store)

In the finally block (near line 466, before flush_memory_writer), add:
  try: _net_cleanup()
  except Exception: pass

- [ ] Step 2: Register network_captured event type in protocol.js

Line 8: add 'network_captured' to KNOWN_EVENT_TYPES set

- [ ] Step 3: Add findByUrlPattern to system-ref-dao.js

New export:
  export async function findByUrlPattern(urlPattern, method) {
    const db = getDB();
    const descPrefix = method + ' ' + urlPattern;
    const rows = await db(TABLE).where('description', 'like', descPrefix + '%').orderBy('created_at', 'desc').limit(1);
    return rows.length ? fromDbRow(rows[0]) : null;
  }

- [ ] Step 4: Add persistCapturedInterface to system-ref-service.js

New export:
  export async function persistCapturedInterface(trajectoryId, payload) {
    - Destructure normalizedUrl, method, requestBody, responseBody, responseStatus, url from payload
    - Check existing via systemRefDao.findByUrlPattern(normalizedUrl, method)
    - If existing: return { persisted: false, existingId: existing.id }
    - Extract top-level keys from requestBody (prefix req.) and responseBody (prefix resp.)
    - Each entry: fieldKey, fieldValue (truncated 500 chars), source 'system_capture', verificationStatus 'raw'
    - Call systemRefDao.save with: trajectoryId, recordId (sref_timestamp_random), source 'system_capture', description (method + ' ' + normalizedUrl), keyCount, rawJson, entries
    - Return { persisted: true, id }
  }

Add import * as systemRefDao from '../dao/system-ref-dao.js' at top if not already imported.

- [ ] Step 5: Handle network_captured event in memory-service.js

Inside ingestEvents, in the per-event loop (near line 213 where phase_done is handled), add a new branch:
  if (event.eventType === 'network_captured' && event.trajectoryId) {
    try {
      const { persistCapturedInterface } = await import('../system-ref-service.js');
      const result = await persistCapturedInterface(event.trajectoryId, event.payload || {});
      if (result.persisted) {
        console.log('[memory] network_captured persisted: ' + event.payload?.method + ' ' + event.payload?.normalizedUrl + ' -> system_ref_data#' + result.id);
      }
    } catch (err) {
      console.warn('[memory] network_captured persist failed:', err?.message || err);
    }
  }

- [ ] Step 6: Run verify-all — ALL GREEN

- [ ] Step 7: Commit — "feat: hook network capture into recording + persist network_captured events to system_ref_data"

---

## Task 10: Final CHANGELOG update and push

Files:
- Modify: CHANGELOG.md

- [ ] Step 1: Add remaining CHANGELOG entries

Add to [Unreleased] section (in addition to the rename entry from Task 6):

### Added
- 报文捞取 MVP 框架：录制时被动监听表单相关 XHR/fetch 接口（network_capture.py），通过 network_captured memory event 传回控制面，按 normalized_url + method 去重，全新接口写入 system_ref_data/system_ref_entry（仅表单相关接口，排除心跳/轮询/静态资源）。
  - Python 同步提示：新增 network_captured 事件类型（KNOWN_EVENT_TYPES 追加）；新增 findByUrlPattern DAO 方法；新增 persistCapturedInterface service 方法。
- E2E 接口抓取工具（scripts/tools/api-capture.mjs）：独立 Playwright 脚本，headed 模式手动操作触发真实接口，捕获完整请求/响应格式输出 JSON 样本（仅 scripts/，Python 不迁）。

- [ ] Step 2: Final verify-all — ALL GREEN

- [ ] Step 3: Commit and push
  - git add CHANGELOG.md
  - git commit -m "docs: CHANGELOG — 报文捞取 MVP framework + case-data to business-data rename"
  - git push origin uara_V1.2
