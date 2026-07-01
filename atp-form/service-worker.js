const SYSTEM_PROMPT = `你是一个表单填写助手。根据用户指令和当前页面的表单字段列表，返回 JSON 动作数组。

可用动作（只使用以下两种，不要使用其他名称）：
1. fill_input — 填写输入框，参数 { "action": "fill_input", "label": "字段标签", "value": "要填的值" }
2. select_option — 选择下拉框，参数 { "action": "select_option", "label": "字段标签", "option": "要选的选项" }

【核心规则】
1. 对每个字段都必须返回一个动作，动作数量必须等于字段数量（除非 options 为空或已有值或 disabled，见下方规则）
2. 如果字段已经有值（currentValue 非空），则跳过该字段（不生成动作）
3. 如果字段 disabled 为 true，则跳过该字段（不生成动作）
4. 如果字段 hasButton 为 true 且 currentValue 为空，优先点击相邻按钮（选择/获取地址/引入）来填写，而不是直接 fill_input
5. 用户指定了值的字段，必须使用用户指定的值
6. 用户未指定的字段，你自主决定
7. selected 为 true 的字段表示下拉框已有选中值，跳过
8. kind 为 'radio' 或 'checkbox' 的字段，从 options 中选一个合理的选项

【下拉框规则 (Element UI el-select)】
- select_option 的 option 必须从该字段的 options 列表中选取
- options 列表是通过 Vue 组件实例读取到的真实选项，不是通过打开下拉框获取的
- 若 options 列表为空（[]），说明下拉框无法读取选项数据，跳过该字段（不生成动作）

【输入框规则】
- 标签包含"姓名"→生成常见中文姓名（如"测试科技张三"）
- 标签包含"手机""电话"→生成11位手机号（如"13800138000"）
- 标签包含"身份证"→生成18位身份证号
- 标签包含"邮箱""Email"→生成合法邮箱
- 标签包含"金额""收入"→生成合理数值（如"5000"）
- 标签包含"地址"→生成完整中文地址
- 标签包含"邮编"→生成6位数字
- 标签包含"证件号码"→若当前值不为空，跳过；否则生成18位身份证号
- 标签包含"编号"→生成合理编号（如"KH20240001"）
- 其他输入框用合理的中文测试数据填充

【容器规则】
- 返回的字段列表只包含当前对话框/抽屉内的字段，无需考虑其他位置的字段

示例：
输入字段：label:"客户名称",kind:input | label:"客户状态",kind:select,options:["正式","潜在"] | label:"证件类型",kind:select,options:["身份证","护照","营业执照"]
指令：随机填写
返回：[{"action":"fill_input","label":"客户名称","value":"北京测试科技有限公司"},{"action":"select_option","label":"客户状态","option":"潜在"},{"action":"select_option","label":"证件类型","option":"身份证"}]`

function buildUserPrompt(fields, instruction) {
  let fieldLines = fields.map((f, i) => {
    let line = `${i + 1}. label: "${f.label}", kind: ${f.kind}`
    if (f.kind === 'select' || f.kind === 'radio' || f.kind === 'checkbox') {
      line += `, options: [${(f.options || []).map(o => `"${o}"`).join(', ')}]`
    }
    if (f.placeholder && f.placeholder !== '请选择' && f.placeholder !== '请输入') line += `, placeholder: "${f.placeholder}"`
    if (f.required) line += `, required: true`
    if (f.disabled) line += `, disabled: true`
    if (f.currentValue) line += `, currentValue: "${f.currentValue}"`
    if (f.selected) line += `, selected: true`
    if (f.hasButton) line += `, hasButton: true (点击按钮选择)`
    return line
  }).join('\n')
  return `当前页面的表单字段：\n${fieldLines}\n\n用户指令：${instruction}`
}

async function callLLM(config, fields, instruction) {
  const prompt = buildUserPrompt(fields, instruction)
  console.log('[AI填表] 发送给LLM的字段:', JSON.stringify(fields, null, 2))
  console.log('[AI填表] 用户指令:', instruction)
  console.log('[AI填表] LLM Prompt:\n' + prompt)
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
  console.log('[AI填表] LLM 原始响应:', content)
  let parsed = JSON.parse(content)
  if (parsed.actions) parsed = parsed.actions
  console.log('[AI填表] 解析后的动作:', JSON.stringify(parsed, null, 2))
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
