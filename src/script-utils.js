import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from 'fs';
import path from 'path';
import { GENERATED_DIR } from '../config/config.js';

export function ensureGeneratedDir() {
  if (!existsSync(GENERATED_DIR)) mkdirSync(GENERATED_DIR, { recursive: true });
}

export function loadGeneratedIndex() {
  ensureGeneratedDir();
  const fp = path.join(GENERATED_DIR, 'index.json');
  if (!existsSync(fp)) return [];
  try { return JSON.parse(readFileSync(fp, 'utf-8')); } catch { return []; }
}

export function saveGeneratedIndex(list) {
  ensureGeneratedDir();
  writeFileSync(path.join(GENERATED_DIR, 'index.json'), JSON.stringify(list, null, 2), 'utf-8');
}

export function cleanupScriptFile(scriptPath) {
  try { if (existsSync(scriptPath)) unlinkSync(scriptPath); } catch {}
}

export function extractFlowFromTrajectory(trajectory) {
  const history = trajectory?.history || [];
  const flow = [];

  for (let i = 0; i < history.length; i++) {
    const step = history[i];
    const modelOutput = step.model_output;
    const state = step.state;
    const results = step.result || [];

    if (!modelOutput) continue;

    const isDone = results.some(r => r.is_done === true);
    if (isDone) {
      flow.push({
        stepNumber: i + 1,
        type: 'done',
        phaseNumber: state?._phase_number || 0,
        description: results.find(r => r.extracted_content)?.extracted_content || 'Task completed',
        url: state?.url || '',
        success: results.some(r => r.success === true),
      });
      continue;
    }

    const actions = modelOutput.action || [];
    const currentState = modelOutput.current_state || {};

    for (let j = 0; j < actions.length; j++) {
      const actionObj = actions[j];
      if (!actionObj || typeof actionObj !== 'object') continue;

      const actionKey = Object.keys(actionObj)[0];
      const actionParams = actionObj[actionKey] || {};

      const interactedEl = (state?.interacted_element && state.interacted_element[j]) || null;

      const elInfo = {};

      if (interactedEl) {
        elInfo.tag = interactedEl.tag_name || '';
        elInfo.xpath = interactedEl.xpath || '';
        elInfo.highlightIndex = interactedEl.highlight_index;

        const attrs = interactedEl.attributes || {};
        if (attrs) {
          elInfo.id = attrs.id || '';
          elInfo.class = attrs.class || '';
          elInfo.title = attrs.title || '';
          elInfo.placeholder = attrs.placeholder || '';
          elInfo.type = attrs.type || '';
          elInfo.name = attrs.name || '';
          elInfo.value = attrs.value || '';
          elInfo['aria-label'] = attrs['aria-label'] || '';
          elInfo['data-testid'] = attrs['data-testid'] || attrs['data-test-id'] || '';
          elInfo.text = attrs.text || attrs.value || attrs['aria-label'] || attrs.title || attrs.placeholder || '';
          elInfo.allAttrs = Object.entries(attrs)
            .filter(([, v]) => v != null && v !== '')
            .map(([k, v]) => `${k}="${v}"`)
            .join('; ');
        }

        const branch = interactedEl.entire_parent_branch_path;
        if (Array.isArray(branch) && branch.length > 0) {
          elInfo.parentPath = branch.join(' > ');
        }
      }

      // Fallback: extract XPath from action result's | loc:... marker
      if (!elInfo.xpath) {
        const resultContent = (results[j]?.extracted_content || '');
        const locMatch = resultContent.match(/\| loc:([^\s|]+)/);
        if (locMatch) elInfo.xpath = locMatch[1];
      }

      flow.push({
        stepNumber: i + 1,
        actionIndex: j,
        type: actionKey,
        phaseNumber: state?._phase_number || 0,
        url: state?.url || '',
        params: {
          text: actionParams.text || actionParams.label_text || actionParams.label || '',
          value: actionParams.value || '',
          index: actionParams.index,
          url: actionParams.url || '',
          raw: actionParams,
        },
        element: elInfo,
        success: results[j]?.success,
        error: results[j]?.error || null,
        extractedContent: results[j]?.extracted_content || '',
      });
    }
  }

  return flow;
}
