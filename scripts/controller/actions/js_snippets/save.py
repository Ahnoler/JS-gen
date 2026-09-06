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
  const btnText = (el) => {
    const t = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t) return t;
    // 图标按钮：回退 aria-label（由 JS_STAMP_ICON_ARIA_LABELS 预先盖章，见 Task 2）
    return String(el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  };
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
    // disableBtn is a visual-only custom class (tiansun credit system) — it does
    // NOT set pointer-events:none or the HTML disabled attribute. Only is-disabled
    // / el.disabled / disabled attr indicate a truly unclickable button.
    if (el.disabled || el.getAttribute('disabled') != null || el.classList.contains('is-disabled')) continue;
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
  // 分区标题兜底定位（吸收自 JS_SAVE_SECTION，KB-I5 run11）：扫描块没认出的分区，
  // 按标题原文找元素 → 沿祖先向上找最小含目标按钮的容器 → 容器内取 enabled 按钮。
  const sectionFallback = () => {
    const findSectionTitleEls = (exact) => {
      const hits = [];
      for (const el of document.body.querySelectorAll('*')) {
        if (!isVisible(el)) continue;
        const t = normSec(el.textContent);
        if (!t || t.length > 60) continue;
        if (exact ? t !== wantNorm : t.indexOf(wantNorm) === -1) continue;
        const cls = String(el.className || '');
        const looksTitle = /header|title|tab|caption|legend|label/i.test(cls)
          || el.children.length === 0
          || [...el.children].every((c) => !normSec(c.textContent));
        if (looksTitle) hits.push(el);
      }
      return hits;
    };
    let titleEls = findSectionTitleEls(true);
    if (!titleEls.length) titleEls = findSectionTitleEls(false);
    if (!titleEls.length) return null;
    const btnEnabled = (b) => !(b.disabled || b.getAttribute('aria-disabled') === 'true'
      || /disableBtn|is-disabled/.test(String(b.className || '')));
    const saveBtnIn = (root) => {
      const enabled = [];
      for (const b of root.querySelectorAll('button, a, [role="button"], .el-button')) {
        if (!isVisible(b) || !btnEnabled(b)) continue;
        const t = btnText(b);
        if (t && (t === needle || t.indexOf(needle) !== -1)) enabled.push(b);
      }
      return enabled.length ? enabled[0] : null;
    };
    // 每个标题元素沿祖先上溯 ≤12 层，取"标题→按钮"层级最小（最贴合分区）的命中
    let bestBtn = null, bestTitle = '', bestDepth = Infinity;
    for (const tEl of titleEls) {
      let p = tEl, depth = 0;
      while (p && depth < 12) {
        const hit = saveBtnIn(p);
        if (hit) {
          if (depth < bestDepth) {
            bestBtn = hit; bestTitle = normSec(tEl.textContent); bestDepth = depth;
          }
          break;
        }
        p = p.parentElement; depth++;
      }
    }
    if (!bestBtn) return null;
    return { el: bestBtn, text: btnText(bestBtn), section: bestTitle };
  };
  const filtered = wantNorm ? matches.filter(secMatches) : matches;
  if (filtered.length === 0) {
    // 兜底：分区标题→祖先容器定位（仅 wantNorm 时启用）
    if (wantNorm) {
      const fb = sectionFallback();
      if (fb) {
        try { fb.el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (e) {}
        fb.el.click();
        return JSON.stringify({
          ok: true,
          text: fb.text,
          section: fb.section,
          xpath: absXPath(fb.el),
          tag: (fb.el.tagName || '').toLowerCase(),
          via: 'section-title-fallback',
        });
      }
    }
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
''' + PAGE_LOCATOR_HELPERS + r'''
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
  // Include 状态更新成功 (enable/disable status flips) — same family as 操作成功.
  const successRe = /操作成功|保存成功|提交成功|新建成功|修改成功|删除成功|状态更新成功|更新成功|启用成功|禁用成功|克隆成功/;
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
          const successRe = /操作成功|保存成功|提交成功|新建成功|修改成功|删除成功|状态更新成功|更新成功|启用成功|禁用成功|克隆成功/;
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
