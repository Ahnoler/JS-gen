import { createGlobalBrowserState } from './runtime/global-browser.js';

export const state = {
  defaultModel: null,
  /** @type {ReturnType<typeof createGlobalBrowserState>} */
  globalBrowser: createGlobalBrowserState(),
  sessions: new Map(),
};
