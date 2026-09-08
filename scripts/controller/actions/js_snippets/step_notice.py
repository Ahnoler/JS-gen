"""
JS: one-shot scan of visible toasts / notifications for per-step agent cue.

Not a business MutationObserver. Optionally reads window.__notify_log (installed
by JS_NOTIFY_HOOK elsewhere) for toasts that already disappeared.
"""

JS_SCAN_STEP_NOTICES = r'''(cursor) => {
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    try {
      if (!el) return false;
      if (el.offsetParent !== null) return true;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (e) { return false; }
  };
  const successRe = /操作成功|保存成功|提交成功|新建成功|修改成功|删除成功|状态更新成功|更新成功|启用成功|禁用成功|克隆成功|已提交创建/;
  const failRe = /失败|错误|异常|不能|不允许|已存在|重复|校验|必填|不通过/;
  const items = [];
  const push = (level, text, channel) => {
    const t = norm(text).slice(0, 160);
    if (!t) return;
    items.push({ level, text: t, channel });
  };
  const classifyEl = (el, channel) => {
    if (!visible(el)) return;
    const t = norm(el.textContent);
    if (!t) return;
    const cls = String(el.className || '');
    const title = norm(el.querySelector?.('.el-notification__title')?.textContent);
    const isErr = failRe.test(t)
      || /el-notification--error|el-message--error|el-message--warning|exception-message/.test(cls)
      || !!el.querySelector?.('.el-icon-error')
      || title.includes('异常信息');
    if (isErr) push('error', t, channel);
    else if (successRe.test(t) || /el-message--success|el-notification--success/.test(cls))
      push('success', t, channel);
    else push('info', t, channel);
  };
  for (const el of document.querySelectorAll('.el-message')) classifyEl(el, 'el-message');
  for (const el of document.querySelectorAll('.el-notification')) classifyEl(el, 'el-notification');

  const log = Array.isArray(window.__notify_log) ? window.__notify_log : [];
  const start = Math.max(0, Number(cursor) || 0);
  for (let i = start; i < log.length; i++) {
    const h = log[i] || {};
    const t = norm(h.text || h.t || '');
    if (!t) continue;
    if (h.isErr) push('error', t, 'notify_log');
    else if (successRe.test(t)) push('success', t, 'notify_log');
    else push('info', t, 'notify_log');
  }
  return { items, notify_log_len: log.length };
}'''
