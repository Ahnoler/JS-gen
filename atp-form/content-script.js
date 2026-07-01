const CTRL = {
  getContainer: () => {
    for (const d of document.querySelectorAll('.el-dialog'))
      if (d.offsetParent !== null) return d
    for (const d of document.querySelectorAll('.el-drawer'))
      if (d.offsetParent !== null) return d
    return document
  },
  classifyField: (item) => {
    if (item.querySelector('.el-date-editor, .tsscdatepicker, [class*="date-picker"], [class*="datepicker"]')) return 'date'
    const el = item.querySelector('input:not([type="hidden"])')
    if (el && el.closest('.el-date-editor, .tsscdatepicker')) return 'date'
    if (el && el.getAttribute('type') === 'date') return 'date'
    if (item.querySelector('.el-select')) return 'select'
    if (item.querySelector('.el-radio')) return 'radio'
    if (item.querySelector('.el-checkbox')) return 'checkbox'
    if (el || item.querySelector('textarea')) return 'input'
    return 'unknown'
  },
  isDisabled: (inputEl, trigger) => {
    // Only check native disabled, NOT readOnly.
    // Element UI el-select uses readOnly on internal input — it's still operable.
    if (trigger) return !!trigger.disabled
    if (inputEl) return !!inputEl.disabled
    return false
  },
  isRequired: (item, label) => {
    const hasRequiredClass = !!(item.matches('.is-required') || item.querySelector('.el-form-item__label .el-form-item__label--required'))
    const hasAsterisk = /\*/.test(label)
    const inputEl = item.querySelector('input:not([type="hidden"]), textarea')
    const hasNativeRequired = (inputEl?.required) || (inputEl?.getAttribute('aria-required') === 'true')
    return hasRequiredClass || hasAsterisk || hasNativeRequired
  },
  readVueOptions: (trigger) => {
    // Read el-select options from Vue component instance, not from DOM dropdowns.
    // Avoids reading stale/adjacent dropdown items.
    try {
      const selectEl = trigger.closest('.el-select')
      const vm = selectEl && selectEl.__vue__
      if (vm) {
        const data = vm.$data || vm
        if (data.options && Array.isArray(data.options)) {
          return data.options.map(o => {
            if (typeof o === 'string') return o
            return o.label || o.value || o.text || String(o)
          }).filter(Boolean)
        }
        const props = vm.$props || vm
        if (props.options && Array.isArray(props.options)) {
          return props.options.map(o => {
            if (typeof o === 'string') return o
            return o.label || o.value || o.text || String(o)
          }).filter(Boolean)
        }
      }
    } catch (e) {}
    return []
  },
  fillFormField: (label, val) => {
    const setFn = (t, v) => {
      const TagProto = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement
      const setter = Object.getOwnPropertyDescriptor(TagProto.prototype, 'value').set
      setter.call(t, v)
      t.setAttribute('value', v)
      t.dispatchEvent(new Event('input', { bubbles: true }))
      t.dispatchEvent(new Event('change', { bubbles: true }))
      t.dispatchEvent(new Event('blur', { bubbles: true }))
    }
    const c = CTRL.getContainer()
    const items = c.querySelectorAll('.el-form-item')
    // Pass 1: exact label match
    for (const item of items) {
      const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || ''
      if (lbl !== label) continue
      const input = item.querySelector('input:not([type="hidden"])')
      const textarea = item.querySelector('textarea')
      const target = input || textarea
      if (!target) return 'no-input-found'
      if (target.disabled || target.readOnly) return 'field-disabled'
      if (target.closest('.el-date-editor, .tsscdatepicker')) {
        target.focus()
        setFn(target, val)
        target.blur()
        try { let vm = target.__vue__; if (vm) { let p = vm.$parent; if (p && p.$options && p.$options.name === 'ElDatePicker') { p.value = val; p.$emit('input', val); p.$emit('change', val) } } } catch (e) {}
        document.querySelectorAll('.el-picker-panel,.el-date-picker').forEach(x => { x.style.display = 'none'; x.classList.add('is-hidden') })
        return 'ok-date'
      }
      setFn(target, val)
      return 'ok'
    }
    // Pass 2: partial label match (exclude exact matches already tried)
    for (const item of items) {
      const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || ''
      if (lbl === label) continue
      if (!lbl.includes(label)) continue
      const input = item.querySelector('input:not([type="hidden"])')
      const textarea = item.querySelector('textarea')
      const target = input || textarea
      if (!target) return 'no-input-found'
      if (target.disabled || target.readOnly) return 'field-disabled'
      if (target.closest('.el-date-editor, .tsscdatepicker')) {
        target.focus()
        setFn(target, val)
        target.blur()
        try { let vm = target.__vue__; if (vm) { let p = vm.$parent; if (p && p.$options && p.$options.name === 'ElDatePicker') { p.value = val; p.$emit('input', val); p.$emit('change', val) } } } catch (e) {}
        document.querySelectorAll('.el-picker-panel,.el-date-picker').forEach(x => { x.style.display = 'none'; x.classList.add('is-hidden') })
        return 'ok-date'
      }
      setFn(target, val)
      return 'ok'
    }
    // Fallback: placeholder match
    for (const inp of c.querySelectorAll('input:not([type="hidden"]), textarea')) {
      if (inp.closest('.el-date-editor, .tsscdatepicker')) continue
      const ph = inp.getAttribute('placeholder') || ''
      if (ph.includes(label) && !inp.disabled && !inp.readOnly && inp.offsetParent !== null) {
        setFn(inp, val)
        return 'ok-placeholder'
      }
    }
    // Fallback: input type match
    for (const inp of c.querySelectorAll('input:not([type="hidden"]), textarea')) {
      if (inp.closest('.el-date-editor, .tsscdatepicker')) continue
      const type = inp.getAttribute('type') || 'text'
      if (type.toLowerCase() === label.toLowerCase() && !inp.disabled && !inp.readOnly && inp.offsetParent !== null) {
        setFn(inp, val)
        return 'ok-type'
      }
    }
    return 'label-not-found'
  },
  selectOption: (label, option) => {
    return new Promise(resolve => {
      const c = CTRL.getContainer()
      const items = c.querySelectorAll('.el-form-item')
      const getSelectedLabel = (formItem) => {
        const selItem = formItem.querySelector('.el-select-dropdown__item.is-selected')
        if (selItem) return selItem.textContent.trim()
        const tag = formItem.querySelector('.el-select__tags-text')
        if (tag) return tag.textContent.trim()
        const trigger = formItem.querySelector('.el-select .el-input__inner')
        if (trigger) {
          const v = (trigger.value || '').trim()
          if (v) return v
        }
        return null
      }
      // Pass 1: exact label match
      for (let pass = 1; pass <= 2; pass++) {
        const exact = pass === 1
        for (const item of items) {
          const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || ''
          if (exact) { if (lbl !== label) continue }
          else { if (lbl === label || !lbl.includes(label)) continue }
          const trigger = item.querySelector('.el-select .el-input__inner')
          if (!trigger) { resolve('no-select-found'); return }
          if (trigger.disabled) { resolve('select-disabled'); return }
          // Check if already selected
          const cur = getSelectedLabel(item)
          if (cur) {
            if (cur === option || option.includes(cur) || cur.includes(option)) {
              resolve('already:' + cur)
              return
            }
          }
          // Open dropdown
          trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
          trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
          trigger.click()
          setTimeout(() => CTRL._pickOption(option, resolve), 600)
          return
        }
      }
      // Fallback: placeholder match
      for (const sel of c.querySelectorAll('.el-select .el-input__inner')) {
        const ph = sel.getAttribute('placeholder') || ''
        if (ph.includes(label) && !sel.disabled && sel.offsetParent !== null) {
          sel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
          sel.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
          sel.click()
          setTimeout(() => CTRL._pickOption(option, resolve), 600)
          return
        }
      }
      resolve('label-not-found')
    })
  },
  _pickOption: (option, resolve) => {
    // Find visible dropdown
    let dropdown = document
    for (const dd of document.querySelectorAll('.el-select-dropdown')) {
      if (dd.offsetParent !== null && !dd.classList.contains('is-hidden')) { dropdown = dd; break }
    }
    let items = dropdown.querySelectorAll('.el-select-dropdown__item')
    if (items.length === 0 || dropdown === document) {
      items = document.querySelectorAll('.el-select-dropdown__item')
    }
    const FIRST_ALIASES = ['first', '1st', '第一个', '第一项']
    const tryClick = (item) => {
      item.scrollIntoView({ block: 'nearest' })
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      item.click()
      resolve('ok:' + item.textContent.trim())
    }
    if (FIRST_ALIASES.includes(option.toLowerCase().trim())) {
      for (const item of items) {
        if (item.offsetParent !== null) { tryClick(item); return }
      }
      if (items.length > 0) { tryClick(items[0]); return }
      resolve('no-items'); return
    }
    for (const item of items) {
      if (item.textContent.trim() === option) { tryClick(item); return }
    }
    for (const item of items) {
      if (item.textContent.trim().includes(option)) { tryClick(item); return }
    }
    const hasEmpty = document.querySelector('.el-select-dropdown__empty')
    if (hasEmpty) { resolve('no-items'); return }
    resolve('option-not-found:' + [...items].map(i => i.textContent.trim()).join(', '))
  },
  sleep: (ms) => new Promise(r => setTimeout(r, ms))
}

