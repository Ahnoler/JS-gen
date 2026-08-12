"""
JS snippet constants: JS_SCAN_FORM_FIELDS, JS_CHECK_SINGLE_FIELD (extracted from _js_snippets.py).
Re-exported by scripts/controller/actions/_js_snippets.py for backward compat.
"""
from .scan_utils import JS_CLASSIFY_FIELD
from .base import JS_FIELD_DISABLED
from .scan_utils import JS_FIELD_REQUIRED
from .container import JS_GET_CONTAINER
from .scan_utils import JS_READ_CURRENT_VALUE
from ._locator_helpers_js import PAGE_LOCATOR_HELPERS

JS_SCAN_FORM_FIELDS = '''async ([quick, buttonkeywords, opts]) => {
''' + PAGE_LOCATOR_HELPERS + '''
    const classify = ''' + JS_CLASSIFY_FIELD + ''';
    const isDisabled = ''' + JS_FIELD_DISABLED + ''';
    const isRequired = ''' + JS_FIELD_REQUIRED + ''';
    const readValue = ''' + JS_READ_CURRENT_VALUE + ''';
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
        /* COLLECT_L2_TABLE_KIND_PARITY */
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
        let local;
        const syn = /^row#(\\d+)$/.exec(rowT);
        if (syn) {
            /* COLLECT_L2_TABLE_ROW_INDEX_XPATH */
            const idx = syn[1];
            local = "(tbody/tr)[" + idx + "]//" + leaf;
        } else {
            local = "tr[.//*[normalize-space()=" + lit + "]]//" + leaf;
        }
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
    const wrapOk = (d) => {
        if (!d) return false;
        const wrap = d.closest && d.closest('.el-dialog__wrapper, .el-message-box__wrapper, .el-drawer__wrapper');
        if (wrap && getComputedStyle(wrap).display === 'none') return false;
        if (d.offsetParent !== null) return true;
        const st = getComputedStyle(d);
        if (st.display === 'none' || st.visibility === 'hidden') return false;
        const r = d.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    const getMainContentRoot = () => {
        const main = document.querySelector('.el-main');
        if (main) return main;
        const host = document.querySelector('#app, .app-main, .el-container, main');
        return host || document;
    };
    const getMultiRoots = () => {
        const overlays = [...document.querySelectorAll('.el-dialog, .el-message-box, .el-drawer')].filter(wrapOk);
        if (overlays.length) return overlays;
        return [getMainContentRoot()];
    };
    const isFullpage = !!(opts && opts.mode === 'fullpage');
    const isMulti = !!(opts && opts.mode === 'multi');
    /* FULLPAGE_L2_POOL — document root includes shell; multi keeps overlay/main sans forced shell strip */
    const scanRoots = isFullpage
        ? [document]
        : (isMulti ? getMultiRoots() : [''' + JS_GET_CONTAINER + ''']);
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
    const buttons = [];
    const btnSeen = new Set();
    /* COLLECT_L2 — taxonomy button pool; NO form-item/table gate */
    function collectL2Buttons(root, quick) {
        const out = [];
        const seen = new Set();
        const sels = 'button, .el-button, .todo-item-action';
        for (const el of (root || document).querySelectorAll(sels)) {
            if (quick && !isVisible(el)) continue;
            if (el.disabled || (el.classList && el.classList.contains('is-disabled'))) continue;
            const kind = (typeof classifyOperable === 'function')
              ? classifyOperable(el)
              : 'button';
            if (!kind || (kind !== 'button' && kind !== 'icon' && kind !== 'menu')) continue;
            const label = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
            if (!label || label.length > 40) continue;
            const xpath_smart = xpathSmartOf(el, label, '', 'button') || '';
            const reg = (typeof assignRegion === 'function') ? assignRegion(el) : null;
            const key = xpath_smart || ((reg && reg.region_id) || '') + '|' + label;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
                label,
                xpath_smart,
                disabled: false,
                region_role: reg ? reg.region_role : '',
                region_id: reg ? reg.region_id : '',
                region_label: reg ? reg.region_label : '',
                section_id: (reg && reg.region_id) ? reg.region_id : '__root__',
                section_title: (reg && reg.region_label) ? reg.region_label : '',
            });
        }
        return out;
    }
    const stampRegionAndLegacyMirror = (field, el) => {
        /* ASSIGN_VIA_ASSIGN_REGION — LEGACY mirror section_* until favor-region Phase E */
        if (!el || typeof assignRegion !== 'function') return;
        const reg = assignRegion(el);
        field.region_role = reg.region_role;
        field.region_id = reg.region_id;
        field.region_label = reg.region_label;
        field.section_id = reg.region_id || '__root__';
        field.section_title = reg.region_label || '';
    };
    /* DISCOVER_L1 — feature cards; seed selectors OK for P0 */
    function discoverL1() {
        const regions = [];
        const candSels = [
            { sel: '.el-header, .navbar, header', role: 'shell-header' },
            { sel: '.el-aside, .sidebar, aside', role: 'shell-aside' },
            { sel: '.el-dialog, .el-drawer', role: 'overlay' },
            { sel: '.el-table', role: 'table' },
            { sel: '.tssc-multiple-table-content, .myTable', role: 'custom:tssc-table' },
            { sel: '.el-collapse-item', role: 'section' },
            { sel: '.todo-item', role: 'section' },
            { sel: '.el-main, .app-main, main', role: 'main' },
        ];
        const seenReg = new Set();
        for (const { sel, role } of candSels) {
            for (const el of document.querySelectorAll(sel)) {
                if (!isVisible(el) && role !== 'shell-header' && role !== 'shell-aside') {
                    const r = el.getBoundingClientRect();
                    if (r.width < 1 || r.height < 1) continue;
                }
                const rect = el.getBoundingClientRect();
                let title = (el.getAttribute('aria-label')
                    || el.querySelector?.('.el-dialog__title, .el-collapse-item__header, .el-menu-item.is-active')?.textContent
                    || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
                if (!title && role === 'section' && el.classList && el.classList.contains('todo-item')) {
                    const blob = String(el.innerText || el.textContent || '');
                    const keyM = blob.match(/\\b(?:PJ|DGSX)\\d+\\b/);
                    if (keyM) title = keyM[0];
                    else {
                        const header = el.querySelector('.todo-item__header');
                        let ht = header ? String(header.innerText || '').replace(/\\s+/g, ' ').trim() : '';
                        const actions = header && header.querySelector('.todo-item-actions');
                        if (actions) {
                            const at = String(actions.innerText || '').replace(/\\s+/g, ' ').trim();
                            if (at) ht = ht.replace(at, '').replace(/\\s+/g, ' ').trim();
                        }
                        title = (ht || blob.split(/[\\n\\r]+/).map((s) => s.trim()).filter(Boolean)[0] || '').slice(0, 40);
                    }
                }
                const classTokens = String(el.className || '').split(/\\s+/).filter(Boolean).slice(0, 8);
                const id = role + ':' + classTokens.slice(0, 2).join('.') + ':' + Math.round(rect.y);
                if (seenReg.has(id)) continue;
                seenReg.add(id);
                /* L1_FEATURE_CARD */
                regions.push({
                    id,
                    role,
                    title,
                    classTokens,
                    band: rect.y < 80 ? 'top' : (rect.x < 120 ? 'side' : 'center'),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                    childHint: {
                        formItems: el.querySelectorAll('.el-form-item').length,
                        tables: el.querySelectorAll('.el-table').length,
                        buttons: el.querySelectorAll('button, .el-button, .todo-item-action').length,
                    },
                });
            }
        }
        return regions;
    }
    for (let _ri = 0; _ri < scanRoots.length; _ri++) {
    const container = scanRoots[_ri];
    // Phase 1: 扫描 container 内的所有 .el-form-item
    /* COLLECT_L2_FORM */
    const allItems = container.querySelectorAll('.el-form-item');
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
                if (buttonkeywords.some(k => t.includes(k))) return t;
            }
            return '';
        })();
        const field = { label: displayLabel, kind, currentValue, options: [], placeholder, required, disabled, selected, hasButton, xpath_smart };
        stampRegionAndLegacyMirror(field, operable || item);
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
    /* COLLECT_L2_TABLE */
    const tables = container.querySelectorAll('.el-table');
    for (let ti = 0; ti < tables.length; ti++) {
        const table = tables[ti];
        if (quick && !isVisible(table)) continue;
        const bodyRows = table.querySelectorAll('.el-table__body-wrapper tbody tr, tbody tr');
        /* COLLECT_L2_TABLE_EMPTY_LEADING */
        let domRowIndex = 0;
        for (let ri = 0; ri < bodyRows.length; ri++) {
            const row = bodyRows[ri];
            if (isPagerRow(row)) continue;
            domRowIndex += 1;
            if (quick) {
                const style = getComputedStyle(row);
                if (style.display === 'none' || style.visibility === 'hidden') continue;
                const rect = row.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) continue;
            }
            let rowText = getRowLeadingText(row);
            if (!rowText) {
                rowText = 'row#' + domRowIndex;
            }
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
                stampRegionAndLegacyMirror(field, el);
                if (!pushField(field)) continue;
                if (kind === 'select' && trigger) {
                    selectFields.push({ field, trigger });
                }
            }
        }
    }
    /* COLLECT_L2 — buttons within scan root (non-fullpage) */
    if (!isFullpage) {
        for (const b of collectL2Buttons(container, quick)) {
            const key = b.xpath_smart || ((b.section_id || b.region_id || '') + '|' + b.label);
            if (btnSeen.has(key)) continue;
            btnSeen.add(key);
            buttons.push(b);
        }
    }
    } /* end scanRoots */
    /* COLLECT_L2 call site */
    if (isFullpage) {
        for (const b of collectL2Buttons(document, quick)) {
            const key = b.xpath_smart || ((b.region_id || '') + '|' + b.label);
            if (btnSeen.has(key)) continue;
            btnSeen.add(key);
            buttons.push(b);
        }
    }
    /* SCAN_DEDUP_BY_XPATH — pushField uses seenXpaths */
    /* L2_ADMIT / L2_NO_CONTAINER_GATE — fullpage extras outside form-item / el-table gates */
    if (isFullpage) {
        /* CHROME_NOISE_FILTER — hard-exclude portal chrome menus / decorative icons */
        const isChromeMenuLabel = (label) => {
            const t = String(label || '').trim();
            if (!t) return false;
            if (t.includes('布局')) return true;
            if (t.includes('主题')) return true;
            if (t.includes('页签') && (t.includes('关闭') || t.includes('固定'))) return true;
            // Portal synonym: 标签 ≈ 页签 (e.g. 关闭所有标签(含固定))
            if (t.includes('标签') && (t.includes('关闭') || t.includes('固定'))) return true;
            return false;
        };
        const isChromeHost = (el) => {
            if (!el || !el.closest) return false;
            // Chrome-scoped only — NOT every .el-dropdown-menu on the page
            if (el.closest('.tags-view-wrapper .contextmenu, .tags-view-item .el-dropdown-menu, .tags-view .contextmenu')) return true;
            if (el.closest('.navbar-right, .right-menu, .header-setting, .layout-setting, .theme-picker')) return true;
            const dd = el.closest('.el-dropdown-menu');
            if (dd && dd.closest && dd.closest('.right-menu, .navbar-right, .header-setting, .layout-setting')) return true;
            return false;
        };
        const isChromeNoise = (el, kind, label) => {
            if (isChromeMenuLabel(label)) return true;
            if (isChromeHost(el)) return true;
            if (kind === 'icon') {
                const cls = String(el && el.className || '');
                if (/arrow|caret|close|loading/i.test(cls)) return true;
            }
            return false;
        };
        const menuSels = [
            '.el-menu-item',
            '.el-submenu__title',
            '.el-dropdown-menu__item',
            'nav a',
            '.navbar a',
            '.sidebar-item',
            '.el-aside .el-menu-item',
            '.tags-view-item',
        ];
        for (const sel of menuSels) {
            for (const el of document.querySelectorAll(sel)) {
                if (quick && !isVisible(el)) continue;
                const label = (el.innerText || el.textContent || el.getAttribute('aria-label') || '')
                    .replace(/\\s+/g, ' ').trim();
                if (!label || label.length > 40) continue;
                if (isChromeNoise(el, 'menu_item', label)) continue;
                const xpath_smart = xpathSmartOf(el, label, '', 'menu_item') || '';
                const field = {
                    label,
                    kind: 'menu_item',
                    currentValue: '',
                    options: [],
                    placeholder: '',
                    required: false,
                    disabled: !!(el.classList && el.classList.contains('is-disabled')),
                    selected: !!(el.classList && el.classList.contains('is-active')),
                    hasButton: '',
                    xpath_smart,
                };
                stampRegionAndLegacyMirror(field, el);
                pushField(field);
            }
        }
        for (const el of document.querySelectorAll('[aria-label], a.el-tooltip, i.el-tooltip')) {
            if (quick && !isVisible(el)) continue;
            if (el.closest && el.closest('button, .el-button, .el-menu-item, .el-form-item')) continue;
            const label = (el.getAttribute('aria-label') || el.getAttribute('title') || '')
                .replace(/\\s+/g, ' ').trim();
            if (!label || label.length > 40) continue;
            if (isChromeNoise(el, 'icon', label)) continue;
            const xpath_smart = xpathSmartOf(el, label, '', 'icon') || '';
            const field = {
                label,
                kind: 'icon',
                currentValue: '',
                options: [],
                placeholder: '',
                required: false,
                disabled: false,
                selected: false,
                hasButton: '',
                xpath_smart,
            };
            stampRegionAndLegacyMirror(field, el);
            pushField(field);
        }
    }
    /* L1_FEATURE_CARD + ASSIGN_L2_TO_L1
     * regionLabelOf / assignRegion come from PAGE_LOCATOR_HELPERS (SHARED_ASSIGN_REGION).
     * Do NOT redeclare here — duplicate const/function → SyntaxError in page.evaluate. */
    const regions = isFullpage ? discoverL1() : [];
    if (isFullpage) {
        for (const f of fields) {
            if (f.region_label) continue;
            // Best-effort: re-find by xpath is heavy; attach region via section / heuristics on label path
            const roleGuess = (f.kind === 'menu_item')
                ? { region_role: 'shell-aside', region_id: 'shell-aside', region_label: regionLabelOf('shell-aside') }
                : (f.section_title
                    ? {
                        region_role: 'section',
                        region_id: 'section:' + String(f.section_title).slice(0, 40),
                        region_label: regionLabelOf('section', f.section_title),
                    }
                    : { region_role: 'main', region_id: 'main', region_label: regionLabelOf('main') });
            f.region_role = roleGuess.region_role;
            f.region_id = roleGuess.region_id;
            f.region_label = roleGuess.region_label;
        }
        /* ASSIGN_L2_TO_L1 */
        for (const b of buttons) {
            if (b.region_label) continue;
            b.region_role = b.section_title ? 'section' : 'main';
            b.region_id = b.section_title ? ('section:' + String(b.section_title).slice(0, 40)) : 'main';
            b.region_label = b.section_title ? regionLabelOf('section', b.section_title) : regionLabelOf('main');
        }
    }
    // Phase 2: 从 Vue 组件实例读取每个 select 的 options。
    // 不打开下拉框——Vue 组件实例存储了完整的 options 数据，精准无污染。
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
    const result = {
        container: containerId,
        fields,
        buttons,
        notification,
        scope: isFullpage ? 'fullpage' : (isMulti ? 'active+visible-overlays' : 'container'),
        regions: isFullpage ? regions.slice(0, 40) : undefined,
    };
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

