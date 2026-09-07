"""Network capture: hook page responses and emit form-related traffic as memory events.

Passive listener attached to the Playwright page. Only XHR/fetch traffic that
looks form-related (save / query / detail ...) is captured; heartbeats and
polling noise are filtered out. Failures never break the agent loop.
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime

from ...memory.writer import emit_memory_event

# URL keywords that suggest form/business traffic.
_FORM_KEYWORDS = re.compile(
    r'(form|save|load|query|submit|detail|create|update|delete|edit|add)', re.I
)
# Noise: heartbeats, polling, health checks, log streams.
_EXCLUDE_PATTERN = re.compile(
    r'(heartbeat|poll|keepalive|/status|ping|health|metrics|/log)', re.I
)

_MAX_BODY_CHARS = 4096


def _is_form_related(request, response) -> bool:
    """Decide whether a request/response pair is worth capturing.

    Only XHR/fetch. Writes (POST/PUT/DELETE/PATCH) always qualify; GET only
    when the response is JSON and the URL looks form/business related.
    """
    try:
        resource_type = getattr(request, 'resource_type', None)
        if resource_type not in ('xhr', 'fetch'):
            return False
        url = request.url or ''
        if _EXCLUDE_PATTERN.search(url):
            return False
        method = (request.method or '').upper()
        if method in ('POST', 'PUT', 'DELETE', 'PATCH'):
            return True
        if method == 'GET':
            try:
                content_type = (response.header_value('content-type') or '').lower()
            except Exception:
                content_type = ''
            if 'json' in content_type and _FORM_KEYWORDS.search(url):
                return True
        return False
    except Exception:
        return False


def _normalize_url(url: str) -> str:
    """Strip query/hash and collapse numeric path segments to {id}."""
    if not url:
        return ''
    base = re.split(r'[?#]', url, 1)[0]
    return re.sub(r'/\d+(?=/|$)', '/{id}', base)


def _safe_body(body_bytes):
    """Parse body bytes as JSON object; fall back to (truncated) text."""
    if body_bytes is None:
        return None
    if isinstance(body_bytes, str):
        text = body_bytes
    else:
        try:
            text = body_bytes.decode('utf-8', errors='replace')
        except Exception:
            text = str(body_bytes)
    try:
        return json.loads(text)
    except Exception:
        if len(text) > _MAX_BODY_CHARS:
            return text[:_MAX_BODY_CHARS] + '…[truncated]'
        return text


def attach_network_capture(page, business_data_store=None):
    """Attach a response listener that emits ``network_captured`` memory events.

    Returns a cleanup closure that detaches the listener (best effort).
    """
    async def _on_response(response):
        try:
            request = response.request
            if not _is_form_related(request, response):
                return
            try:
                resp_bytes = await response.body()
            except Exception:
                resp_bytes = None
            try:
                req_body = request.post_data
            except Exception:
                req_body = None
            entry = {
                'url': request.url,
                'normalizedUrl': _normalize_url(request.url or ''),
                'method': (request.method or '').upper(),
                'requestBody': _safe_body(req_body),
                'responseStatus': response.status,
                'responseBody': _safe_body(resp_bytes),
                'capturedAt': datetime.now().isoformat(timespec='milliseconds'),
            }
            emit_memory_event('network_captured', entry)
        except Exception:
            # Never break the agent loop on capture failures.
            pass

    def _response_handler(response):
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_on_response(response))
        except RuntimeError:
            # No running loop (sync context): run the core logic inline.
            try:
                coro = _on_response(response)
                asyncio.run(coro) if coro else None
            except Exception:
                pass

    page.on('response', _response_handler)

    def _cleanup():
        try:
            page.remove_listener('response', _response_handler)
        except Exception:
            pass

    return _cleanup
