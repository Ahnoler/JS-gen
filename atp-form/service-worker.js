const SYSTEM_PROMPT = `你是一个表单填写助手。根据用户指令和当前页面的表单字段列表，返回 JSON 动作数组。

动作类型：
- fill_input: 填写输入框，参数 {label, value}
- select_option: 选择下拉框，参数 {label, option}

生成值的原则：
- 对于"姓名"字段，使用常见中文姓名
- 对于"手机号""电话"字段，生成 1 开头 11 位手机号
- 对于"身份证"字段，生成 18 位身份证号
- 对于"邮箱""Email"字段，生成合法邮箱
- 对于"金额""收入"字段，生成合理数值
- 对于"地址"字段，生成格式完整的地址
- 对于"邮编"字段，生成 6 位数字
- 其他字段用合理的测试数据填充

用户指定了值的字段，必须使用用户指定的值。
用户没有指定的字段，自动生成合理的值。
只返回 JSON 数组，不要解释，不要多余内容。`

function buildUserPrompt(fields, instruction) {
  let fieldLines = fields.map((f, i) => {
    let line = `${i + 1}. label: "${f.label}", type: ${f.type}`
    if (f.type === 'select') line += `, options: [${f.options.map(o => `"${o}"`).join(', ')}]`
    if (f.placeholder) line += `, placeholder: "${f.placeholder}"`
    if (f.required) line += `, required: true`
    if (f.currentValue) line += `, current: "${f.currentValue}"`
    return line
  }).join('\n')
  return `当前页面的表单字段：\n${fieldLines}\n\n用户指令：${instruction}`
}

async function callLLM(config, fields, instruction) {
  const prompt = buildUserPrompt(fields, instruction)
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      response_format: { type: 'json_object' }
    })
  })
  if (!response.ok) {
    const err = await response.text()
    throw new Error(`LLM API error ${response.status}: ${err}`)
  }
  const data = await response.json()
  const content = data.choices[0].message.content
  let parsed = JSON.parse(content)
  if (parsed.actions) parsed = parsed.actions
  return { actions: parsed, rawPrompt: prompt, rawResponse: content }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'callLLM') {
    const { fields, instruction } = message
    const defaults = { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '', temperature: 0.1, maxTokens: 4096 }
    chrome.storage.sync.get('atpFormConfig', (res) => {
      const config = Object.assign({}, defaults, res.atpFormConfig || {})
      if (!config.apiKey) {
        sendResponse({ error: '请先配置 API Key（点击右上角齿轮图标设置）' })
        return
      }
      callLLM(config, fields, instruction)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ error: err.message }))
    })
    return true
  }
})
