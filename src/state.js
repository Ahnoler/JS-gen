export const state = {
  ocServer: null,
  client: null,
  standalone: false,
  cachedAgents: [],
  cachedSkills: [],
  cachedModels: [],
  defaultModel: null,
  globalBrowser: {
    process: null,
    stdin: null,
    ready: false,
    busy: false,
    model: null,
    stepIndex: 0,
  },
  sessions: new Map(),
  executionRecords: [],
};
