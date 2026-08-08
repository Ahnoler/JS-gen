"""
JS snippet constants: JS_SCAN_FORM_FIELDS, JS_CHECK_SINGLE_FIELD (extracted from _js_snippets.py).
Re-exported by scripts/controller/actions/_js_snippets.py for backward compat.
"""
from .scan_utils import JS_CLASSIFY_FIELD
from .base import JS_FIELD_DISABLED
from .scan_utils import JS_FIELD_REQUIRED
from .container import JS_GET_CONTAINER
from .scan_utils import JS_READ_CURRENT_VALUE
from .scan_utils import JS_SECTION_ATTACH_BLOCK
from ._locator_helpers_js import PAGE_LOCATOR_HELPERS

JS_SCAN_FORM_FIELDS = '''async ([quick, buttonKeywords]) => {
''' + PAGE_LOCATOR_HELPERS + '''
    const container = ''' + JS_GET_CONTAINER + ''';
    const classify = ''' + JS_CLASSIFY_FIELD + ''';
    const isDisabled = ''' + JS_FIELD_DISABLED + ''';
    const isRequired = ''' + JS_FIELD_REQUIRED + ''';
    const readValue = ''' + JS_READ_CURRENT_VALUE + ''';
    /* SECTION_ATTACH */
''' + JS_SECTION_ATTACH_BLOCK + '''
    const getRowLeadingText = (row) => {
        const cells = row.querySelectorAll('td, .el-table__cell');
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            const ct = normalizeControlText(cell.innerText || cell.textContent || '');
            const hasSelect = !!cell.querySelector('.el-checkbox, .el-radio, input[type="checkbox"], input[type="radio"]');
            if (hasSelect && !ct) continue;
            if (ct) return ct;
        }
        return '';
    };
    const getColumnHeader = (table, cell) => {
        const tableEl = table.closest ? (table.closest('.el-table') || table) : table;
        const headerRow = tableEl.querySelector('.el-table__header thead tr, thead tr');
        if (!headerRow || cell.cellIndex < 0) return '';
        const th = headerRow.children[cell.cellIndex];
        return th ? normalizeControlText(th.innerText || th.textContent || '') : '';
    };
    const isPagerRow = (row) => {
        if (row.closest && row.closest('.el-pagination')) return true;
        const txt = (row.innerText || row.textContent || '').replace(/\\s+/g, ' ');
        if (/每页|条\\/页|前往|页码|pagination/i.test(txt) && row.querySelector('.el-pagination, .el-select, .el-input')) return true;
        return false;
    };
    const classifyTableCell = (cell) => {
        if (cell.querySelector('.el-date-editor, .tsscdatepicker, [class*="date-picker"], [class*="datepicker"]')) return 'date';
        if (cell.querySelector('.el-select')) return 'select';
        if (cell.querySelector('textarea')) return 'input';
        if (cell.querySelector('input:not([type="hidden"])')) return 'input';
        return 'unknown';
    };
    const collectTableControls = (row) => {
        /* SOURCE_B_KIND_PARITY */
        const controls = [];
        const cells = row.querySelectorAll('td, .el-table__cell');
        const dateSeen = new Set();
        const groupSeen = new Set();
        for (let ci = 0; ci < cells.length; ci++) {
            const cell = cells[ci];
            const dateEls = cell.querySelectorAll('.el-date-editor, .tsscdatepicker, [class*="date-picker"], [class*="datepicker"]');
            for (let di = 0; di < dateEls.length; di++) {
                const de = dateEls[di];
                if (dateSeen.has(de)) continue;
                dateSeen.add(de);
                if (quick && !isVisible(de)) continue;
                const operable = de.querySelector('input:not([type="hidden"])') || de;
                controls.push({ cell, el: operable, kind: 'date', options: [] });
            }
            const radioHosts = cell.querySelectorAll('.el-radio-group');
            const radioContainers = radioHosts.length ? [...radioHosts] : (cell.querySelectorAll('.el-radio').length ? [cell] : []);
            for (let rgi = 0; rgi < radioContainers.length; rgi++) {
                const host = radioContainers[rgi];
                const gkey = host === cell ? ('cell-radio:' + ci) : host;
                if (groupSeen.has(gkey)) continue;
                const radios = host.querySelectorAll('.el-radio');
                if (!radios.length) continue;
                groupSeen.add(gkey);
                if (quick && !isVisible(radios[0])) continue;
                const options = [...radios].map(r => {
                    const lab = r.querySelector('.el-radio__label');
                    return ((lab && lab.textContent) || r.textContent || '').replace(/\\s+/g, ' ').trim();
                }).filter(Boolean);
                const clickEl = radios[0].querySelector('.el-radio__input, input[type="radio"]') || radios[0];
                controls.push({ cell, el: clickEl, kind: 'radio', options });
            }
            const cbHosts = cell.querySelectorAll('.el-checkbox-group');
            const cbContainers = cbHosts.length ? [...cbHosts] : (cell.querySelectorAll('.el-checkbox').length ? [cell] : []);
            for (let cgi = 0; cgi < cbContainers.length; cgi++) {
                const host = cbContainers[cgi];
                const gkey = host === cell ? ('cell-cb:' + ci) : host;
                if (groupSeen.has(gkey)) continue;
                const boxes = host.querySelectorAll('.el-checkbox');
                if (!boxes.length) continue;
                groupSeen.add(gkey);
                if (quick && !isVisible(boxes[0])) continue;
                const options = [...boxes].map(c => {
                    const lab = c.querySelector('.el-checkbox__label');
                    return ((lab && lab.textContent) || c.textContent || '').replace(/\\s+/g, ' ').trim();
                }).filter(Boolean);
                const clickEl = boxes[0].querySelector('.el-checkbox__input, input[type="checkbox"]') || boxes[0];
                controls.push({ cell, el: clickEl, kind: 'checkbox', options });
            }
            const inputs = cell.querySelectorAll('input:not([type="hidden"])');
            for (let ii = 0; ii < inputs.length; ii++) {
                const input = inputs[ii];
                const t = (input.type || '').toLowerCase();
                if (t === 'checkbox' || t === 'radio') continue;
                if (input.closest && input.closest('.el-date-editor, .tsscdatepicker, [class*="date-picker"], [class*="datepicker"]')) continue;
                // el-select owns .el-input__inner — do not also push it here, or
                // occurrence=2 invents fake (...el-select)[2] xpaths (DOM has one).
                if (input.closest && input.closest('.el-select')) continue;
                if (input.closest && input.closest('.el-pagination')) continue;
                if (quick && !isVisible(input)) continue;
                controls.push({ cell, el: input, kind: classifyTableCell(cell), options: [] });
            }
            const textareas = cell.querySelectorAll('textarea');
            for (let ti = 0; ti < textareas.length; ti++) {
                const ta = textareas[ti];
                if (quick && !isVisible(ta)) continue;
                controls.push({ cell, el: ta, kind: 'input', options: [] });
            }
            const selects = cell.querySelectorAll('.el-select');
            for (let si = 0; si < selects.length; si++) {
                const sel = selects[si];
                const trigger = sel.querySelector('.el-input__inner');
                if (!trigger) continue;
                if (quick && !isVisible(sel)) continue;
                controls.push({ cell, el: trigger, kind: 'select', options: [] });
            }
        }
        return controls;
    };
    const tableFieldXpathSmartOf = (rowText, controlEl, occurrence) => {
        const rowT = normalizeControlText(rowText);
        if (!rowT || !controlEl) return '';
        const scope = scopeOf(controlEl);
        const scopeKind = (scope === 'drawer' || scope === 'dialog') ? scope : '';
        const lit = xpathLiteral(rowT);
        let leaf = 'input';
        if (controlEl.closest && controlEl.closest('.el-select')) {
            leaf = "div[contains(@class,'el-select')]";
        } else if (controlEl.tagName && controlEl.tagName.toLowerCase() === 'textarea') {
            leaf = 'textarea';
        } else if (controlEl.closest && controlEl.closest('.el-date-editor, .tsscdatepicker')) {
            leaf = "div[contains(@class,'el-date-editor')]";
        } else if (controlEl.closest && controlEl.closest('.el-radio, .el-radio-group')) {
            leaf = "div[contains(@class,'el-radio')]";
        } else if (controlEl.closest && controlEl.closest('.el-checkbox, .el-checkbox-group')) {
            leaf = "div[contains(@class,'el-checkbox')]";
        }
        const local = "tr[.//*[normalize-space()=" + lit + "]]//" + leaf;
        let xp = scopedXPath(local, scopeKind);
        const n = Number(occurrence) || 0;
        if (n > 1) xp = withOccurrence(xp, n);
        return xp;
    };
    const buildTableDisplayName = (rowText, controls, idx, colHeader, placeholder) => {
        const rowT = normalizeControlText(rowText);
        if (!rowT) return '';
        if (controls.length <= 1) return rowT;
        if (colHeader) return rowT + '|' + normalizeControlText(colHeader);
        if (placeholder) return rowT + '|' + normalizeControlText(placeholder);
        return rowT + '|#' + (idx + 1);
    };
    // 从 el-select 的 Vue 组件实例读取 options（不操作 DOM，不受下拉框位置影响）。
    // Element UI 的 Vue 实例挂载在 .el-select 的容器 DIV 上（不是内部 input）。
    const readVueOptions = (trigger) => {
        try {
            // trigger 是 .el-select .el-input__inner（input 元素）
            // __vue__ 在父级 .el-select（div 元素）上
            const selectEl = trigger.closest('.el-select');
            const vm = selectEl && selectEl.__vue__;
            if (vm) {
                // ElSelect 的 options 在 $data.options 或 vm.options
                const data = vm.$data || vm;
                if (data.options && Array.isArray(data.options)) {
                    return data.options.map(o => {
                        if (typeof o === 'string') return o;
                        return o.label || o.value || o.text || String(o);
                    }).filter(Boolean);
                }
                // Vue 3 / alternative: check vm.$props or vm
                const props = vm.$props || vm;
                if (props.options && Array.isArray(props.options)) {
                    return props.options.map(o => {
                        if (typeof o === 'string') return o;
                        return o.label || o.value || o.text || String(o);
                    }).filter(Boolean);
                }
            }
        } catch (e) {}
        return [];
    };
    // Phase 1: 扫描 container 内的所有 .el-form-item
    const allItems = container.querySelectorAll('.el-form-item');
    const fields = [];
    const seenXpaths = new Set();
    const pushField = (field) => {
        const xp = String(field.xpath_smart || '').trim();
        if (xp && seenXpaths.has(xp)) return false;
        if (xp) seenXpaths.add(xp);
        fields.push(field);
        return true;
    };
    const selectFields = [];  // [{field, trigger}] — Phase 2 从这里读取 options
    for (const item of allItems) {
        // Prefer getBoundingClientRect over offsetParent — Element UI drawers
        // use position:fixed wrappers where offsetParent is often null while visible.
        if (quick) {
            const style = getComputedStyle(item);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            const rect = item.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
        }
        const label = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
        const input = item.querySelector('input:not([type="hidden"])');
        const textarea = item.querySelector('textarea');
        const trigger = item.querySelector('.el-select .el-input__inner');
        if (!label && !input && !textarea && !trigger) continue;
        const kind = classify(item);
        const inputEl = input || textarea;
        let currentValue = readValue(inputEl, trigger, item);
        const placeholder = (inputEl || trigger)?.getAttribute?.('placeholder') || '';
        const displayLabel = label || placeholder || '';
        const operable = trigger || inputEl;
        const xpath_smart = operable ? (formFieldXpathSmartOf(operable, label) || '') : '';
        // Two-level disabled detection (DOM native → ARIA on element itself)
        const disabled = isDisabled(inputEl, trigger, item);
        const required = isRequired(item, label, inputEl);
        const selected = !!(trigger && item.querySelector('.el-select-dropdown__item.is-selected, .el-select__tags-text'));
        const hasButton = (() => {
            const btns = item.querySelectorAll('button');
            for (let i = 0; i < btns.length; i++) {
                const t = btns[i].textContent.trim();
                if (buttonKeywords.some(k => t.includes(k))) return t;
            }
            return '';
        })();
        const field = { label: displayLabel, kind, currentValue, options: [], placeholder, required, disabled, selected, hasButton, xpath_smart };
        attachSection(field, operable || item);
        pushField(field);
        if (kind === 'select') {
            const t = trigger || item.querySelector('input:not([type="hidden"])');
            selectFields.push({ field, trigger: t });
        } else if (kind === 'radio') {
            field.options = [...item.querySelectorAll('.el-radio')].map(r => {
                const lab = r.querySelector('.el-radio__label');
                return ((lab && lab.textContent) || r.textContent || '').replace(/\\s+/g, ' ').trim();
            }).filter(Boolean);
        } else if (kind === 'checkbox') {
            field.options = [...item.querySelectorAll('.el-checkbox')].map(c => {
                const lab = c.querySelector('.el-checkbox__label');
                return ((lab && lab.textContent) || c.textContent || '').replace(/\\s+/g, ' ').trim();
            }).filter(Boolean);
        }
    }
    /* SCAN_SOURCE_B_EL_TABLE */
    const tables = container.querySelectorAll('.el-table');
    for (let ti = 0; ti < tables.length; ti++) {
        const table = tables[ti];
        if (quick && !isVisible(table)) continue;
        const bodyRows = table.querySelectorAll('.el-table__body-wrapper tbody tr, tbody tr');
        for (let ri = 0; ri < bodyRows.length; ri++) {
            const row = bodyRows[ri];
            if (isPagerRow(row)) continue;
            if (quick) {
                const style = getComputedStyle(row);
                if (style.display === 'none' || style.visibility === 'hidden') continue;
                const rect = row.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) continue;
            }
            const rowText = getRowLeadingText(row);
            if (!rowText) continue;
            const controls = collectTableControls(row);
            for (let ci = 0; ci < controls.length; ci++) {
                const ctrl = controls[ci];
                const cell = ctrl.cell;
                const el = ctrl.el;
                const kind = ctrl.kind;
                const colHeader = getColumnHeader(table, cell);
                const placeholder = (el.getAttribute && el.getAttribute('placeholder')) || '';
                const displayName = buildTableDisplayName(rowText, controls, ci, colHeader, placeholder);
                if (!displayName) continue;
                const inputEl = kind === 'select' ? null : el;
                const trigger = kind === 'select' ? el : null;
                const currentValue = readValue(inputEl, trigger, cell);
                const disabled = isDisabled(inputEl, trigger, cell);
                const xpath_smart = tableFieldXpathSmartOf(rowText, el, ci + 1);
                const field = {
                    label: displayName,
                    kind,
                    currentValue,
                    options: ctrl.options || [],
                    placeholder,
                    required: false,
                    disabled,
                    selected: !!(trigger && cell.querySelector('.el-select-dropdown__item.is-selected, .el-select__tags-text')),
                    hasButton: '',
                    xpath_smart,
                };
                attachSection(field, el);
                if (!pushField(field)) continue;
                if (kind === 'select' && trigger) {
                    selectFields.push({ field, trigger });
                }
            }
        }
    }
    /* SCAN_DEDUP_BY_XPATH */
    // Phase 2: 从 Vue 组件实例读取每个 select 的 options。
    // 不打开下拉框——Vue 组件实例存储了完整的 options 数据，精准无污染，
    // 避免读到表格分页下拉、相邻 select 下拉、body 级别残留等无关选项。
    for (const { field, trigger } of selectFields) {
        if (!trigger) continue;
        let opts = readVueOptions(trigger);
        if (opts.length > 0) {
            field.options = opts;
        } else if (field.currentValue) {
            field.options = [field.currentValue];
        }
    }
    // Check for el-notification error popup
    let notification = null;
    for (const notif of document.querySelectorAll('.el-notification')) {
        const r = notif.getBoundingClientRect();
        const s = getComputedStyle(notif);
        if (r.width > 0 && r.height > 0 && s.display !== 'none') {
            notification = { visible: true, text: (notif.textContent || '').trim().replace(/\\s+/g, ' ').substring(0, 300) };
            break;
        }
    }
    const containerId = (() => {
        const c = (() => {
            for (const d of document.querySelectorAll('.el-dialog')) if (d.offsetParent !== null) return d;
            for (const d of document.querySelectorAll('.el-drawer')) if (d.offsetParent !== null) return d;
            return document;
        })();
        if (c === document) return 'main';
        if (c.classList.contains('el-dialog')) {
            const t = (c.querySelector('.el-dialog__title')?.textContent || '').trim() || 'unnamed';
            return 'dialog:' + t;
        }
        if (c.classList.contains('el-drawer')) {
            const l = c.getAttribute('aria-label') || 'unnamed';
            return 'drawer:' + l;
        }
        const tp = c.closest('.el-tab-pane');
        if (tp) {
            const tabs = tp.closest('.el-tabs');
            if (tabs) {
                const a = tabs.querySelector('.el-tabs__item.is-active');
                if (a) return 'tab:' + a.textContent.trim();
            }
        }
        return 'unknown';
    })();
    /* SCAN_SOURCE_C_BUTTONS */
    const buttons = [];
    const btnSeen = new Set();
    for (const el of container.querySelectorAll('button, .el-button')) {
        if (quick && !isVisible(el)) continue;
        if (el.disabled || el.classList.contains('is-disabled')) continue;
        const label = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!label || label.length > 40) continue;
        const btnSec = {};
        attachSection(btnSec, el);
        const xpath_smart = xpathSmartOf(el, label, '', 'button') || '';
        const key = xpath_smart || (btnSec.section_id + '|' + label);
        if (btnSeen.has(key)) continue;
        btnSeen.add(key);
        buttons.push({ label, xpath_smart, section_id: btnSec.section_id, section_title: btnSec.section_title, disabled: false });
    }
    const result = { container: containerId, fields, buttons, notification };
    const json = JSON.stringify(result, null, 2);
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const scanTime = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const summary = { input:0, select:0, date:0, radio:0, checkbox:0, unknown:0, total:fields.length };
    fields.forEach(f => { if (summary[f.kind] !== undefined) summary[f.kind]++; });
    console.log('[AI填表] ====== 扫描的表单字段 ====== ' + scanTime + ' | ' +
        `input:${summary.input} select:${summary.select} date:${summary.date} radio:${summary.radio} checkbox:${summary.checkbox} total:${summary.total}`);
    console.log(json);
    return json;
}'''


