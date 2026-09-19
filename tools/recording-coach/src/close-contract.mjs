/**
 * Five-line operator close contract for recording-coach.
 */

import fs from 'node:fs';
import path from 'node:path';
import { phaseDigest } from './poll-watch.mjs';
import { unwrap } from './http.mjs';

/**
 * @param {string} conclusion
 * @returns {boolean}
 */
function isValidConclusion(conclusion) {
  if (conclusion === 'ERROR') return true;
  if (conclusion.startsWith('CREATED_')) return true;
  if (conclusion.startsWith('REJECTED_')) return true;
  if (conclusion.startsWith('BLOCKED_')) return true;
  return false;
}

/**
 * @param {{ verdict: string, pass?: boolean, reasons?: string[], rejectExcerpt?: string }} assertResult
 * @param {string} [productLabel]
 * @returns {string}
 */
export function conclusionFromAssert(assertResult, productLabel) {
  const label = String(productLabel || '').trim() || 'steps';
  const verdict = String(assertResult?.verdict || '');
  if (verdict === 'DONE' || verdict === 'DONE_WITH_CONCERNS') {
    return `CREATED_${label}`;
  }
  if (verdict === 'REJECTED') {
    const excerpt = String(assertResult.rejectExcerpt || '').replace(/\s+/g, '').slice(0, 24);
    return `REJECTED_${excerpt}`;
  }
  const reason = String(assertResult?.reasons?.[0] || 'unknown').slice(0, 24);
  return `BLOCKED_${reason}`;
}

/**
 * @param {{ conclusion: string, reportPath: string, evidence: string[] }} opts
 * @returns {string}
 */
export function formatOperatorClose({ conclusion, reportPath, evidence }) {
  if (conclusion === 'DONE' || !isValidConclusion(conclusion)) {
    throw new Error('invalid conclusion');
  }
  if (!String(reportPath).endsWith('through-report.md')) {
    throw new Error('reportPath must end with through-report.md');
  }
  if (!Array.isArray(evidence) || evidence.length !== 3) {
    throw new Error('evidence must have 3 lines');
  }
  for (const line of evidence) {
    if (!String(line).trim()) {
      throw new Error('evidence line must be non-empty');
    }
  }
  return [
    `结论：${conclusion}`,
    `报告：${reportPath}`,
    `证据1：${evidence[0]}`,
    `证据2：${evidence[1]}`,
    `证据3：${evidence[2]}`,
  ].join('\n');
}

/**
 * @param {object} trajectory
 * @returns {object}
 */
function trajectoryData(trajectory) {
  if (trajectory?.data && trajectory.data.id != null) return trajectory.data;
  return trajectory;
}

/**
 * @param {{ trajectory: object, evidenceDir: string }} opts
 * @returns {[string, string, string]}
 */
export function pickEvidence({ trajectory, evidenceDir }) {
  const t = trajectoryData(trajectory);
  const steps = Array.isArray(t?.steps) ? t.steps : [];
  const actionTypes = [...new Set(steps.map((s) => s?.actionType).filter(Boolean))];
  const line1 = `traj-final.json id=${t.id} actions=${actionTypes.join(',')}`;

  let line2;
  const radioStep = steps.find((s) => s?.actionType === 'click_table_row_radio');
  if (radioStep) {
    const p = radioStep.paramsJson || radioStep.params || {};
    line2 = `click_table_row_radio row_text=${p.row_text ?? ''}`;
  } else {
    let firstLog = '';
    for (const phase of Array.isArray(t?.phases) ? t.phases : []) {
      const logs = Array.isArray(phase?.doneLogs) ? phase.doneLogs : [];
      if (logs.length) {
        const text = typeof logs[0] === 'string' ? logs[0] : String(logs[0]?.text ?? '');
        firstLog = text.slice(0, 80);
        break;
      }
    }
    line2 = `doneLogs=${firstLog}`;
  }

  let line3;
  const pollFiles = fs
    .readdirSync(evidenceDir)
    .filter((f) => /^poll-(\d+)\.json$/.test(f))
    .map((f) => ({ name: f, n: Number(f.match(/^poll-(\d+)\.json$/)[1]) }))
    .sort((a, b) => b.n - a.n);

  if (pollFiles.length) {
    const { name } = pollFiles[0];
    const raw = JSON.parse(fs.readFileSync(path.join(evidenceDir, name), 'utf8'));
    const digest = phaseDigest(unwrap(raw));
    line3 = `${name} done=${digest.doneCount}/${digest.phaseCount}`;
  } else {
    const detachPath = path.join(evidenceDir, 'detach.json');
    let detached = false;
    if (fs.existsSync(detachPath)) {
      const raw = JSON.parse(fs.readFileSync(detachPath, 'utf8'));
      detached = unwrap(raw)?.detached === true;
    }
    line3 = `detach.json detached=${detached}`;
  }

  return [line1, line2, line3];
}
