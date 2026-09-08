/**
 * Req→draft-traj service: parse chains, provenance, propose atomic candidates.
 */
export { parseThroughChainsMarkdown, buildAtomKey, hasProposeableChainSteps } from './parse-through-chains.js';
export {
  loadSourceDoc,
  resolveChapterRef,
  assertAtomProvenance,
  extractZjjkCodes,
  fillTaskDraftProvenancePlaceholders,
} from './provenance.js';
export { readProposeCache, writeProposeCache, PROPOSE_CACHE_FILENAME } from './propose-cache.js';
export { proposeDraftTrajectories } from './propose.js';
export { commitDraftTrajectories } from './commit.js';
export {
  FLOW_TEMPLATE_MARKER,
  matchFlowForAtom,
  buildFlowTemplateHint,
  applyFlowTemplateHintToDescription,
} from './flow-card-recall.js';
