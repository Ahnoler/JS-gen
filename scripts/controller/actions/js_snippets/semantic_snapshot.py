"""
JS snippet constant: JS_SEMANTIC_SNAPSHOT.

设计来源：借鉴 ZCode 浏览器工具的 domSnapshot「快照即真相」设计
（docs/superpowers/specs/2026-08-31-borrow-zcode-browser-design.md 的 Z1 项）。
目标系统：天阳信贷等 Element UI / Vue 单页应用。一次 page.evaluate 返回
「页面身份上下文头 + 树形控件清单（带稳定 ref）」，替代多轮盲扫描。

要点：
- 只统计可见元素（offsetParent !== null 或 getClientRects().length > 0），
  修改密码/营业日期切换/智能机器人/天元相关配置这 4 个隐藏常驻全局弹窗
  靠可见性过滤自然排除，无需点名。
- fields 按文档序给稳定 ref（"f1","f2",...），buttons "b1","b2",...，
  tables "t1","t2",...；供后续动作按 ref 引用，避免重复扫描。

返回 JSON 字符串形状：

    {"ok":true,
     "context":{"title","hash","breadcrumb","overlay":{"kind","label"}|null,"loading"},
     "fields":[{"ref","label","kind","value","placeholder","disabled","required"}],
     "buttons":[{"ref","text","aria","disabled"}],
     "tables":[{"ref","headers":[...],"rowCount","hasRadio"}],
     "tabs":[{"title","active"}],
     "counts":{"fields","buttons","tables","tabs","truncated"}}
失败时 {"ok":false,"error":"<message>"}。

体积纪律：fields<=60、buttons<=40、tables<=6、tabs<=12，超出截断并置
counts.truncated=true。零参数箭头函数，只读不点，绝不触发页面变更。
"""

