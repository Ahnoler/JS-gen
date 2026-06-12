const ATP_FORM_CONFIG = {
  llm: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    apiKey: '',
    temperature: 0.1,
    maxTokens: 4096
  },
  scan: {
    excludeLabels: [''],
    maxOptions: 200
  },
  execute: {
    selectDelay: 600,
    interActionDelay: 400
  }
}
