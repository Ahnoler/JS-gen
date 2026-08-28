"""
JS snippet constant: JS_SCAN_MENU_TREE.

Ported (merged) from tmp/menu_crawl/crawl_menu_xpath.py — the verified menu
crawl script. This single self-contained IIFE replaces the two-step
(READ_CACHE + CRAWL_JS + Python build_root_map) flow with one page.evaluate
that:
  1. reads the app's full menu tree from localStorage
     (key starting with ``tansun_role_routemenu``), falling back to a live
     POST ``tansun-tcp-sys/menu`` when the cache is empty/invalid;
  2. builds an {id: top_level_text} root map by walking that tree
     (the JS mirror of crawl_menu_xpath.py ``build_root_map``);
  3. walks the DOM sidebar (``li.menu-item``) for Level-1 and Level-2 items,
     emitting per-menu { level, name, parentName, xpath }.

PAGE_LOCATOR_HELPERS is concatenated inside the IIFE (same pattern as
scan_form.py / the crawl script) so xpathLiteral / normalizeControlText are
in scope. No f-string interpolation is used.
"""
from ._locator_helpers_js import PAGE_LOCATOR_HELPERS

JS_SCAN_MENU_TREE = '''async () => {
    ''' + PAGE_LOCATOR_HELPERS + '''
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const diag = { url: location.href, lsMenuKey: '', menuWrapper: 0, liMenuItem: 0, waitedMs: 0 };

    // Wait up to 10s for the sidebar menu to render (fresh login may still be mounting).
    for (let i = 0; i < 34; i++) {
        if (document.querySelector('.menu-wrapper li.menu-item')) break;
        await sleep(300);
        diag.waitedMs += 300;
    }
    diag.menuWrapper = document.querySelectorAll('.menu-wrapper').length;
    diag.liMenuItem = document.querySelectorAll('li.menu-item').length;

    const clean = (s) => normalizeControlText(s);

    // ---- 1. full menu tree: prefer localStorage cache, fallback live API ----
    const readCache = () => {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.indexOf('tansun_role_routemenu') === 0) {
                diag.lsMenuKey = k;
                return localStorage.getItem(k);
            }
        }
        return null;
    };
    let treeNodes = null;
    try {
        const raw = readCache();
        if (raw) treeNodes = JSON.parse(raw);
    } catch (e) {
        treeNodes = null;
    }
    // Fallback POST tansun-tcp-sys/menu (relative to app origin); best-effort.
    // page.evaluate runs a sync JS function — fetch is async and cannot be
    // awaited here, so a cache miss leaves treeNodes null and L2 parents
    // resolve to '' (the localStorage cache is the product path).
    if (!treeNodes) {
        try {
            fetch('tansun-tcp-sys/menu', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            }).then(r => r.json()).catch(function () {});
        } catch (e) {}
    }

    // ---- 2. {id: top_level_text} root map (mirror of build_root_map) ----
    const rootMap = {};
    const walkTree = (nodes, rootId, rootText) => {
        for (const n of (nodes || [])) {
            const nid = n.id || n.menuNo || '';
            const txt = n.text || n.menuNm || '';
            if (nid) rootMap[nid] = rootText || txt;
            const childRootId = rootId || nid;
            const childRootText = rootText || txt;
            walkTree(n.menuList || n.children || [], childRootId, childRootText);
        }
    };
    walkTree(treeNodes || [], null, '');

    // ---- 3. DOM crawl ----
    // Relative attribute-anchored xpath; prefer data-id → data-url → text.
    // All menu items are <li class="menu-item">.
    const relXPath = (el, text) => {
        const id = el.getAttribute && el.getAttribute('data-id');
        if (id) return '//li[@data-id=' + xpathLiteral(id) + ']';
        const url = el.getAttribute && el.getAttribute('data-url');
        if (url) return '//li[@data-url=' + xpathLiteral(url) + ']';
        if (text) return '//li[normalize-space()=' + xpathLiteral(text) + ']';
        return '';
    };

    const menus = [];
    const pushMenu = (el, level, parent) => {
        if (!el || el.nodeType !== 1) return;
        const text = clean(el.innerText || el.textContent);
        if (!text) return;
        const id = el.getAttribute('data-id') || '';
        const xp = relXPath(el, text);
        // Same-name menus kept by (level, parentName, xpath) — no dedup.
        menus.push({
            level: level,
            name: text,
            parentName: parent || '',
            xpath: xp,
            _id: id,
        });
    };

    // Level-1: li.menu-item directly under a sidebar .menu-wrapper
    // (parent is .menu-wrapper AND not inside .el-scrollbar__view).
    const l1Seen = new Set();
    document.querySelectorAll('li.menu-item').forEach((li) => {
        const p = li.parentElement;
        const inScroll = !!(p && p.closest && p.closest('.el-scrollbar__view'));
        const isL1 = p && p.classList && p.classList.contains('menu-wrapper') && !inScroll;
        if (!isL1) return;
        const key = li.getAttribute('data-id') || clean(li.innerText || li.textContent);
        if (l1Seen.has(key)) return;
        l1Seen.add(key);
        pushMenu(li, 1, '');
    });

    // Level-2: li.menu-item inside the submenu flyout scrollbar.
    const subSeen = new Set();
    document.querySelectorAll('.menu-wrapper .el-scrollbar__view ul > li.menu-item').forEach((li) => {
        const id = li.getAttribute('data-id') || '';
        const text = clean(li.innerText || li.textContent);
        const key = id || text;
        if (subSeen.has(key)) return;
        subSeen.add(key);
        pushMenu(li, 2, '');
        // Resolve L2 parent from the localStorage menu tree by data-id.
        const last = menus[menus.length - 1];
        last.parentName = rootMap[id] || '';
    });

    // Strip the internal _id helper field before returning.
    const out = menus.map((m) => ({
        level: m.level,
        name: m.name,
        parentName: m.parentName,
        xpath: m.xpath,
    }));
    return { menus: out, diag: diag };
}'''