function scanFields() {
  const container = CTRL.getContainer()
  const allItems = container.querySelectorAll('.el-form-item')
  const fields = []
  const seen = new Set()
  const selectFields = []

  for (const item of allItems) {
    if (seen.has(item)) continue
    seen.add(item)
    const label = item.querySelector('.el-form-item__label')?.textContent?.trim() || ''
    const input = item.querySelector('input:not([type="hidden"])')
    const textarea = item.querySelector('textarea')
    const trigger = item.querySelector('.el-select .el-input__inner')
    if (!label && !input && !textarea && !trigger) continue

    const kind = CTRL.classifyField(item)
    const inputEl = input || textarea
    let currentValue = inputEl?.value || trigger?.value || ''
    if (!currentValue) {
      const ariaInput = item.querySelector('[aria-valuetext]') || item.querySelector('[aria-valuenow]')
      if (ariaInput) currentValue = ariaInput.getAttribute('aria-valuetext') || ariaInput.getAttribute('aria-valuenow') || ''
    }
    if (!currentValue && trigger) currentValue = trigger.getAttribute('aria-label') || trigger.getAttribute('title') || ''
    const placeholder = (inputEl || trigger)?.getAttribute?.('placeholder') || ''
    const disabled = CTRL.isDisabled(inputEl, trigger)
    const required = CTRL.isRequired(item, label)
    const selected = !!(trigger && item.querySelector('.el-select-dropdown__item.is-selected, .el-select__tags-text'))
    const hasButton = !!item.querySelector('button.el-button--primary, button.el-button--primary.is-plain') ||
      ['选择', '获取地址', '引入', '新增', '添加'].some(t => {
        const btns = item.querySelectorAll('button')
        for (let i = 0; i < btns.length; i++) {
          if (btns[i].textContent.includes(t)) return true
        }
        return false
      })

    const field = { label, kind, currentValue, options: [], placeholder, required, disabled, selected, hasButton }
    fields.push(field)
    if (kind === 'select') {
      selectFields.push({ field, trigger: trigger || item.querySelector('input:not([type="hidden"])') })
    }
  }

  // Phase 2: Read options from Vue component instance (avoids DOM dropdown issues)
  for (const { field, trigger } of selectFields) {
    if (!trigger) continue
    const opts = CTRL.readVueOptions(trigger)
    if (opts.length > 0) {
      field.options = opts
    } else if (field.currentValue) {
      field.options = [field.currentValue]
    }
  }

  return fields
}

