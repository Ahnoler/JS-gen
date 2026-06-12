const CTRL = {
  getContainer: () => {
    for (const d of document.querySelectorAll('.el-dialog'))
      if (d.offsetParent !== null) return d
    for (const d of document.querySelectorAll('.el-drawer'))
      if (d.offsetParent !== null) return d
    return document
  },
  fillFormField: (label, val) => {
    const c = CTRL.getContainer()
    for (const item of c.querySelectorAll('.el-form-item')) {
      const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || ''
      if (!lbl.includes(label)) continue
      const input = item.querySelector('input:not([type="hidden"])')
      const textarea = item.querySelector('textarea')
      const t = input || textarea
      if (!t) return 'no-input-found'
      if (t.disabled || t.readOnly) return 'field-disabled'
      const proto = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement
      const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set
      setter.call(t, val)
      t.setAttribute('value', val)
      t.dispatchEvent(new Event('input', { bubbles: true }))
      t.dispatchEvent(new Event('change', { bubbles: true }))
      t.dispatchEvent(new Event('blur', { bubbles: true }))
      return 'ok'
    }
    for (const inp of c.querySelectorAll('input:not([type="hidden"]),textarea')) {
      const ph = inp.getAttribute('placeholder') || ''
      if (ph.includes(label) && !inp.disabled && !inp.readOnly && inp.offsetParent !== null) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setter.call(inp, val)
        inp.setAttribute('value', val)
        inp.dispatchEvent(new Event('input', { bubbles: true }))
        inp.dispatchEvent(new Event('change', { bubbles: true }))
        inp.dispatchEvent(new Event('blur', { bubbles: true }))
        return 'ok-placeholder'
      }
    }
    return 'label-not-found'
  },
  selectOption: (label, option) => {
    return new Promise(resolve => {
      const c = CTRL.getContainer()
      for (const item of c.querySelectorAll('.el-form-item')) {
        const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || ''
        if (!lbl.includes(label)) continue
        const trigger = item.querySelector('.el-select .el-input__inner')
        if (!trigger) { resolve('no-select-found'); return }
        if (trigger.disabled) { resolve('select-disabled'); return }
        trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        trigger.click()
        setTimeout(() => {
          const opts = document.querySelectorAll('.el-select-dropdown__item')
          const first = ['first', '1st', '第一个', '第一项']
          const t = first.includes(option.toLowerCase().trim())
            ? [...opts].find(it => it.offsetParent !== null) || opts[0]
            : [...opts].find(it => it.textContent.trim() === option)
              || [...opts].find(it => it.textContent.trim().includes(option))
          if (!t) { resolve('option-not-found'); return }
          t.scrollIntoView({ block: 'nearest' })
          t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
          t.click()
          resolve('ok')
        }, 600)
        return
      }
      for (const sel of c.querySelectorAll('.el-select .el-input__inner')) {
        const ph = sel.getAttribute('placeholder') || ''
        if (ph.includes(label) && !sel.disabled && sel.offsetParent !== null) {
          sel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
          sel.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
          sel.click()
          setTimeout(() => {
            const opts = document.querySelectorAll('.el-select-dropdown__item')
            const t = [...opts].find(it => it.textContent.trim() === option)
              || [...opts].find(it => it.textContent.trim().includes(option))
            if (!t) { resolve('option-not-found-fallback'); return }
            t.scrollIntoView({ block: 'nearest' })
            t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
            t.click()
            resolve('ok-placeholder')
          }, 600)
          return
        }
      }
      resolve('label-not-found')
    })
  }
}

function scanFields() {
  const fields = []
  const containers = [document, ...document.querySelectorAll('.el-dialog'), ...document.querySelectorAll('.el-drawer')]
  const seen = new Set()
  for (const container of containers) {
    if (!container.offsetParent && container !== document) continue
    for (const item of container.querySelectorAll('.el-form-item')) {
      if (seen.has(item)) continue
      seen.add(item)
      const label = item.querySelector('.el-form-item__label')?.textContent?.trim() || ''
      const input = item.querySelector('input:not([type="hidden"])')
      const textarea = item.querySelector('textarea')
      const trigger = item.querySelector('.el-select .el-input__inner')
      if (!label && !input && !textarea && !trigger) continue
      let type = 'unknown'
      if (trigger) type = 'select'
      else if (input || textarea) type = 'input'
      const inputEl = input || textarea
      const currentValue = inputEl?.value || trigger?.value || ''
      let options = []
      if (type === 'select') {
        const allOpts = document.querySelectorAll('.el-select-dropdown__item')
        const seenOpts = new Set()
        for (const o of allOpts) {
          const t = o.textContent.trim()
          if (t && !seenOpts.has(t)) { seenOpts.add(t); options.push(t) }
          if (options.length >= 200) break
        }
      }
      const placeholder = (inputEl || trigger)?.getAttribute?.('placeholder') || ''
      const required = !!item.querySelector('.el-form-item.is-required, .el-form-item__label .el-form-item__label--required')
      fields.push({ label, type, currentValue, options, placeholder, required, inDialog: container !== document })
    }
  }
  return fields
}

async function executeActions(actions) {
  const results = []
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]
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
  if (message.type === 'executeActions') {
    executeActions(message.actions).then(results => {
      chrome.runtime.sendMessage({ type: 'actionComplete', data: results })
    })
    sendResponse({ started: true })
    return true
  }
})
