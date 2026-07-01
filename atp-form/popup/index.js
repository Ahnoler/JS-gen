// ===== State =====
let currentTabId = null
let isRunning = false
let currentSession = null

// ===== DOM refs =====
const $ = id => document.getElementById(id)
const instructionInput = $('instructionInput')
const executeBtn = $('executeBtn')
const logArea = $('logArea')
const fieldSummary = $('fieldSummary')

// Console
const consoleEmpty = $('consoleEmpty')
const consoleContent = $('consoleContent')
const consolePageInfo = $('consolePageInfo')
const consoleFields = $('consoleFields')
const consolePrompt = $('consolePrompt')
const consoleRawResponse = $('consoleRawResponse')
const consoleActions = $('consoleActions')
const consoleResults = $('consoleResults')

// Settings
const apiKeyInput = $('apiKeyInput')
const baseUrlInput = $('baseUrlInput')
const modelInput = $('modelInput')
const configStatus = $('configStatus')

// ===== Tab Switching =====
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'))
    btn.classList.add('active')
    $(`tab-${btn.dataset.tab}`).classList.add('active')
    if (btn.dataset.tab === 'console') renderConsole()
    if (btn.dataset.tab === 'settings') loadConfig()
  })
})

// ===== Logging =====
function addLog(entry) {
  const placeholder = logArea.querySelector('.log-placeholder')
  if (placeholder) placeholder.remove()
  const div = document.createElement('div')
  div.className = 'log-entry'
  if (entry.type === 'info') {
    div.innerHTML = '<span class="status-icon running">●</span><span class="msg">' + escHtml(entry.text) + '</span>'
  } else if (entry.type === 'success') {
    div.innerHTML = '<span class="status-icon ok">✓</span><span class="msg">' + escHtml(entry.text) + '</span>'
  } else if (entry.type === 'error') {
    div.innerHTML = '<span class="status-icon error">✗</span><span class="msg">' + escHtml(entry.text) + '</span>'
  } else if (entry.type === 'progress') {
    const resultClass = entry.data.result === 'ok' || (entry.data.result && entry.data.result.startsWith('ok')) ? 'ok' : 'error'
    const icon = resultClass === 'ok' ? '✓' : '✗'
    div.innerHTML = '<span class="status-icon ' + resultClass + '">' + icon + '</span><span class="index-badge">' + entry.data.index + '/' + entry.total + '</span><span class="msg">' + escHtml(entry.data.action) + ' "' + escHtml(entry.data.label) + '": ' + escHtml(entry.data.result) + '</span>'
  }
  logArea.appendChild(div)
  logArea.scrollTop = logArea.scrollHeight
}

function clearLogs() {
  logArea.innerHTML = '<div class="log-placeholder">等待操作...</div>'
}

function escHtml(s) {
  if (!s) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ===== Current Session Management =====
function initSession(instruction) {
  currentSession = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    url: '',
    instruction,
    fields: null,
    llmRequest: '',
    llmResponse: '',
    actions: [],
    executionResults: [],
    status: 'running'
  }
}

function clearSession() {
  currentSession = null
}

// ===== Content Script Communication =====
async function getCurrentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  return tabs[0]
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ping' })
    return true
  } catch (e) {
    addLog({ type: 'info', text: '正在注入 content script...' })
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-script.js']
      })
      await new Promise(r => setTimeout(r, 300))
      return true
    } catch (e2) {
      addLog({ type: 'error', text: '注入失败: ' + e2.message })
      return false
    }
  }
}

async function sendToContent(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message)
  } catch (e) {
    if (e.message.includes('Receiving end does not exist')) {
      const injected = await ensureContentScript(tabId)
      if (injected) {
        return await chrome.tabs.sendMessage(tabId, message)
      }
    } else {
      addLog({ type: 'error', text: '通信错误: ' + e.message })
    }
    return null
  }
}

