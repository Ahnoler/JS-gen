/**
 * Rule-based trajectory step assertion (recording-coach).
 * Spec: docs/superpowers/specs/2026-09-18-recording-coach-opencode-design.md §7
 */

/**
 * @param {object} trajectory - GET /trajectories/:id data (or full envelope unwrapped)
 * @param {object} criteria
 * @returns {{ pass: boolean, reasons: string[], verdict: 'DONE'|'DONE_WITH_CONCERNS'|'BLOCKED'|'REJECTED', rejectExcerpt?: string }}
 */
export function assertSteps(trajectory, criteria = {}) {
  const t = trajectory?.data && trajectory.data.id != null ? trajectory.data : trajectory;
  const reasons = [];
  const steps = Array.isArray(t?.steps) ? t.steps : [];
  const recordStatus = String(t?.recordStatus || '');
  const stepCount =
    typeof t?.stepCount === 'number' ? t.stepCount : steps.filter(isBizStep).length;

  const rejectZero =
    criteria.rejectZeroStepRecorded !== false &&
    (recordStatus === 'recorded' || recordStatus === 'completed');
  if (rejectZero && stepCount === 0 && steps.filter(isBizStep).length === 0) {
    reasons.push('rejectZeroStepRecorded: recordStatus is terminal but no business steps');
  }

  const minStep = criteria.minStepCount;
  if (typeof minStep === 'number' && stepCount < minStep) {
    reasons.push(`minStepCount: have ${stepCount}, need >= ${minStep}`);
  }

  const requireTypes = criteria.requireActionTypes;
  if (Array.isArray(requireTypes)) {
    for (const at of requireTypes) {
      const hit = steps.some((s) => s?.actionType === at);
      if (!hit) reasons.push(`requireActionTypes: missing ${at}`);
    }
  }

  const paramEquals = criteria.paramEquals;
  if (paramEquals && typeof paramEquals === 'object') {
    for (const [key, want] of Object.entries(paramEquals)) {
      const [actionType, field] = key.split('.');
      const matches = steps.filter((s) => s?.actionType === actionType);
      if (!matches.length) {
        reasons.push(`paramEquals: no steps for ${actionType}`);
        continue;
      }
      const ok = matches.some((s) => {
        const p = s.paramsJson || s.params || {};
        return String(p[field]) === String(want);
      });
      if (!ok) {
        reasons.push(`paramEquals: ${key} != ${JSON.stringify(want)}`);
      }
    }
  }

  const xpathInc = criteria.xpathSmartIncludes;
  if (xpathInc && typeof xpathInc === 'object') {
    for (const [actionType, needles] of Object.entries(xpathInc)) {
      const list = Array.isArray(needles) ? needles : [needles];
      const matches = steps.filter((s) => s?.actionType === actionType);
      if (!matches.length) {
        reasons.push(`xpathSmartIncludes: no steps for ${actionType}`);
        continue;
      }
      const ok = matches.some((s) => {
        const el = s.elementJson || s.element || {};
        const xp = String(el.xpath_smart || el.xpathSmart || '');
        return list.every((n) => xp.includes(String(n)));
      });
      if (!ok) {
        reasons.push(`xpathSmartIncludes: ${actionType} missing ${JSON.stringify(list)}`);
      }
    }
  }

  const pass = reasons.length === 0;

  if (!pass && criteria.honestReject?.enabled === true) {
    const rejectPhrases = ['在途授信', '评级未生效', '已发起评级流程', '请等待流程完成'];
    const phases = Array.isArray(t?.phases) ? t.phases : [];
    let hit = null;
    for (const phase of phases) {
      const logs = Array.isArray(phase?.doneLogs) ? phase.doneLogs : [];
      for (const log of logs) {
        const text = String(log?.text || '');
        if (rejectPhrases.some((phrase) => text.includes(phrase))) {
          hit = text;
          break;
        }
      }
      if (hit) break;
    }
    if (hit) {
      return {
        pass: false,
        reasons,
        verdict: 'REJECTED',
        rejectExcerpt: hit.slice(0, 40),
      };
    }
  }

  let verdict = 'DONE';
  if (!pass) {
    verdict =
      rejectZero && reasons.some((r) => r.startsWith('rejectZeroStepRecorded'))
        ? 'BLOCKED'
        : 'BLOCKED';
  } else if (recordStatus === 'failed') {
    verdict = 'DONE_WITH_CONCERNS';
    // still pass rules but status failed — treat as concerns if somehow steps ok
  }

  return { pass, reasons, verdict: pass ? 'DONE' : verdict };
}

function isBizStep(s) {
  const at = s?.actionType || '';
  if (!at) return false;
  if (at === 'save_form_snapshot' || at.startsWith('meta_')) return false;
  return true;
}
