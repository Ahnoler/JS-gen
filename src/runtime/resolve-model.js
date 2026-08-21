/**
 * Resolve LLM model id for agent / session APIs.
 */
import { state } from '../state.js';

export function resolveModelId(model) {
  // Model ids may contain provider prefixes ("Qwen/Qwen3.5-...") — pass through intact
  if (model) return model;
  if (!state.defaultModel) return 'Qwen/Qwen3.5-35B-A3B';
  return state.defaultModel.modelID;
}
