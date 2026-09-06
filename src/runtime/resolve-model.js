/**
 * Resolve LLM model id for agent / session APIs.
 */
import { state } from '../state.js';
import { LLM_MODEL } from '#config/config.js';

/**
 * Resolve the LLM model id to use for agent / session APIs.
 * @param {string|object|null} [model] explicit model id or model object; falls back to state.defaultModel then LLM_MODEL
 * @returns {string} resolved model id
 */
export function resolveModelId(model) {
  // Model ids may contain provider prefixes ("Qwen/Qwen3.5-...") — pass through intact
  if (model) return model;
  if (!state.defaultModel) return LLM_MODEL;
  return state.defaultModel.modelID;
}
