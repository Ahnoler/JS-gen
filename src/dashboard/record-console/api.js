/**
 * Self-use trajectory recording console — API helpers.
 * Product /api/v2 responses: { code, message, data }
 */
import { unwrapApi, apiErrorMessage, isApiFail } from '../api-envelope.js';

export { unwrapApi };

export async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (isApiFail(res, json)) {
    const err = new Error(apiErrorMessage(json, res.statusText || String(res.status)));
    err.status = res.status;
    err.code = json.code;
    err.body = json;
    throw err;
  }

  return unwrapApi(json);
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** @type {Record<string, { label: string, tone: string, title: string }>} */
const RECORD_STATUS_META = {
  draft: { label: '草稿', tone: 'slate', title: '空闲，未占用执行资源' },
  live: { label: '占用中', tone: 'sky', title: '推流已就绪（prepare），可人工录制；非 AI 录制' },
  recording: { label: 'AI录制中', tone: 'amber', title: 'AI 录制进行中，禁止开启人工录制' },
  recorded: { label: '已录制', tone: 'emerald', title: '录制已结束，待确认' },
  completed: { label: '已确认', tone: 'indigo', title: '人工已确认完成' },
};

/** Human label for trajectory.recordStatus */
export function recordStatusLabel(status) {
  const key = String(status || '').trim();
  return RECORD_STATUS_META[key]?.label || (key || '—');
}

/** Tooltip / title for recordStatus */
export function recordStatusTitle(status) {
  const key = String(status || '').trim();
  return RECORD_STATUS_META[key]?.title || key || '';
}

/** Colored badge HTML for list / studio meta */
export function recordStatusBadgeHtml(status) {
  const key = String(status || '').trim();
  const meta = RECORD_STATUS_META[key] || {
    label: key || '—',
    tone: 'slate',
    title: key || '',
  };
  return `<span class="rc-status rc-status-${meta.tone}" title="${escapeHtml(meta.title)}">${escapeHtml(meta.label)}</span>`;
}

