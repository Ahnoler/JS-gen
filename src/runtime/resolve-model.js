/**
 * Resolve LLM model id for agent / session APIs.
 */
import { state } from '../state.js';
import { LLM_MODEL } from '#config/config.js';

export function resolveModelId(model) {
  // Model ids may contain provider prefixes ("Qwen/Qwen3.5-...") — pass through intact
  if (model) return model;
  if (!state.defaultModel) return LLM_MODEL;
  return state.defaultModel.modelID;
}
