"""
JS snippet constant: JS_WORKSPACE_TABS.

天阳信贷系统的多页签工作区：页签 chip 是 ``.tag-item`` class 元素
（文本 = 页签名，含关闭 icon 的子元素；「首页」为固定页签不可关）。
实测仅 click() 切页签不可靠，须依次派发 mousedown + mouseup + click。

入参 (action, tabName)：
- action='list'     → {ok:true, tabs:[{title, active, closable}]}
- action='activate' → 精确匹配页签名（trim 后全等）后切换
- action='close'    → 点页签内关闭 icon 关闭该页签
失败时 {ok:false, error:'tab-not-found'|'affix-tab-protected'|'invalid-action'}。
"""

JS_WORKSPACE_TABS = '''(args) => {
    const [action, tabName] = args || [];
    const norm = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
    const tags = [...document.querySelectorAll('.tag-item')].filter((t) => t.offsetParent !== null);
    const closeIconOf = (tag) =>
        tag.querySelector('.el-icon-close, .el-tag__close, [class*="close"]');
    const isActive = (tag) =>
        tag.classList.contains('is-active') || tag.classList.contains('active');
    const isClosable = (tag) => {
        const title = norm(tag.textContent);
        if (title === '首页') return false;
        return !!closeIconOf(tag);
    };
    const findByTitle = (name) => {
        const want = norm(name);
        if (!want) return null;
        //「首页」固定页签的文本可能只由其子元素携带，逐元素比对后取最短匹配。
        let hit = null;
        for (const tag of tags) {
            if (norm(tag.textContent) === want) {
                if (!hit || tag.textContent.length < hit.textContent.length) hit = tag;
            }
        }
        return hit;
    };
    if (action === 'list') {
        return JSON.stringify({
            ok: true,
            tabs: tags.map((tag) => ({
                title: norm(tag.textContent),
                active: isActive(tag),
                closable: isClosable(tag),
            })),
        });
    }
    if (action === 'activate') {
        const tag = findByTitle(tabName);
        if (!tag) return JSON.stringify({ ok: false, error: 'tab-not-found' });
        if (isActive(tag)) return JSON.stringify({ ok: true, already: true });
        // 仅 click 不可靠：依次派发 mousedown + mouseup + click。
        tag.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        tag.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        tag.click();
        return JSON.stringify({ ok: true });
    }
    if (action === 'close') {
        const tag = findByTitle(tabName);
        if (!tag) return JSON.stringify({ ok: false, error: 'tab-not-found' });
        if (norm(tag.textContent) === '首页' || !isClosable(tag)) {
            return JSON.stringify({ ok: false, error: 'affix-tab-protected' });
        }
        const icon = closeIconOf(tag);
        if (!icon) return JSON.stringify({ ok: false, error: 'affix-tab-protected' });
        icon.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        icon.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        icon.click();
        return JSON.stringify({ ok: true });
    }
    return JSON.stringify({ ok: false, error: 'invalid-action' });
}'''
