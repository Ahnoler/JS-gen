"""
JS snippet constant: JS_READ_PAGE_COMPONENT_CODE.

Reads the business page's component code ("组件编号") from the floating
"天元相关配置" help dialog. Each business page has a floating question-mark
button (``.floatingAction .el-icon-question``); clicking it opens an
el-dialog whose body is asynchronously filled with labels (no newlines between
fields in textContent), typically including:
  活动名称：xxx(ZJJK00066158)
  页面名称：对公客户管理页
  页面路径：/cstMgt/csinfMnt/cpctMgt/cpctMgtPg
  组件编号：ZJJK00066153
  场景编号：xxx (some pages expose 场景编号 instead of or in addition to 组件编号)

Pitfalls (wet-verified 2026-09-02, tmp/probe_tianyuan_wet_research.py /
tmp/tianyuan_wet_research.json / tmp/probe_tianyuan_closed_dom.py):
  1. Dialog shell is pre-rendered (title + 「确 定」); content may show
     「加载中...」then fill, OR stay empty forever (no 组件编号 on that page).
  2. Stale data after menu nav: require 「页面路径」 match current hash route
     (re-read hash each poll). Never read closed (display:none) DOM alone —
     it does not refresh on route change (must open 「？」 each page).
  3. Prefer structured ``.el-dialog__body .info p > span`` pairs over textContent.
  4. Menu click → SPA route settle needs a short wait before opening help.
  5. Empty shell (no 加载中, no codes) for several polls → early empty-config.

Style mirrors menu_scan.py: a single async IIFE string with no f-string
interpolation, evaluated via page.evaluate().
"""

from ._locator_helpers_js import JS_POLL_UTIL

JS_READ_PAGE_COMPONENT_CODE = '''async () => {
    ''' + JS_POLL_UTIL + '''

    const parseInfo = (d) => {
        const info = {};
        for (const p of d.querySelectorAll('.el-dialog__body .info p')) {
            const spans = p.querySelectorAll('span');
            if (spans.length < 2) continue;
            const label = (spans[0].textContent || '').replace(/：\\s*$/, '').replace(/:\\s*$/, '').trim();
            const value = (spans[1].textContent || '').trim();
            if (label) info[label] = value;
        }
        // Fallback: textContent when .info spans missing
        if (!info['组件编号'] && !info['场景编号'] && !info['页面路径']) {
            const t = d.textContent || '';
            const cm = t.match(/组件编号：\\s*([A-Za-z0-9]+)/);
            const sm = t.match(/场景编号：\\s*([A-Za-z0-9]+)/);
            const pm = t.match(/页面路径：\\s*(\\S+?)(?=组件编号：|场景编号：|页面名称：|活动名称：|确\\s*定|$)/);
            const nm = t.match(/页面名称：\\s*([^\\n：]+?)(?=\\s*页面路径|$)/);
            if (cm) info['组件编号'] = cm[1];
            if (sm) info['场景编号'] = sm[1];
            if (pm) info['页面路径'] = pm[1];
            if (nm) info['页面名称'] = nm[1].trim();
        }
        return info;
    };

    const pathMatches = (pagePath, currentRoute) => !!(pagePath && (
        pagePath === currentRoute
        || currentRoute.endsWith(pagePath)
        || currentRoute.indexOf(pagePath) !== -1
        || pagePath.endsWith(currentRoute)
    ));

    // Close leftover 天元 dialog — stale body causes wrong path/code.
    for (const d of document.querySelectorAll('.el-dialog')) {
        const title = (d.querySelector('.el-dialog__title') || {}).textContent;
        if (title && title.indexOf('天元相关配置') !== -1) {
            const btn = d.querySelector('.el-dialog__footer button, button');
            if (btn) { try { btn.click(); } catch (e) {} }
        }
    }
    // Let SPA finish route change after click_menu_xpath in the same replay batch.
    await sleep(1000);

    const trigger = document.querySelector('.floatingAction .el-icon-question') || document.querySelector('.floatingAction');
    if (!trigger) return { componentCode: '', scenarioCode: '', pageName: '', pagePath: '', reason: 'no-trigger' };
    trigger.click();

    // Poll up to ~18s (60 × 300ms). Re-read hash each tick (late SPA updates).
    let dialog = null;
    let info = null;
    let lastDialogText = '';
    let emptyStable = 0;
    for (let i = 0; i < 60; i++) {
        const currentRoute = location.hash.slice(1).split('?')[0];
        let sawDialog = false;
        let sawLoading = false;
        let sawCodeLabel = false;
        for (const d of document.querySelectorAll('.el-dialog')) {
            const title = (d.querySelector('.el-dialog__title') || {}).textContent
                || d.getAttribute('aria-label')
                || '';
            if (title.indexOf('天元相关配置') === -1) continue;
            sawDialog = true;
            const t = (d.textContent || '');
            if (t.length > lastDialogText.length) lastDialogText = t;
            if (t.indexOf('加载中') !== -1) sawLoading = true;
            const parsed = parseInfo(d);
            const componentCode = parsed['组件编号'] || '';
            const scenarioCode = parsed['场景编号'] || '';
            const pagePath = parsed['页面路径'] || '';
            if (componentCode || scenarioCode || pagePath) sawCodeLabel = true;
            if ((componentCode || scenarioCode) && pathMatches(pagePath, currentRoute)) {
                dialog = d;
                info = parsed;
                break;
            }
        }
        if (dialog) break;
        // Empty shell (title+footer only, or finished load with no codes): early exit
        if (sawDialog && !sawLoading && !sawCodeLabel) {
            emptyStable += 1;
            if (emptyStable >= 5) {
                return {
                    componentCode: '',
                    scenarioCode: '',
                    pageName: '',
                    pagePath: '',
                    reason: 'empty-config',
                    diag: { hash: location.hash, lastDialogText: lastDialogText.slice(0, 300) },
                };
            }
        } else {
            emptyStable = 0;
        }
        await sleep(300);
    }

    if (!dialog || !info) {
        return {
            componentCode: '',
            scenarioCode: '',
            pageName: '',
            pagePath: '',
            reason: 'timeout-or-mismatch',
            diag: { hash: location.hash, lastDialogText: lastDialogText.slice(0, 300) },
        };
    }

    const rawComp = String(info['组件编号'] || '').trim();
    const componentCode = /^[A-Za-z0-9]+$/.test(rawComp) ? rawComp : '';
    const scenarioCode = String(info['场景编号'] || '').trim();
    const pageName = String(info['页面名称'] || '').trim();
    const pagePath = String(info['页面路径'] || '').trim();
    const activityName = String(info['活动名称'] || '').trim();

    try {
        const btn = dialog.querySelector('.el-dialog__footer button, button');
        if (btn) btn.click();
    } catch (e) {}

    return { componentCode: componentCode, scenarioCode: scenarioCode, pageName: pageName, pagePath: pagePath, activityName: activityName, reason: 'ok' };
}'''

