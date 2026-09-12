/**
 * 需求到草稿轨迹服务的公共入口。
 *
 * 此聚合模块通过单个服务级导入公开解析、出处、提议缓存、原子实例化、提交校验、
 * 流程卡引导和关键数据规范化。底层模块仍各自负责文件系统、数据库和 LLM 交互；
 * 本文件仅重新导出其公共契约。
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
