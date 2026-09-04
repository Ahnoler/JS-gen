/**
 * Recording runner — recording system resolution and special-element candidate
 * injection. Extracted from trajectory-recording-runner.js — move-only,
 * no logic changes.
 */
import * as trajectoryDao from '../../dao/trajectory-dao.js';

/**
 * 解析录制所属系统 ID（functionId 的祖先系统）；任何失败静默降级为 null，
 * 不阻断录制主链路。
 * @param {number} tid trajectory DB id
 * @returns {Promise<number|null>} 系统 ID，无法解析时为 null
 */
export async function resolveRecordingSystemId(tid) {
  let recordingSystemId = null;
  try {
    const trajRow = await trajectoryDao.getById(tid);
    if (trajRow?.functionId) {
      const { resolveAncestorSystemId } = await import('../hierarchy-service.js');
      recordingSystemId = await resolveAncestorSystemId(trajRow.functionId);
    }
  } catch {
    recordingSystemId = null;
  }
  return recordingSystemId;
}

/**
 * 为当前阶段检索特殊控件候选并挂到 stepData.special_element_candidates；
 * 无系统 ID 直接跳过，检索失败仅告警，不阻断录制。
 * @param {object} stepData agent step payload（就地修改）
 * @param {object} ctx 候选检索上下文
 * @param {number|null} ctx.systemId 录制系统 ID（null → 跳过）
 * @param {string} ctx.description 阶段描述
 * @param {number} ctx.phaseNumber 阶段号（仅用于日志）
 * @returns {Promise<void>}
 */
export async function attachSpecialElementCandidates(stepData, { systemId, description, phaseNumber }) {
  if (systemId) {
    try {
      const { searchSpecialElements } = await import('../special-element-search-service.js');
      const candidates = await searchSpecialElements({
        systemId,
        description,
        limit: 3,
        includeSteps: true,
      });
      if (candidates.length) {
        stepData.special_element_candidates = candidates;
        console.log(
          `[record] special-element candidates phase=${phaseNumber} `
          + `n=${candidates.length} ids=${candidates.map((c) => c.id).join(',')}`,
        );
      } else {
        console.log(
          `[record] special-element candidates phase=${phaseNumber} n=0 `
          + `(systemId=${systemId})`,
        );
      }
    } catch (err) {
      console.warn('[record] special-element search skipped:', err?.message || err);
    }
  }
}
