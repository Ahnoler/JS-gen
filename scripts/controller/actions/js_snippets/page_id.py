"""
JS snippet constant: JS_READ_PAGE_COMPONENT_CODE.

Reads the business page's component code ("组件编号") from the floating
"天元相关配置" help dialog. Each business page has a floating question-mark
button (``.floatingAction .el-icon-question``); clicking it opens an
el-dialog whose body is asynchronously filled with four lines:
  活动名称：xxx(ZJJK00066158)
  页面名称：对公客户管理页
  页面路径：/cstMgt/csinfMnt/cpctMgt/cpctMgtPg
  组件编号：ZJJK00066153

Three pitfalls (verified by tmp/probe_tianyuan5.py):
  1. The dialog is pre-rendered as an empty shell (only title + 确定);
     content is filled asynchronously after the click (shows "加载中..." meanwhile).
  2. Stale data: after navigating to a new page, the first open may still show
     the previous page's data. We must wait until the dialog's "页面路径"
     matches the current route (``location.hash`` without the query string).
  3. Some pages (e.g. the workbench home) have no floating button or no
     component code → return empty componentCode.

Style mirrors menu_scan.py: a single async IIFE string with no f-string
interpolation, evaluated via page.evaluate().
"""

from ._locator_helpers_js import JS_POLL_UTIL

JS_READ_PAGE_COMPONENT_CODE = '''async () => {
    ''' + JS_POLL_UTIL + '''

    // 1. locate the floating help trigger and click it.
    const trigger = document.querySelector('.floatingAction .el-icon-question') || document.querySelector('.floatingAction');
    if (!trigger) return { componentCode: '', pageName: '', pagePath: '', reason: 'no-trigger' };
    trigger.click();

    // current route: hash without leading '#' and without query string
    const currentRoute = location.hash.slice(1).split('?')[0];

    // 2. poll up to ~12s (40 × 300ms) for the "天元相关配置" dialog to both
    //    contain "组件编号：" AND have its "页面路径" match the current route.
    let dialog = null;
    let text = '';
    let lastDialogText = '';
    for (let i = 0; i < 40; i++) {
        for (const d of document.querySelectorAll('.el-dialog')) {
            const title = (d.querySelector('.el-dialog__title') || {}).textContent;
            if (title && title.indexOf('天元相关配置') !== -1) {
                const t = (d.textContent || '');
                if (t.length > lastDialogText.length) lastDialogText = t;
                if (t.indexOf('组件编号：') !== -1) {
                    // extract 页面路径 to compare with current route.
                    // textContent has NO separators between fields — stop at the next label.
                    const pm = t.match(/页面路径：\\s*(\\S+?)(?=组件编号：|页面名称：|活动名称：|$)/);
                    const pagePath = pm ? pm[1] : '';
                    if (pagePath && pagePath === currentRoute) {
                        dialog = d;
                        text = t;
                        break;
                    }
                }
            }
        }
        if (dialog) break;
        await sleep(300);
    }

    // 6. timeout or route mismatch → return empty with diagnostics
    if (!dialog) {
        return { componentCode: '', pageName: '', pagePath: '', reason: 'timeout-or-mismatch', diag: { hash: location.hash, lastDialogText: lastDialogText.slice(0, 300) } };
    }

    // 4. parse the four fields via regex (newline-tolerant)
    const codeMatch = text.match(/组件编号：\\s*([A-Za-z0-9]+)/);
    const componentCode = codeMatch ? codeMatch[1] : '';

    const nameMatch = text.match(/页面名称：\\s*([^\\n：]+?)(?=\\s*页面路径|$)/);
    const pageName = nameMatch ? nameMatch[1].trim() : '';

    const pathMatch = text.match(/页面路径：\\s*(\\S+?)(?=组件编号：|页面名称：|活动名称：|$)/);
    const pagePath = pathMatch ? pathMatch[1] : '';

    const actMatch = text.match(/活动名称：\\s*([^\\n]+)/);
    const activityName = actMatch ? actMatch[1].trim() : '';

    // 5. close the dialog via its first button (确定) — best-effort
    try {
        const btn = dialog.querySelector('button');
        if (btn) btn.click();
    } catch (e) {}

    // 7. success
    return { componentCode: componentCode, pageName: pageName, pagePath: pagePath, activityName: activityName, reason: 'ok' };
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