// ===== Execute (Main Action) =====
async function execute() {
  if (isRunning) return
  const instruction = instructionInput.value.trim()
  if (!instruction) {
    addLog({ type: 'error', text: '请输入指令' })
    return
  }

  const tab = await getCurrentTab()
  if (!tab || !tab.id) {
    addLog({ type: 'error', text: '无法获取当前标签页' })
    return
  }
  currentTabId = tab.id

  initSession(instruction)
  isRunning = true
  executeBtn.disabled = true
  executeBtn.textContent = '执行中...'
  clearLogs()

  addLog({ type: 'info', text: '正在扫描表单字段...' })

  const scanResult = await sendToContent(currentTabId, { type: 'scanFields' })
  if (!scanResult) {
    isRunning = false; executeBtn.disabled = false; executeBtn.textContent = '执行'; clearSession(); return
  }
  if (!scanResult.fields || scanResult.fields.length === 0) {
    addLog({ type: 'error', text: '未检测到 Element UI 表单字段' })
    isRunning = false; executeBtn.disabled = false; executeBtn.textContent = '执行'; clearSession(); return
  }

  currentSession.fields = scanResult.fields
  currentSession.url = tab.url || ''

  const fields = scanResult.fields
  const kindCount = {}
  for (const f of fields) { kindCount[f.kind] = (kindCount[f.kind] || 0) + 1 }
  const summary = Object.entries(kindCount).map(([k, n]) => {
    const names = { input: '输入框', select: '下拉框', date: '日期', radio: '单选', checkbox: '多选', unknown: '未知' }
    return (names[k] || k) + ' ' + n + ' 个'
  }).join('，')
  fieldSummary.style.display = 'block'
  fieldSummary.textContent = '检测到 ' + fields.length + ' 个字段（' + summary + '）'
  addLog({ type: 'info', text: '检测到 ' + fields.length + ' 个字段，正在调用 LLM 规划动作...' })

  console.log('[AI填表] ====== 发送给 LLM 的字段列表 ======')
  console.log(JSON.stringify(fields, null, 2))
  console.log('[AI填表] 用户指令:', instruction)

  // Forward scan result to main page console (content script)
  sendToContent(currentTabId, { type: 'logToConsole', tag: '扫描的字段', data: JSON.stringify(fields, null, 2) })

  const llmResult = await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'callLLM', fields, instruction }, resolve)
  })
  if (!llmResult) {
    addLog({ type: 'error', text: 'LLM 调用无响应' })
    isRunning = false; executeBtn.disabled = false; executeBtn.textContent = '执行'; clearSession(); return
  }
  if (llmResult.error) {
    addLog({ type: 'error', text: 'LLM 错误: ' + llmResult.error })
    isRunning = false; executeBtn.disabled = false; executeBtn.textContent = '执行'; clearSession(); return
  }

  currentSession.llmRequest = llmResult.rawPrompt || ''
  currentSession.llmResponse = llmResult.rawResponse || ''
  const actions = llmResult.actions
  currentSession.actions = actions || []
  console.log('[AI填表] ====== LLM 返回的动作 ======')
  console.log(JSON.stringify(actions, null, 2))

  // Forward LLM result to main page console
  sendToContent(currentTabId, { type: 'logToConsole', tag: 'LLM 返回的动作', data: JSON.stringify(actions, null, 2) })

  if (!actions || actions.length === 0) {
    addLog({ type: 'error', text: 'LLM 未返回任何动作' })
    isRunning = false; executeBtn.disabled = false; executeBtn.textContent = '执行'; clearSession(); return
  }

  addLog({ type: 'info', text: 'LLM 规划了 ' + actions.length + ' 个动作，开始执行...' })

  const pl = function(msg) {
    if (!currentSession) return
    if (msg.type === 'actionProgress') {
      currentSession.executionResults.push(msg.data)
      addLog({ type: 'progress', data: msg.data, total: actions.length })
      console.log('[AI填表] 执行进度:', msg.data.index + '/' + actions.length, msg.data.action, msg.data.label, '→', msg.data.result)
      sendToContent(currentTabId, { type: 'logToConsole', tag: '执行进度', data: msg.data.index + '/' + actions.length + ' ' + msg.data.action + ' "' + msg.data.label + '" → ' + msg.data.result })
    }
    if (msg.type === 'actionComplete') {
      chrome.runtime.onMessage.removeListener(pl)
      currentSession.executionResults = msg.data
      addLog({ type: 'success', text: '完成！共执行 ' + msg.data.length + ' 个动作' })
      console.log('[AI填表] ====== 执行完成 ======')
      console.log(JSON.stringify(msg.data, null, 2))
      sendToContent(currentTabId, { type: 'logToConsole', tag: '执行完成', data: JSON.stringify(msg.data, null, 2) })
      isRunning = false
      executeBtn.disabled = false
      executeBtn.textContent = '执行'
    }
  }
  chrome.runtime.onMessage.addListener(pl)

  sendToContent(currentTabId, { type: 'executeActions', actions })
}

executeBtn.addEventListener('click', execute)
instructionInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) execute()
})

// ===== Console Tab =====
function renderConsole() {
  if (!currentSession) {
    consoleEmpty.style.display = 'flex'
    consoleContent.style.display = 'none'
    return
  }
  consoleEmpty.style.display = 'none'
  consoleContent.style.display = 'block'

  consolePageInfo.innerHTML = ''
  const info = [
    { k: '时间', v: currentSession.timestamp },
    { k: '指令', v: currentSession.instruction },
    { k: 'URL', v: currentSession.url },
    { k: '状态', v: currentSession.status }
  ]
  info.forEach(i => {
    const d = document.createElement('div')
    d.className = 'kv-row'
    d.innerHTML = '<span class="k">' + escHtml(i.k) + '</span><span class="v">' + escHtml(i.v) + '</span>'
    consolePageInfo.appendChild(d)
  })

  consoleFields.textContent = JSON.stringify(currentSession.fields, null, 2)
  consolePrompt.textContent = currentSession.llmRequest || '(无)'
  consoleRawResponse.textContent = currentSession.llmResponse || '(无)'
  consoleActions.textContent = JSON.stringify(currentSession.actions, null, 2)
  consoleResults.textContent = currentSession.executionResults.length > 0
    ? JSON.stringify(currentSession.executionResults, null, 2)
    : '(尚未执行)'
}

$('clearConsoleBtn').addEventListener('click', () => {
  clearSession()
  renderConsole()
})

// ===== Settings Tab =====
function loadConfig() {
  chrome.storage.sync.get('atpFormConfig', (res) => {
    const c = res.atpFormConfig || {}
    apiKeyInput.value = c.apiKey || ''
    baseUrlInput.value = c.baseUrl || 'https://api.deepseek.com/v1'
    modelInput.value = c.model || 'deepseek-chat'
  })
}

$('saveConfigBtn').addEventListener('click', () => {
  const config = {
    apiKey: apiKeyInput.value.trim(),
    baseUrl: baseUrlInput.value.trim(),
    model: modelInput.value.trim()
  }
  if (!config.apiKey) {
    configStatus.textContent = '请输入 API Key'
    configStatus.className = 'config-status err'
    return
  }
  chrome.storage.sync.set({ atpFormConfig: config }, () => {
    configStatus.textContent = '配置已保存'
    configStatus.className = 'config-status ok'
    setTimeout(() => { configStatus.textContent = '' }, 2000)
  })
})

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  loadConfig()
})