JS_CHECK_SINGLE_FIELD = '''([label, buttonKeywords]) => {
    const container = ''' + JS_GET_CONTAINER + ''';
    const classify = ''' + JS_CLASSIFY_FIELD + ''';
    const isDisabled = ''' + JS_FIELD_DISABLED + ''';
    const isRequired = ''' + JS_FIELD_REQUIRED + ''';
    const readValue = ''' + JS_READ_CURRENT_VALUE + ''';
    for (let pass = 1; pass <= 2; pass++) {
        const exact = pass === 1;
        for (const item of container.querySelectorAll('.el-form-item')) {
            const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
            if (exact) { if (lbl !== label) continue; }
            else { if (lbl === label || !lbl.includes(label)) continue; }
            const input = item.querySelector('input:not([type="hidden"])');
            const textarea = item.querySelector('textarea');
            const trigger = item.querySelector('.el-select .el-input__inner');
            const kind = classify(item);
            const inputEl = input || textarea;
            let currentValue = readValue(inputEl, trigger, item);
            const placeholder = (inputEl || trigger)?.getAttribute?.('placeholder') || '';
            const disabled = isDisabled(inputEl, trigger, item);
            const selected = !!(trigger && item.querySelector('.el-select-dropdown__item.is-selected, .el-select__tags-text'));
            const hasButton = (() => {
                const btns = item.querySelectorAll('button');
                for (let i = 0; i < btns.length; i++) {
                    const t = btns[i].textContent.trim();
                    if (buttonKeywords.some(k => t.includes(k))) return t;
                }
                return '';
            })();
            const required = isRequired(item, lbl, inputEl);
            return JSON.stringify({ label: lbl, kind, currentValue, placeholder, disabled, selected, required, hasButton });
        }
    }
    return 'label-not-found';
}'''

