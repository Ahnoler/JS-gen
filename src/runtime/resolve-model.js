/**
 * Resolve LLM model id for agent / session APIs.
 */
import { state } from '../state.js';

export function resolveModelId(model) {
  if (model) {
    // Strip providerID prefix if present (e.g. "deepseek/deepseek-v4-flash" -> "deepseek-v4-flash")
    const parts = model.split('/');
    return parts.length >= 2 ? parts.slice(1).join('/') : model;
  }
  if (!state.defaultModel) return 'deepseek-v4-flash';
  return state.defaultModel.modelID;
}
