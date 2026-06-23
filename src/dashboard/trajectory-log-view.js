// Log file viewer for Trajectory History page
// Parses recorder.py log format and renders structured HTML
import { escapeHtml } from './swagger-api.js';

/**
 * Parse a log file line in the format:
 *   [N] goal: <text> | actions: <action=value ...> | result: [ActionResult(...)]
 *
 * @param {string} line - a single log entry line
 * @returns {{ step: number, goal: string, actions: Array<{name:string, value:string}>, result: object }|null}
 */
function parseStepLine(line) {
  const match = line.match(/^\[(\d+)\]\s+goal:\s+(.+?)\s+\|\s+actions:\s+(.+?)\s+\|\s+result:\s+(.+)$/);
  if (!match) return null;

  const step = parseInt(match[1]);
  const goal = match[2].trim();
  const actionsRaw = match[3].trim();
  const resultRaw = match[4].trim();

  // Parse actions: space-separated pairs like "action=value" or "action=None"
  const actions = [];
  const actionPairs = actionsRaw.split(/\s+/);
  for (const pair of actionPairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const name = pair.slice(0, eqIdx);
    const value = pair.slice(eqIdx + 1);
    // Skip None values — they represent unused action slots
    if (value === 'None') continue;
    actions.push({ name, value: value.length > 60 ? value.slice(0, 60) + '…' : value });
  }

  // Parse result: extract key fields from ActionResult string
  let extracted = '';
  let success = '';
  let error = '';
  const ecMatch = resultRaw.match(/extracted_content='([^']*)'/);
  if (ecMatch) extracted = ecMatch[1];
  const sMatch = resultRaw.match(/success=(\w+)/);
  if (sMatch && sMatch[1] !== 'None') success = sMatch[1];
  const eMatch = resultRaw.match(/error='([^']*)'/);
  if (eMatch && eMatch[1] !== 'None') error = eMatch[1];

  return { step, goal, actions, result: { extracted, success, error } };
}

/**
 * Render a structured log file view into summaryEl.
 *
 * @param {HTMLElement} summaryEl - the #trajDetailSummary container
 * @param {HTMLElement} jsonEl - the #trajDetailJson element (hidden for log view)
 * @param {string} content - raw log file content
 */
export function renderLogView(summaryEl, jsonEl, content) {
  const lines = content.replace(/\r/g, '').split('\n').filter(l => l.trim());

  // Extract header info
  let url = '';
  let totalSteps = 0;
  const stepLines = [];

  for (const line of lines) {
    if (line.startsWith('URL: ')) {
      url = line.slice(5).trim();
    } else if (line.startsWith('Total steps: ')) {
      totalSteps = parseInt(line.slice(13).trim()) || 0;
    } else if (/^={10,}$/.test(line.trim())) {
      // Separator line, skip
      continue;
    } else if (/^\[\d+\]/.test(line)) {
      const parsed = parseStepLine(line);
      if (parsed) stepLines.push(parsed);
    }
  }

  // Build step cards HTML
  const stepsHtml = stepLines.map(s => {
    const actionTags = s.actions.length
      ? s.actions.map(a => `<span style="display:inline-block;background:var(--indigo-50);color:var(--indigo-600);padding:1px 6px;border-radius:3px;font-size:11px;font-family:var(--font-mono);margin:2px">${escapeHtml(a.name)}</span>`).join('')
      : '<span style="color:var(--slate-400);font-size:11px">(no actions)</span>';

    const resultParts = [];
    if (s.result.success) resultParts.push(`<span style="color:var(--emerald-600)">success=${s.result.success}</span>`);
    if (s.result.error) resultParts.push(`<span style="color:var(--red-500)">error=${escapeHtml(s.result.error)}</span>`);
    if (s.result.extracted) resultParts.push(`<span style="color:var(--slate-600);font-size:11px">${escapeHtml(s.result.extracted)}</span>`);
    const resultHtml = resultParts.length ? resultParts.join(' ') : '<span style="color:var(--slate-400);font-size:11px">—</span>';

    return `<div style="border:1px solid var(--slate-200);border-radius:8px;margin-bottom:8px;overflow:hidden;background:#fff">
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--slate-50);border-bottom:1px solid var(--slate-200);font-size:12px">
        <span style="background:var(--indigo-100);color:var(--indigo-700);padding:1px 8px;border-radius:4px;font-weight:600;font-size:11px">#${s.step}</span>
        <span style="flex:1;font-weight:500;color:var(--slate-700)">${escapeHtml(s.goal)}</span>
      </div>
      <div style="padding:8px 12px;font-size:13px">
        <div style="margin-bottom:4px">
          <span style="color:var(--slate-400);font-size:11px">Actions</span>
          <div style="margin-top:2px">${actionTags}</div>
        </div>
        <div>
          <span style="color:var(--slate-400);font-size:11px">Result</span>
          <div style="margin-top:2px;font-size:12px">${resultHtml}</div>
        </div>
      </div>
    </div>`;
  }).join('');

  // Hide raw JSON area
  jsonEl.style.display = 'none';

  summaryEl.innerHTML = `
    <div style="margin-bottom:12px;padding:10px 12px;background:var(--slate-50);border-radius:8px;font-size:13px">
      <div style="margin-bottom:4px"><span style="color:var(--slate-400);font-size:11px">URL</span></div>
      <div style="word-break:break-all;font-family:var(--font-mono);font-size:12px;color:var(--indigo-600)">${escapeHtml(url || '(none)')}</div>
      <div style="margin-top:6px;font-size:11px;color:var(--slate-400)">${totalSteps} steps recorded · ${stepLines.length} entries</div>
    </div>
    ${stepLines.length ? stepsHtml : '<div style="padding:24px;text-align:center;color:var(--slate-400);font-size:13px">No step entries found in log file.</div>'}`;
}