JS_SEMANTIC_SNAPSHOT = '''() => {
    try {
        const norm = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
        const isVisible = (el) => {
            try {
                if (el.offsetParent !== null) return true;
                return el.getClientRects().length > 0;
            } catch (e) { return false; }
        };
        const visibleAll = (sel) => [...document.querySelectorAll(sel)].filter(isVisible);
        const LIMITS = { fields: 60, buttons: 40, tables: 6, tabs: 12 };
        let truncated = false;
        const cut = (arr, n) => {
            if (arr.length > n) { truncated = true; return arr.slice(0, n); }
            return arr;
        };

        // ---- context head ----
        let hash = String(location.hash || '');
        if (hash.length > 120) hash = hash.slice(0, 120);
        let breadcrumb = '';
        try {
            const crumbs = document.querySelectorAll('*');
            for (const el of crumbs) {
                const t = norm(el.textContent);
                if (t === '当前位置' || (t.indexOf('当前位置') === 0 && t.length <= 12)) {
                    const holder = el.parentElement || el;
                    breadcrumb = norm(holder.innerText || '').slice(0, 80);
                    break;
                }
            }
        } catch (e) { breadcrumb = ''; }
        let overlay = null;
        const drawers = visibleAll('.el-drawer');
        if (drawers.length > 0) {
            const d = drawers[drawers.length - 1];
            const titleEl = d.querySelector('.el-drawer__title');
            const label = norm(d.getAttribute('aria-label') || '')
                || norm(titleEl ? titleEl.textContent : '');
            overlay = { kind: 'drawer', label };
        }
        if (!overlay) {
            const dialogs = visibleAll('.el-dialog');
            if (dialogs.length > 0) {
                const d = dialogs[dialogs.length - 1];
                const header = d.querySelector('.el-dialog__header');
                const title = d.querySelector('.el-dialog__title');
                const label = norm(header ? header.textContent : '')
                    || norm(title ? title.textContent : '');
                overlay = { kind: 'dialog', label };
            }
        }
        const loading = visibleAll('.el-loading-mask').length > 0;
        const context = {
            title: norm(document.title),
            hash,
            breadcrumb,
            overlay,
            loading,
        };

        // ---- fields: visible .el-form-item ----
        const detectKind = (item) => {
            if (item.querySelector('.el-select')) return 'select';
            if (item.querySelector('.el-date-editor')) return 'date';
            if (item.querySelector('textarea')) return 'textarea';
            if (item.querySelector('.el-radio-group, .el-radio')) return 'radio';
            if (item.querySelector('.el-checkbox-group, .el-checkbox')) return 'checkbox';
            if (item.querySelector('.el-tree')) return 'tree';
            if (item.querySelector('.el-cascader')) return 'cascader';
            if (item.querySelector('.el-upload')) return 'upload';
            return 'input';
        };
        const fieldNodes = visibleAll('.el-form-item');
        const fields = [];
        for (const item of fieldNodes) {
            if (fields.length >= LIMITS.fields) { truncated = true; break; }
            const lblEl = item.querySelector('.el-form-item__label');
            const label = norm(lblEl ? lblEl.textContent : '')
                .replace(/[：:*]+$/, '').trim();
            if (!label) continue;
            const input = item.querySelector('input:not([type="hidden"]), textarea');
            const value = input ? norm(input.value).slice(0, 30) : '';
            const placeholder = input ? norm(input.getAttribute('placeholder') || '') : '';
            const disabled = item.classList.contains('is-disabled')
                || (input ? !!input.disabled : false);
            const required = item.classList.contains('is-required')
                || !!item.querySelector('.is-required');
            fields.push({
                ref: 'f' + (fields.length + 1),
                label,
                kind: detectKind(item),
                value,
                placeholder,
                disabled,
                required,
            });
        }

        // ---- buttons: visible button ----
        const buttonNodes = visibleAll('button');
        const buttons = [];
        for (const b of buttonNodes) {
            if (buttons.length >= LIMITS.buttons) { truncated = true; break; }
            const text = norm(b.textContent);
            let aria = norm(b.getAttribute('aria-label') || '');
            if (!aria) {
                for (const attr of b.attributes) {
                    if (/^data-.*/.test(attr.name)
                        && /tooltip|tip|title|label/i.test(attr.name)) {
                        aria = norm(attr.value);
                        break;
                    }
                }
            }
            if (!text && !aria) continue;
            buttons.push({
                ref: 'b' + (buttons.length + 1),
                text,
                aria,
                disabled: !!b.disabled,
            });
        }

        // ---- tables: visible .el-table ----
        const tableNodes = visibleAll('.el-table');
        const tables = [];
        for (const tb of tableNodes) {
            if (tables.length >= LIMITS.tables) { truncated = true; break; }
            const headers = [...tb.querySelectorAll('.el-table__header-wrapper th')]
                .map((th) => norm(th.textContent))
                .filter((t) => t !== '')
                .slice(0, 12);
            if (headers.length > 0 && headers.length >= 12) truncated = true;
            const bodyRows = [...tb.querySelectorAll('.el-table__body-wrapper tr')];
            const rowCount = bodyRows.filter(isVisible).length;
            const firstRow = bodyRows.find(isVisible);
            const hasRadio = firstRow ? !!firstRow.querySelector('.el-radio') : false;
            tables.push({
                ref: 't' + (tables.length + 1),
                headers,
                rowCount,
                hasRadio,
            });
        }

        // ---- tabs: visible .tag-item ----
        const tabNodes = visibleAll('.tag-item');
        const tabs = [];
        for (const tab of tabNodes) {
            if (tabs.length >= LIMITS.tabs) { truncated = true; break; }
            const cls = String(tab.className || '');
            tabs.push({
                title: norm(tab.textContent),
                active: cls.indexOf('is-active') !== -1 || cls.indexOf('active') !== -1,
            });
        }

        return JSON.stringify({
            ok: true,
            context,
            fields,
            buttons,
            tables,
            tabs,
            counts: {
                fields: fields.length,
                buttons: buttons.length,
                tables: tables.length,
                tabs: tabs.length,
                truncated,
            },
        });
    } catch (e) {
        return JSON.stringify({ ok: false, error: String((e && e.message) || e) });
    }
}'''