# Menu click by xpath with render wait: poll for the element (sidebar menu may
# not be rendered yet right after login), then trigger a DOM click (works even
# when a submenu flyout is technically hidden — proven against the SUT).
JS_CLICK_MENU_XPATH = '''async (xpath) => {
    ''' + JS_POLL_UTIL + '''
    if (!xpath) return 'not-found';
    for (let i = 0; i < 34; i++) {
        const el = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (el) {
            try {
                el.click();
                return 'ok';
            } catch (e) {
                return 'click-error';
            }
        }
        await sleep(300);
    }
    return 'not-found';
}'''

# 找一个可安全承受真实 mousedown 的视口空白点（用于收起门户 mega-menu：
# 实测（tmp/probe-menu-close-v2.py 单变量验证）hover 移开/Escape/合成点击均无法收起，
# 仅面板外的真实 mousedown 触发收起；合成 el.click() 不产生真实鼠标事件，
# 故导航后面板会一直展开盖住页面上沿，遮挡后续截图与顶部区域点击）。
# 候选点逐个 elementFromPoint：命中 body/html 最优，纯容器标签次之；
# 排除链接/按钮/表单/表格单元/下拉/弹窗（.el-table 行内点击会改选中态，
# 弹窗遮罩上点击会关闭弹窗，必须避开）。页面被可见弹窗覆盖时返回 null
# （调用方跳过收起，不影响回放主流程）。
JS_FIND_MENU_DISMISS_POINT = '''() => {
    const w = window.innerWidth || 1600;
    const h = window.innerHeight || 900;
    for (const sel of ['.v-modal', '.el-overlay', '.el-dialog__wrapper']) {
        const m = document.querySelector(sel);
        if (m) {
            const s = getComputedStyle(m);
            if (s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0') return null;
        }
    }
    const interact = 'a,button,input,select,textarea,label,li,tr,td,th,[role=button],[onclick],'
        + '.el-button,.el-dropdown,.el-table,.el-dialog,.el-drawer,.el-date-picker,.el-select,.el-cascader';
    const plain = 'div,span,p,main,section,header,footer,nav,ul,form';
    const cands = [];
    for (const fy of [0.95, 0.9, 0.8, 0.6, 0.4, 0.25]) {
        for (const fx of [0.5, 0.25, 0.75, 0.1, 0.9, 0.03]) {
            cands.push([Math.round(w * fx), Math.round(h * fy)]);
        }
    }
    let fallback = null;
    for (const [x, y] of cands) {
        const el = document.elementFromPoint(x, y);
        if (!el) continue;
        if (el === document.body || el === document.documentElement) return { x: x, y: y, tag: 'body' };
        if (fallback === null && plain.indexOf(el.tagName.toLowerCase()) !== -1 && !el.closest(interact)) {
            fallback = { x: x, y: y, tag: el.tagName.toLowerCase() };
        }
    }
    return fallback;
}'''
