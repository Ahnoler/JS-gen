"""Navigation actions: switch tab, click menu item."""

from scripts.state import _record_action
from ._helpers import _ok, _is_ok_result, _enrich_click_element


def _register_navigation_actions(controller, browser_context):
    @controller.action('Switch to a tab by tab name in el-tabs component.')
    async def switch_tab(tab_name: str):
        page = await browser_context.get_current_page()
        element = await _enrich_click_element(
            page, text=tab_name, target_kind='tab',
        )
        result = await page.evaluate('''
            (name) => {
                const tabs = document.querySelectorAll('.el-tabs__item, [role="tab"]');
                for (const tab of tabs) {
                    const t = (tab.textContent || '').trim().replace(/\\s+/g, ' ');
                    if (t === name && tab.offsetParent !== null) {
                        tab.click(); return 'ok';
                    }
                }
                return 'tab-not-found';
            }
        ''', tab_name)
        await page.wait_for_timeout(800)
        if _is_ok_result(result):
            _record_action('switch_tab', {'tab_name': tab_name}, result, element=element)
            return _ok(result)
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
                if (directItem) { directItem.click(); return 'ok'; }
                const submenus = document.querySelectorAll('.el-submenu');
                for (const sm of submenus) {
                    const title = sm.querySelector('.el-submenu__title');
                    const items = sm.querySelectorAll('.el-menu-item');
                    const hasTarget = [...items].some(i => norm(i.textContent) === text);
                    if (hasTarget) {
                        if (!sm.classList.contains('is-opened') && title) title.click();
                        const target = [...items].find(i => norm(i.textContent) === text);
                        if (target) { setTimeout(() => target.click(), 300); return 'ok-expanded'; }
                    }
                }
                return 'not-found';
            }
        ''', menu_text)
        await page.wait_for_timeout(500)
        if _is_ok_result(result):
            _record_action('click_menu_item', {'menu_text': menu_text}, result, element=element)
            return _ok(result + ' | loc:menu:' + menu_text, include_in_memory=True)
        return result
