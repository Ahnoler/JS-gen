"""Navigation actions: switch tab, click menu item."""

from scripts.state import _record_action
from ._helpers import _ok, _is_ok_result, _enrich_click_element
from .click_locator_tail import apply_click_locator_snapshot, split_locator_tail
from .js_snippets._locator_helpers_js import PAGE_LOCATOR_HELPERS
from .replay_timing import WAIT_500_MS, WAIT_800_MS


def _register_navigation_actions(controller, browser_context):
    @controller.action('Switch to a tab by tab name in el-tabs component.')
    async def switch_tab(tab_name: str):
        page = await browser_context.get_current_page()
        element = await _enrich_click_element(
            page, text=tab_name, target_kind='tab',
        )
        result = await page.evaluate('''
            (name) => {
''' + PAGE_LOCATOR_HELPERS + '''
                // ══ 点击命中时刻定位快照（同 JS_CLICK_ICON_BUTTON，U+241F 尾段）══
                // 落库 element 此前只来自点击前的 _enrich_click_element；实际被点
                // tab 节点在 JS 内当场可得——点击前 buildLocatorSnap 快照，尾段
                // 携带 JSON，Python 侧解析覆盖落库（首段 'ok' 判定不变）。
                const LOC_SEP = '␟';
                const snapLocator = (el, text, kindHint) => {
                    try {
                        const abs = absXPath(el);
                        const kind = kindHint || detectTargetKind(el);
                        const t = normalizeControlText(text) || cleanVisibleText(el);
                        const loc = buildLocatorSnap(el, t, abs, '', { targetKind: kind });
                        return LOC_SEP + JSON.stringify(loc);
                    } catch (e) { return ''; }
                };
                const tabs = document.querySelectorAll('.el-tabs__item, [role="tab"]');
                for (const tab of tabs) {
                    const t = (tab.textContent || '').trim().replace(/\\s+/g, ' ');
                    if (t === name && tab.offsetParent !== null) {
                        const tail = snapLocator(tab, name, 'tab');
                        tab.click();
                        return 'ok' + tail;
                    }
                }
                return 'tab-not-found';
            }
        ''', tab_name)
        await page.wait_for_timeout(WAIT_800_MS)
        if _is_ok_result(result):
            head, _ = split_locator_tail(result)
            merged = apply_click_locator_snapshot(result, element)
            if merged is not None:
                element = merged
            _record_action('switch_tab', {'tab_name': tab_name}, head, element=element)
            return _ok(head)
        return result

    @controller.action('Click a menu item by its text. Expands parent submenu if needed.')
    async def click_menu_item(menu_text: str):
        page = await browser_context.get_current_page()
        # Capture BEFORE click/navigation
        element = await _enrich_click_element(
            page, text=menu_text, target_kind='menu',
        )
        result = await page.evaluate('''
            (text) => {
''' + PAGE_LOCATOR_HELPERS + '''
                // ══ 点击命中时刻定位快照（同 JS_CLICK_ICON_BUTTON，U+241F 尾段）══
                // ok 分支点 directItem；ok-expanded 分支的真正点击经 setTimeout
                // 延迟——快照必须在调度前对已解析 target 采样（Vue 重渲染会让
                // fire 后采样命中陈旧/重建节点，同 _misc 容器链 tailNode 理由）。
                const LOC_SEP = '␟';
                const snapLocator = (el, text, kindHint) => {
                    try {
                        const abs = absXPath(el);
                        const kind = kindHint || detectTargetKind(el);
                        const t = normalizeControlText(text) || cleanVisibleText(el);
                        const loc = buildLocatorSnap(el, t, abs, '', { targetKind: kind });
                        return LOC_SEP + JSON.stringify(loc);
                    } catch (e) { return ''; }
                };
                function hasToken(el, tok) {
                  const cls = String(el.className || '').trim().split(/\\s+/);
                  return cls.indexOf(tok) >= 0;
                }
                const MENU_TOKS = ['el-menu-item','menu-item','submenu-item','nav-item','el-dropdown-menu__item'];
                const all = [...document.querySelectorAll(
                  '.el-menu-item, .el-submenu__title, .el-dropdown-menu__item, [role="menuitem"], li, a'
                )];
                const visible = (el) => el && el.offsetParent !== null;
                const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
                const directItem = all.find((el) => {
                  if (!visible(el)) return false;
                  const t = norm(el.innerText || el.textContent);
                  if (t !== text) return false;
                  const cls = String(el.className || '');
                  return MENU_TOKS.some((tok) => hasToken(el, tok))
                    || el.getAttribute('role') === 'menuitem'
                    || hasToken(el, 'el-submenu__title');
                });
                if (directItem) {
                  const tail = snapLocator(directItem, text, 'menu');
                  directItem.click();
                  return 'ok' + tail;
                }
                const submenus = document.querySelectorAll('.el-submenu');
                for (const sm of submenus) {
                    const title = sm.querySelector('.el-submenu__title');
                    const items = sm.querySelectorAll('.el-menu-item');
                    const hasTarget = [...items].some(i => norm(i.textContent) === text);
                    if (hasTarget) {
                        if (!sm.classList.contains('is-opened') && title) title.click();
                        const target = [...items].find(i => norm(i.textContent) === text);
                        if (target) {
                          const tail = snapLocator(target, text, 'menu');
                          setTimeout(() => target.click(), 300);
                          return 'ok-expanded' + tail;
                        }
                    }
                }
                return 'not-found';
            }
        ''', menu_text)
        await page.wait_for_timeout(WAIT_500_MS)
        if _is_ok_result(result):
            head, _ = split_locator_tail(result)
            merged = apply_click_locator_snapshot(result, element)
            if merged is not None:
                element = merged
            _record_action('click_menu_item', {'menu_text': menu_text}, head, element=element)
            return _ok(head + ' | loc:menu:' + menu_text, include_in_memory=True)
        return result
