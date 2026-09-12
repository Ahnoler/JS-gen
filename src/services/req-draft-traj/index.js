/**
 * Public entry point for the requirement-to-draft-trajectory service.
 *
 * This barrel exposes parsing, provenance, proposal caching, atom materialization,
 * commit validation, flow-card guidance, and key-data normalization through one
 * service-level import. The underlying modules retain responsibility for their
 * filesystem, database, and LLM interactions; this file only re-exports their
 * public contract.
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
export { commitDraftTrajectories, validateCommitAtoms } from './commit.js';
export {
  FLOW_TEMPLATE_MARKER,
  matchFlowForAtom,
  buildFlowTemplateHint,
  applyFlowTemplateHintToDescription,
  getFlowTemplateHintForTrajectory,
} from './flow-card-recall.js';
export {
  collectPageCodes,
  sanitizeTaskDraftKeyData,
  isLegacyZjjkOnlyKeyData,
} from './atom-keydata.js';
