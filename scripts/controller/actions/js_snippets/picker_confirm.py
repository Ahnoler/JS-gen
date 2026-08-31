"""
JS snippet constants: JS_PICKER_DIALOG_QUERY, JS_PICKER_DIALOG_SELECT.

天阳信贷系统大量使用 el-dialog 选择器弹窗（如「选择对公授信客户」）：
弹窗内含查询表单（label + input）+ el-table（首列 radio 单选）+
查询/重置/取消/确认按钮。这两个片段把「填查询条件 → 点查询」与
「按行文本单选 → 点确认 → 回填校验」各收敛为一次引擎级注入，
替代 LLM 多步盲操作。

- JS_PICKER_DIALOG_QUERY(dialogName, fieldsJson)：弹窗内按 label 填查询
  条件（native setter + input/change 事件），点「查询」按钮，立即返回
  当前行数与前 5 行文本（不等待——由 Python 侧 wait_for_timeout 等待）。
- JS_PICKER_DIALOG_SELECT(dialogName, rowText)：弹窗内找文本包含 rowText
  的可见行，点其 radio，再点「确认」按钮；确认前后各读一次弹窗下方
  底层页面的 .el-form-item label→值映射，返回发生变化的字段。

两者均返回 JSON 字符串；失败时 {ok:false, error:'...'}。
"""

_JS_PICKER_HELPERS = '''    const norm = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
    const findDialog = (name) => {
        const want = norm(name);
        if (!want) return null;
        for (const d of document.querySelectorAll('.el-dialog')) {
            if (d.offsetParent === null) continue;
            const title = d.querySelector('.el-dialog__title');
            const t = norm(title ? title.textContent : '')
                || norm(d.getAttribute('aria-label') || '');
            if (t && t.indexOf(want) !== -1) return d;
        }
        return null;
    };
    // Underlying-page form items: visible .el-form-item NOT inside any visible dialog.
    const readUnderlyingForm = () => {
        const map = {};
        const inVisibleDialog = (el) => {
            let n = el;
            while (n && n !== document.body) {
                if (n.classList && n.classList.contains('el-dialog') && n.offsetParent !== null) return true;
                n = n.parentElement;
            }
            return false;
        };
        for (const item of document.querySelectorAll('.el-form-item')) {
            if (item.offsetParent === null) continue;
            if (inVisibleDialog(item)) continue;
            const lbl = item.querySelector('.el-form-item__label');
            if (!lbl) continue;
            const key = norm(lbl.textContent).replace(/[：:*]+$/, '');
            if (!key || key in map) continue;
            const input = item.querySelector('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), textarea');
            map[key] = input ? norm(input.value) : norm(item.textContent).replace(/^\\*?/, '').slice(key.length).trim();
        }
        return map;
    };
    const clickButtonByText = (dialog, token) => {
        for (const btn of dialog.querySelectorAll('button')) {
            if (btn.offsetParent === null || btn.disabled) continue;
            const t = norm(btn.textContent).replace(/\\s+/g, '');
            if (t.indexOf(token) !== -1) { btn.click(); return true; }
        }
        return false;
    };'''

JS_PICKER_DIALOG_QUERY = '''(args) => {
    const [dialogName, fieldsJson] = args || [];
''' + _JS_PICKER_HELPERS + '''
    const dialog = findDialog(dialogName);
    if (!dialog) return JSON.stringify({ ok: false, error: 'dialog-not-found' });
    let fields = [];
    try {
        fields = (typeof fieldsJson === 'string') ? JSON.parse(fieldsJson) : fieldsJson;
    } catch (e) {
        return JSON.stringify({ ok: false, error: 'invalid-fields-json' });
    }
    if (!Array.isArray(fields)) return JSON.stringify({ ok: false, error: 'invalid-fields-json' });
    const setNativeValue = (input, value) => {
        const proto = input instanceof HTMLTextAreaElement
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(input, value);
        else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    for (const f of fields) {
        const label = norm(f && (f.label != null ? f.label : f));
        const value = f && f.value != null ? String(f.value) : '';
        if (!label) continue;
        let input = null;
        for (const item of dialog.querySelectorAll('.el-form-item')) {
            const lbl = item.querySelector('.el-form-item__label');
            if (!lbl || norm(lbl.textContent) !== label) continue;
            input = item.querySelector('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), textarea');
            if (input) break;
        }
        if (!input) {
            // Bare <label> pairing: label[for] → input#id, or label wrapping its input.
            for (const lbl of dialog.querySelectorAll('label')) {
                const t = norm(lbl.textContent).replace(/[：:*]+$/, '');
                if (t !== label) continue;
                input = lbl.querySelector('input, textarea');
                if (!input && lbl.getAttribute('for')) {
                    input = dialog.querySelector('#' + CSS.escape(lbl.getAttribute('for')));
                }
                if (input) break;
            }
        }
        if (!input) return JSON.stringify({ ok: false, error: 'field-label-not-found:' + label });
        setNativeValue(input, value);
    }
    if (!clickButtonByText(dialog, '查询')) {
        return JSON.stringify({ ok: false, error: 'query-button-not-found' });
    }
    // No wait here — Python side waits (wait_for_timeout) before reading results.
    const rows = [...dialog.querySelectorAll('.el-table__body tbody tr, .el-table__body tr')]
        .filter((r) => r.offsetParent !== null)
        .map((r) => norm(r.innerText || r.textContent));
    return JSON.stringify({ ok: true, row_count: rows.length, rows: rows.slice(0, 5) });
}'''

JS_PICKER_DIALOG_SELECT = '''(args) => {
    const [dialogName, rowText] = args || [];
''' + _JS_PICKER_HELPERS + '''
    const dialog = findDialog(dialogName);
    if (!dialog) return JSON.stringify({ ok: false, error: 'dialog-not-found' });
    const want = norm(rowText);
    if (!want) return JSON.stringify({ ok: false, error: 'row-not-found' });
    const before = readUnderlyingForm();
    const rows = [...dialog.querySelectorAll('.el-table__body tbody tr, .el-table__body tr')]
        .filter((r) => r.offsetParent !== null);
    const row = rows.find((r) => (norm(r.innerText || r.textContent)).indexOf(want) !== -1);
    if (!row) return JSON.stringify({ ok: false, error: 'row-not-found' });
    const radio = row.querySelector('.el-radio') || row.querySelector('input[type="radio"]');
    if (!radio) return JSON.stringify({ ok: false, error: 'row-not-found' });
    radio.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    radio.click();
    if (!clickButtonByText(dialog, '确')) {
        return JSON.stringify({ ok: false, error: 'confirm-button-not-found' });
    }
    // No wait here — Python side waits (wait_for_timeout) for the dialog to close
    // and the underlying form to be backfilled before diffing.
    const after = readUnderlyingForm();
    const changed = {};
    for (const key of Object.keys(after)) {
        if (after[key] && after[key] !== before[key]) changed[key] = after[key];
    }
    return JSON.stringify({ ok: true, changed: changed });
}'''
