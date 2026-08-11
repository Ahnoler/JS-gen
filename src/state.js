import { createGlobalBrowserState } from './runtime/global-browser.js';
import { LLM_API_KEY } from '../config/config.js';

export const state = {
  defaultModel: null,
  /** @type {ReturnType<typeof createGlobalBrowserState>} */
  globalBrowser: createGlobalBrowserState(),
  sessions: new Map(),
};

// ── First-launch setup state (mutable; updated when /api/setup/save writes .env) ──
export const setupConfig = {
  apiKey: LLM_API_KEY || '',
};

export function isConfigured() {
  return Boolean(setupConfig.apiKey && setupConfig.apiKey.trim());
}
