/**
 * P2 heal-decision routing gate.
 *
 * Default (flag off): suggestedAction only appears in instruction/contract and
 * the existing heal flow is unchanged.
 *
 * HEAL_LOCATE_DECISION_ENABLED=1:
 *   skip  -> mark the failed step (confirmed=0) and continue the batch
 *   fail  -> do not run an AI heal; finish the batch with the failure
 *   retry -> re-run the failed replay action a bounded number of times
 *            (contract.runtime.retry_count), then fall back to AI heal
 *   heal / repair / unknown -> existing AI heal flow
 */

const DECISION_FLAG = 'HEAL_LOCATE_DECISION_ENABLED';

export function healDecisionEnabled(env = process.env) {
  return String(env?.[DECISION_FLAG] ?? '').trim() === '1';
}

export function routeSuggestedAction({ suggestedAction = 'heal', enabled = false } = {}) {
  if (!enabled) return 'heal_current';
  switch (String(suggestedAction || 'heal')) {
    case 'skip':
      return 'skip';
    case 'fail':
      return 'fail';
    case 'retry':
      return 'retry';
    case 'repair':
    case 'heal':
    default:
      return 'heal_current';
  }
}

export { DECISION_FLAG };