function normalizeAction(a) {
  const t = (a.action || '').toLowerCase().replace(/[-\s]/g, '_')
  if (t === 'fill_input' || t === 'fill' || t === 'input' || t === 'fillinput') return { ...a, action: 'fill_input' }
  if (t === 'select_option' || t === 'select' || t === 'option' || t === 'selectoption') return { ...a, action: 'select_option' }
  return a
}

async function executeActions(actions) {
  const results = []
  for (let i = 0; i < actions.length; i++) {
    let action = normalizeAction(actions[i])
    const { action: type, label, value, option } = action
    let result = 'unknown-action'
    try {
      if (type === 'fill_input') {
        result = CTRL.fillFormField(label, value)
      } else if (type === 'select_option') {
        result = await CTRL.selectOption(label, option || value)
      }
    } catch (e) {
      result = `error: ${e.message}`
    }
    const entry = { index: i + 1, action: type, label, value: value || option, result }
    results.push(entry)
    chrome.runtime.sendMessage({ type: 'actionProgress', data: entry })
    await new Promise(r => setTimeout(r, 400))
  }
  return results
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ping') {
    sendResponse({ alive: true })
    return true
  }
  if (message.type === 'scanFields') {
    const fields = scanFields()
    sendResponse({ fields })
    return true
  }
  if (message.type === 'logToConsole') {
    console.log('[AI填表] ' + message.tag + ' ======')
    try { console.log(JSON.parse(message.data)); } catch (e) { console.log(message.data); }
    sendResponse({ ok: true })
    return true
  }
  if (message.type === 'executeActions') {
    executeActions(message.actions).then(results => {
      chrome.runtime.sendMessage({ type: 'actionComplete', data: results })
    })
    sendResponse({ started: true })
    return true
  }
})
