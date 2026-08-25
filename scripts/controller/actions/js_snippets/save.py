"""
JS snippet constants: JS_CLICK_SAVE_BUTTON, JS_SCAN_SAVE_OUTCOME (extracted from _js_snippets.py).
Re-exported by scripts/controller/actions/_js_snippets.py for backward compat.
"""
from ._locator_helpers_js import PAGE_LOCATOR_HELPERS
from .scan_utils import JS_SECTION_ATTACH_BLOCK

JS_CLICK_SAVE_BUTTON = r'''(buttonArg) => {
''' + PAGE_LOCATOR_HELPERS + r'''
  const args = Array.isArray(buttonArg) ? buttonArg : [buttonArg, ''];
  const needle = String(args[0] || '保存').trim() || '保存';
  const wantSec = String(args[1] || '').trim();
  const normSec = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const wantNorm = normSec(wantSec);
  const rejectRe = /查询|返回|取消|关闭|重置|清空|删除|导出|引入|核查|上传|下载|暂存/;
  const btnText = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
''' + JS_SECTION_ATTACH_BLOCK + r'''
  const stripSecSuffix = (s) => normSec(s).replace(/#\d+$/, '');
  const secMatches = (m) => {
    if (!wantNorm) return true;
    const id = normSec(m.section_id);
    const title = normSec(m.section_title);
    const wantBase = stripSecSuffix(wantNorm);
    return id === wantNorm || title === wantNorm
      || stripSecSuffix(id) === wantNorm || stripSecSuffix(id) === wantBase
      || title === wantBase;
  };
  const toCandidate = (m) => ({
    section_title: m.section_title || '',
    section_id: m.section_id || '',
    text: m.text || '',
  });
  const scoreBtn = (el, text) => {
    let s = 0;
    if (text === needle) s += 100;
    else if (text.startsWith(needle)) s += 80;
    else if (text.includes(needle)) s += 50;
    else return -1;
    if (rejectRe.test(text) && text !== needle) return -1;
    if (el.classList.contains('el-button--primary') || el.classList.contains('el-button--success')) s += 30;
    if (el.closest('.el-dialog__footer, .el-drawer__footer, .el-message-box__btns, .dialog-footer, .form-footer, .footer-btns, [class*="footer"]')) s += 40;
    if (el.closest('.el-dialog, .el-drawer, .el-message-box')) s += 10;
    const overlay = el.closest('.el-dialog, .el-drawer, .el-message-box');
    if (overlay && /查询|返回|核查|核验/.test(btnText(overlay.querySelector('.el-dialog__title, .el-drawer__title, .el-message-box__title') || overlay))) {
      if (text === needle) s -= 5;
    }
    return s;
  };
  const selectors = 'button, .el-button, [role="button"], a.el-button';
  const matches = [];
  for (const el of document.querySelectorAll(selectors)) {
    if (!isVisible(el)) continue;
    if (el.disabled || el.getAttribute('disabled') != null || el.classList.contains('is-disabled') || el.classList.contains('disableBtn')) continue;
    const text = btnText(el);
    if (!text || text.length > 40) continue;
    const sc = scoreBtn(el, text);
    if (sc < 0) continue;
    const secField = {};
    attachSection(secField, el);
    matches.push({
      el,
      text,
      score: sc,
      section_id: secField.section_id,
      section_title: secField.section_title,
    });
  }
  const filtered = wantNorm ? matches.filter(secMatches) : matches;
  if (filtered.length === 0) {
    return JSON.stringify({
      ok: false,
      reason: 'not-found',
      needle,
      section: wantSec,
      candidates: matches.map(toCandidate),
    });
  }
  if (!wantNorm && filtered.length > 1) {
    return JSON.stringify({
      ok: false,
      reason: 'ambiguous',
      needle,
      candidates: filtered.map(toCandidate),
    });
  }
  let best = filtered[0];
  for (const m of filtered) {
    if (m.score > best.score) best = m;
  }
  const bestEl = best.el;
  const bestText = best.text;
  const bestSection = best.section_title || best.section_id || '';
  try {
    bestEl.scrollIntoView({ block: 'center', behavior: 'instant' });
  } catch (e) {}
  bestEl.click();
  return JSON.stringify({
    ok: true,
    text: bestText,
    section: bestSection,
    xpath: absXPath(bestEl),
    tag: (bestEl.tagName || '').toLowerCase(),
  });
}'''

# After submit: scan visible form errors + notifications / el-message.

JS_SCAN_SAVE_OUTCOME = r'''() => {
  const isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const formErrors = [];
  for (const el of document.querySelectorAll('.el-form-item__error')) {
    if (!isVisible(el)) continue;
    const error = (el.textContent || '').trim();
    if (!error) continue;
    const item = el.closest('.el-form-item');
    const label = ((item && item.querySelector('.el-form-item__label'))
      ? item.querySelector('.el-form-item__label').textContent
      : '').replace(/\s+/g, ' ').trim();
    formErrors.push({ label, error: error.slice(0, 120) });
  }
  const successRe = /操作成功|保存成功|提交成功|新建成功|修改成功|删除成功/;
  const failRe = /失败|错误|异常|不能|不允许|已存在|重复|校验|必填|不通过/;
  const successNotifs = [];
  const errorNotifs = [];
  const collect = (el) => {
    if (!isVisible(el)) return;
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t) return;
    if (failRe.test(t) || /el-notification--error|el-message--error|el-message--warning/.test(el.className || ''))
      errorNotifs.push(t.slice(0, 160));
    else
      successNotifs.push(t.slice(0, 160));
  };
  for (const el of document.querySelectorAll('.el-notification, .el-message')) collect(el);
  return {
    formErrors,
    successNotifs,
    errorNotifs,
    url: location.href,
  };
}'''

# ── Click locator enrichment (AI click_element_by_index → xpath_smart) ──
# Args: [xpath, text, tagHint] — resolve node BEFORE click; walk up to button/a.


# Observe success/error notifications while a save/submit is in flight.
JS_WATCH_SAVE_NOTIFICATIONS = r'''() => {
          const successRe = /操作成功|保存成功|提交成功|新建成功|修改成功|删除成功/;
          const failRe = /失败|错误|异常|不能|不允许|已存在|重复|校验|必填|不通过/;
          window.__saveWatch = { successNotifs: [], errorNotifs: [] };
          const take = (el) => {
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (!t) return;
            if (failRe.test(t) || /el-notification--error|el-message--error/.test(el.className || ''))
              window.__saveWatch.errorNotifs.push(t.slice(0, 160));
            else
              window.__saveWatch.successNotifs.push(t.slice(0, 160));
          };
          for (const el of document.querySelectorAll('.el-notification, .el-message')) take(el);
          const obs = new MutationObserver((muts) => {
            for (const m of muts) {
              for (const n of m.addedNodes || []) {
                if (!n || n.nodeType !== 1) continue;
                if (n.matches && (n.matches('.el-notification, .el-message') || n.querySelector?.('.el-notification, .el-message'))) {
                  if (n.matches?.('.el-notification, .el-message')) take(n);
                  for (const el of (n.querySelectorAll?.('.el-notification, .el-message') || [])) take(el);
                }
              }
            }
          });
          obs.observe(document.body, { childList: true, subtree: true });
          window.__saveWatchObs = obs;
        }'''
