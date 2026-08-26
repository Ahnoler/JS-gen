"""JS_MANUAL_RECORDER part B (injected page script, second half)."""

JS_MANUAL_PART_B = r'''
  function elMeta(el, textOverride, kindHint, regionOverride) {
    const t = textOverride != null ? String(textOverride) : shortLabel(el);
    const hi = highlightIndexOf(el);
    const bu = buXPathOf(el);
    const abs = xpathOf(el);
    const formLbl = formItemLabel(el);
    const loc = buildLocatorSnap(el, t, abs, formLbl, {
      targetKind: kindHint || undefined,
      region: regionOverride || undefined,
    });
    const meta = {
      xpath: loc.xpath || bu || abs,
      bu_xpath: bu,
      xpath_abs: abs,
      xpath_full: loc.xpath_full || abs,
      xpath_smart: loc.xpath_smart || '',
      cssSelector: loc.cssSelector || '',
      candidates: loc.candidates || [],
      tag: loc.tag || (el.tagName || '').toLowerCase(),
      attributes: loc.attributes || attrs(el),
      text: loc.text || t,
      formLabel: loc.formLabel || formLbl || '',
      target_kind: loc.target_kind || kindHint || '',
      parent_text: loc.parent_text || '',
      icon_class: loc.icon_class || '',
      placeholder: loc.placeholder || '',
      locator_scope: loc.locator_scope || '',
      locator_occurrence: loc.locator_occurrence || 0,
      locator_verified: loc.locator_verified === true,
      locator_strategy: loc.locator_strategy || '',
      region_role: loc.region_role || '',
      region_id: loc.region_id || '',
      region_label: loc.region_label || '',
      region_chrome: loc.region_chrome || '',
      region_section: loc.region_section || '',
      region_block: loc.region_block || '',
      layers: Array.isArray(loc.layers) ? loc.layers : [],
      feature_card: loc.feature_card || undefined,
    };
    if (loc.locator_fallback_reason) meta.locator_fallback_reason = loc.locator_fallback_reason;
    if (hi != null) meta.highlight_index = hi;
    // Todo card actions (处理/转交/…) — stamp card business key / title for replay scope
    const todoCard = el.closest && el.closest('.todo-item');
    if (todoCard) {
      const blob = String(todoCard.innerText || todoCard.textContent || '');
      const keyM = blob.match(/\b(?:PJ|DGSX)\d+\b/);
      if (keyM) meta.parent_text = keyM[0];
      else {
        const titleLine = blob.split(/[\n\r]+/).map((s) => s.trim()).filter(Boolean)[0] || '';
        if (titleLine) meta.parent_text = titleLine.slice(0, 80);
      }
    }
    return meta;
  }

  function emitMenu(menuEl) {
    const menuText = shortLabel(menuEl);
    if (!menuText) return false;
    emit(Object.assign({ kind: 'click_menu_item', menu_text: menuText }, elMeta(menuEl, menuText)));
    return true;
  }

  function isNonRecordableFocusClick(el) {
    if (!el || !el.closest) return false;
    // Real action controls inside a form-item must still be recorded
    if (el.closest('.el-radio, .el-checkbox, .el-switch, button, .el-button, a[href], .el-upload')) {
      if (!el.closest('.el-select, .el-cascader, .el-date-editor, .el-input, .el-autocomplete')) {
        return false;
      }
    }
    if (el.closest(
      '.el-select, .el-cascader, .el-date-editor, .el-time-picker, .el-autocomplete,' +
      '.el-input__inner, .el-input__suffix, .el-input__prefix, .el-input__icon,' +
      '.el-textarea__inner, .el-select__caret, .el-input__suffix-inner'
    )) {
      return true;
    }
    const focusInput = el.closest('input, textarea, .el-input, .el-textarea');
    if (focusInput) {
      const tag = (focusInput.tagName || '').toLowerCase();
      const type = (focusInput.getAttribute && focusInput.getAttribute('type') || '').toLowerCase();
      if (
        tag === 'textarea' ||
        (tag === 'input' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image', 'hidden'].includes(type)) ||
        (focusInput.classList && (focusInput.classList.contains('el-input') || focusInput.classList.contains('el-textarea')))
      ) {
        return true;
      }
    }
    // Label / blank area of a field form-item (incl. select) — not a step
    const formItem = el.closest('.el-form-item');
    if (formItem && formItem.querySelector(
      '.el-select, .el-cascader, .el-date-editor, .el-time-picker, .el-autocomplete,' +
      '.el-input, .el-textarea, input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea'
    )) {
      return true;
    }
    return false;
  }

  // --- clicks (assigned so reinject can hot-update without duplicate listeners) ---
  window.__jsgenManualOnClick = (ev) => {
    if (!window.__jsgenManualEnabled) return;
    if (window.__jsgenManualSkipUntil && Date.now() < window.__jsgenManualSkipUntil) return;
    let el = ev.target;
    if (!el) return;
    if (el.nodeType !== 1) el = el.parentElement;
    if (!el || !el.closest) return;

    // Skip anonymous body teleports / masks (same junk as CDP /div[2] pattern)
    const junkCls = /(^| )(v-modal|el-loading-mask|el-overlay|el-dialog__wrapper|el-drawer__wrapper|el-message|el-notification|el-popper|el-select-dropdown|el-picker-panel)( |$)/;
    if (el === document.body || el === document.documentElement) return;
    if (junkCls.test(String(el.className || ''))) {
      if (!el.closest('.el-select-dropdown__item, .el-cascader-node, .el-picker-panel td')) return;
    }
    if (el.parentElement === document.body && !el.id && !String(el.className || '').trim()) return;

    // el-select option
    const opt = el.closest('.el-select-dropdown__item');
    if (opt) {
      const optionText = visibleText(opt);
      // find active select input if possible
      const open = document.querySelector('.el-select .el-input.is-focus, .el-select .is-focus');
      const label = open ? formItemLabel(open) : '';
      const dropdown = opt.closest('.el-select-dropdown') || opt.parentElement;
      const options = [];
      const seen = new Set();
      if (dropdown) {
        dropdown.querySelectorAll('.el-select-dropdown__item').forEach((item) => {
          if (item.classList && item.classList.contains('is-disabled')) return;
          const t = visibleText(item);
          if (!t || t === '请选择' || seen.has(t)) return;
          seen.add(t);
          options.push(t);
        });
      }
      // Also try Vue options on the focused select
      try {
        const selectEl = open && open.closest ? open.closest('.el-select') : null;
        const vm = selectEl && selectEl.__vue__;
        const ingest = (arr) => {
          if (!arr) return;
          const values = Array.isArray(arr) ? arr
            : (typeof arr.values === 'function' ? [...arr.values()] : Object.values(arr));
          for (const o of values) {
            let t = '';
            if (typeof o === 'string' || typeof o === 'number') t = String(o);
            else if (o) t = String(o.label ?? o.currentLabel ?? (o.$props && o.$props.label) ?? o.value ?? '');
            t = t.replace(/\s+/g, ' ').trim();
            if (!t || t === '请选择' || seen.has(t)) continue;
            seen.add(t);
            options.push(t);
          }
        };
        if (vm) {
          ingest(vm.options);
          ingest(vm.cachedOptions);
          ingest(vm.$data && vm.$data.options);
        }
      } catch (e) {}
      const meta = elMeta(opt, optionText, 'form_select');
      emit(Object.assign({
        kind: 'select_option',
        label_text: label,
        option_text: optionText,
        options: options,
        tag: meta.tag || 'li',
        attributes: meta.attributes || attrs(opt),
        text: optionText,
      }, meta));
      return;
    }

    // Date picker day → fill_date (calendar pick, not typed)
    const dateTd = el.closest('.el-date-table td');
    if (dateTd && dateTd.closest('.el-picker-panel, .el-date-picker')) {
      const built = dateValueFromPickerCell(dateTd);
      const before = Array.from(document.querySelectorAll('.el-date-editor')).filter((ed) => ed.offsetParent !== null).map((ed) => {
        const input = ed.querySelector('input');
        return { label: formItemLabel(ed), value: String((input && input.value) || '').trim() };
      });
      openDateEditorMeta();
      // Defer: detect which date field changed (multi-date forms); also covers year/month arrow focus loss
      setTimeout(() => {
        const after = Array.from(document.querySelectorAll('.el-date-editor')).filter((ed) => ed.offsetParent !== null).map((ed) => {
          const input = ed.querySelector('input');
          return { label: formItemLabel(ed), value: String((input && input.value) || '').trim(), input: input, ed: ed };
        });
        const beforeMap = {};
        for (const b of before) beforeMap[b.label] = b.value;
        let pick = null;
        const changed = after.filter((a) => a.label && a.value && a.value !== (beforeMap[a.label] || ''));
        if (built) pick = changed.find((a) => a.value === built) || null;
        if (!pick && changed.length === 1) pick = changed[0];
        if (!pick && changed.length > 1) pick = changed[changed.length - 1];
        if (!pick) {
          const meta = openDateEditorMeta();
          const value = String((meta.input && meta.input.value) || built || '').trim();
          const label = (meta.label || '').trim();
          if (value && label) pick = { label: label, value: value, input: meta.input };
        }
        if (!pick || !pick.label || !pick.value) return;
        emit(Object.assign({
          kind: 'fill_date',
          label_text: pick.label,
          value: pick.value,
        }, elMeta(pick.input || dateTd, pick.value)));
      }, 80);
      return;
    }
    if (el.closest('.el-picker-panel, .el-date-picker, .el-time-panel')) {
      openDateEditorMeta();
      return;
    }

    // Opening select/cascader/date is NOT a step — only the option pick above counts
    if (
      el.closest('.el-select') ||
      el.closest('.el-cascader') ||
      el.closest('.el-date-editor') ||
      el.closest('.el-time-picker') ||
      el.closest('.el-autocomplete')
    ) {
      const dateEd = el.closest('.el-date-editor');
      if (dateEd) {
        try { window.__jsgenActiveDateEditor = dateEd; } catch (e) {}
      }
      return;
    }

    // Focusing a text field is NOT a step — fill is recorded on leave / change
    if (isNonRecordableFocusClick(el)) {
      return;
    }

    // Element UI / dropdown menu (including popup menus teleported to body)
    const menu = el.closest(
      '.el-menu-item, .el-submenu__title, .el-menu--popup .el-menu-item, .el-dropdown-menu__item, [role="menuitem"]'
    );
    if (menu && emitMenu(menu)) return;

    // Sidebar / nav area: custom menus without el-menu classes (e.g. 客户管理)
    const navRoot = el.closest(
      'aside, .el-aside, nav, .el-menu, [class*="sidebar"], [class*="side-menu"], [class*="SideMenu"], [class*="nav-menu"], [class*="NavMenu"], [class*="menu-wrap"]'
    );
    if (navRoot) {
      const item = el.closest('li, a, button, [role="menuitem"], [class*="menu-item"], [class*="MenuItem"]') || el;
      if (emitMenu(item)) return;
    }

    // table row action button
    const rowBtn = el.closest('.el-table__body .el-button, .el-table__body button, .el-table__body a');
    if (rowBtn) {
      const rowText = tableRowIdentityText(rowBtn).slice(0, 40);
      const buttonText = visibleText(rowBtn);
      emit(Object.assign({
        kind: 'click_table_row_button',
        row_text: rowText,
        button_text: buttonText,
      }, elMeta(rowBtn, buttonText)));
      return;
    }

    // table row radio (e.g. 客户列表 / dialog picker) — identify row by main-body cell text
    const tableRadio = el.closest(
      '.el-table__body .el-radio, .el-table__body .el-radio-button, .el-table__row .el-radio, .el-table__row .el-radio-button,' +
      '.el-table__fixed .el-radio, .el-table__fixed-body-wrapper .el-radio, .el-table__fixed-left .el-radio'
    );
    if (tableRadio) {
      let rowText = tableRowIdentityText(tableRadio);
      if (!rowText) {
        const row = tableRadio.closest('.el-table__row, tr');
        const key = row && row.getAttribute && (row.getAttribute('data-row-key') || row.getAttribute('data-key'));
        if (key) rowText = String(key);
        else if (row && row.parentElement) {
          const sibs = Array.from(row.parentElement.children).filter(
            (r) => r.nodeType === 1 && ((r.classList && r.classList.contains('el-table__row')) || r.tagName === 'TR')
          );
          const idx = sibs.indexOf(row);
          if (idx >= 0) rowText = 'row-index:' + idx;
        }
      }
      if (rowText) {
        emit(Object.assign({
          kind: 'click_table_row_radio',
          row_text: rowText,
        }, elMeta(tableRadio, rowText)));
        return;
      }
      // Still no identity — fall through to enriched click rather than drop the step
    }

    // radio in form
    const radio = el.closest('.el-radio, .el-radio-button');
    if (radio) {
      const label = formItemLabel(radio);
      const optionText = visibleText(radio);
      const meta = elMeta(radio, optionText, 'form_radio');
      emit(Object.assign({
        kind: 'click_radio',
        label_text: label,
        option_text: optionText,
        tag: meta.tag || radio.tagName.toLowerCase(),
        attributes: meta.attributes || attrs(radio),
        text: optionText,
      }, meta));
      return;
    }

    // tab
    const tab = el.closest('.el-tabs__item');
    if (tab) {
      const tabText = visibleText(tab);
      const meta = elMeta(tab, tabText, 'tab');
      emit(Object.assign({
        kind: 'switch_tab',
        tab_name: tabText,
        tag: meta.tag || tab.tagName.toLowerCase(),
        attributes: meta.attributes || attrs(tab),
        text: tabText,
      }, meta));
      return;
    }

    // dialog close
    if (el.closest('.el-dialog__headerbtn, .el-drawer__close-btn')) {
      const meta = elMeta(el, 'close', 'dialog_close');
      emit(Object.assign({
        kind: 'close_dialog',
        tag: meta.tag || el.tagName.toLowerCase(),
        attributes: meta.attributes || attrs(el),
        text: '',
      }, meta));
      return;
    }

    // adjacent button next to form label (引入/查询 etc.)
    const adjBtn = el.closest('.el-form-item .el-button, .el-form-item button');
    if (adjBtn) {
      const label = formItemLabel(adjBtn);
      if (label) {
        emit(Object.assign({
          kind: 'click_adjacent_button',
          label_text: label,
        }, elMeta(adjBtn, visibleText(adjBtn))));
        return;
      }
    }

    // Icon buttons (tooltip / aria-label / Vue content) — fallback before generic button
    const iconHost = el.closest('[class*="el-icon-"], .el-tooltip, i[class*="icon"]');
    if (iconHost && !isInIgnore(iconHost)) {
      if (_iconHasIconClass(iconHost) && !_iconIsExcludedHost(iconHost)) {
        const btnText = _iconResolveLabel(iconHost);
        if (btnText) {
          emit(Object.assign({
            kind: 'click_icon_button',
            button_text: btnText,
          }, elMeta(iconHost, btnText)));
          return;
        }
      }
    }

    // Todo / workflow card action links (待办「处理」「转交」…) — plain div, not button/a
    const todoAction = el.closest('.todo-item-action');
    if (todoAction && !isInIgnore(todoAction)) {
      const text = shortLabel(todoAction);
      if (text && text.length <= 20) {
        emit(Object.assign({ kind: 'click' }, elMeta(todoAction, text)));
        return;
      }
    }

    // generic button / link / clickable
    const btn = el.closest('button, .el-button, a.el-link, a[href], [role="button"]');
    if (btn && !isInIgnore(btn)) {
      // Extra guard: never record select/date openers as clicks
      if (btn.closest('.el-select') || btn.closest('.el-cascader') || btn.closest('.el-date-editor')) {
        return;
      }
      const text = shortLabel(btn) || (btn.getAttribute && (btn.getAttribute('aria-label') || btn.getAttribute('title'))) || '';
      if (!text && (btn.tagName || '').toLowerCase() === 'div') return;
      emit(Object.assign({ kind: 'click' }, elMeta(btn, text)));
      return;
    }

    // tree node — form tree-select popover → select_tree_option; sidebar stays click
    const tree = el.closest('.el-tree-node__content');
    if (tree) {
      const formHost = (typeof resolveFormTreeSelectHostFromPopoverTree === 'function')
        ? resolveFormTreeSelectHostFromPopoverTree(tree)
        : null;
      if (formHost) {
        const optionText = stripVolatileTreeText(shortLabel(tree) || cleanVisibleText(tree));
        const item = formHost.closest && formHost.closest('.el-form-item');
        const lblEl = item && item.querySelector('.el-form-item__label, label');
        const labelText = normalizeFormLabel(lblEl && lblEl.textContent);
        if (labelText && optionText) {
          emit(Object.assign({
            kind: 'select_tree_option',
            label_text: labelText,
            option_text: optionText,
          }, elMeta(formHost, optionText)));
          return;
        }
      }
      emit(Object.assign({ kind: 'click' }, elMeta(tree)));
      return;
    }

    // Never emit empty anonymous div/span clicks (CDP /div[2] junk pattern)
    // or date-string clicks from reopening a filled date editor
    const tag = (el.tagName || '').toLowerCase();
    const t = shortLabel(el);
    if (/^\d{4}-\d{2}-\d{2}$/.test(t) && (tag === 'div' || tag === 'span' || tag === 'input')) {
      return;
    }
    if (el.parentElement === document.body && tag === 'div' && !el.id && !String(el.className || '').trim()) {
      return;
    }
    if (!t && (tag === 'div' || tag === 'span') && !String(el.className || '').trim() && !el.id) {
      return;
    }

    // Last-resort: any element with short visible text that looks like a control
    // (covers custom sidebar spans that are not inside known nav roots)
    if (!isInIgnore(el)) {
      const host = el.closest(
        '[onclick], [ng-click], [class*="menu"], [class*="nav-item"], [class*="NavItem"],'
        + ' [class*="item-action"], [class*="todo-item-action"]'
      );
      if (host) {
        const text = shortLabel(host);
        if (text && text.length <= 20) {
          emit(Object.assign({ kind: 'click_menu_item', menu_text: text }, elMeta(host, text)));
        }
      }
    }
  };

  // --- input / change (form fields) ---
  function emitFill(el) {
    if (!window.__jsgenManualEnabled) return;
    if (!el || isInIgnore(el)) return;
    if (el.type === 'hidden' || el.type === 'password' && false) { /* allow password */ }
    const tag = (el.tagName || '').toLowerCase();
    if (tag !== 'input' && tag !== 'textarea') return;
    if (el.closest('.el-select')) return; // select handled via option click
    // Date: prefer calendar pick recording; only emit typed non-empty values.
    // TODO(date-leave-backup): blur/change 到其他字段时，若日期 input 已有非空值则补录
    // fill_date（与 src/cdp/inspect.js resolveFocusedFillPayload 同需求）。选天主路径够用前不实现。
    const isDate = !!el.closest('.el-date-editor');
    const label = formItemLabel(el);
    const value = el.value || '';
    if (!String(value).trim()) return;
    const kind = isDate ? 'fill_date' : 'fill';
    // 统一：xpath 抓取复用自动算法（elMeta → buildLocatorSnap → formFieldXpathSmartOf，与
    // JS_CAPTURE_FROM_XPATH 同源）。label_text 用完整 placeholder（不剥「请输入」前缀），
    // 回放时 JS_FILL_FORM_FIELD / JS_FILL_BY_XPATH 的 placeholder 分支按完整文本精确命中。
    const fullPh = (el.getAttribute && el.getAttribute('placeholder') || '').trim();
    // formItemLabel 在无真实 label 时回退 placeholderLabel（剥「请输入」前缀）——
    // 若所得 label 是完整 placeholder 的子串，说明是剥离产物，改回完整 placeholder。
    const labelText = (label && fullPh && fullPh.includes(label) && label !== fullPh)
      ? fullPh : (label || fullPh);
    const meta = elMeta(el, value);
    emit(Object.assign({
      kind: kind,
      label_text: labelText,
      value: value,
      text: value.slice(0, 80),
    }, meta));
  }

  window.__jsgenManualOnChange = (ev) => {
    const el = ev.target;
    if (el && el.matches && el.matches('input, textarea')) emitFill(el);
  };

  window.__jsgenManualOnBlur = (ev) => {
    const el = ev.target;
    if (el && el.matches && el.matches('input, textarea')) emitFill(el);
  };

  if (!window.__jsgenManualInstalled) {
    window.__jsgenManualInstalled = true;
    document.addEventListener('click', (ev) => {
      if (typeof window.__jsgenManualOnClick === 'function') window.__jsgenManualOnClick(ev);
    }, true);
    document.addEventListener('change', (ev) => {
      if (typeof window.__jsgenManualOnChange === 'function') window.__jsgenManualOnChange(ev);
    }, true);
    document.addEventListener('blur', (ev) => {
      if (typeof window.__jsgenManualOnBlur === 'function') window.__jsgenManualOnBlur(ev);
    }, true);
  }

  return 'installed';
})()'''
