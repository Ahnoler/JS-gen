/**
 * Recording runner — business-data context preparation and per-phase step
 * injection. Extracted from trajectory-recording-runner.js — move-only,
 * no logic changes.
 */
import { prepareBusinessDataInjection } from './trajectory-record-lifecycle.js';

/**
 * 录制前一次性装配业务数据上下文：读取业务数据文件/平铺 KV/案例块，
 * 动态加载分类判定 helpers，并预拼接案例块后缀（供填表/引入类阶段注入）。
 * @param {number} tid trajectory DB id
 * @returns {Promise<{
 *   businessDataFile: string|null,
 *   businessData: object|null,
 *   businessDataBlock: string|null,
 *   caseBlockSuffix: string,
 *   CASE_BLOCK_MARK: string,
 *   CASE_BLOCK_MARK_LEGACY: string,
 *   phaseNeedsBusinessData: (instruction: string) => boolean,
 *   stripBusinessDataBlock: (instruction: string) => string,
 * }>} 业务数据注入上下文
 */
export async function prepareRecordingBusinessContext(tid) {
  // 业务数据：填表/引入/查询(搜索)阶段注入（#676）；导航/无凭证登录不挂。
  const { businessDataFile, businessData, businessDataBlock, successGatesBlock } =
    await prepareBusinessDataInjection(tid);
  const {
    phaseNeedsBusinessData,
    stripBusinessDataBlock,
  } = await import('./trajectory-meta-service.js');
  const CASE_BLOCK_MARK = '【业务数据';
  const CASE_BLOCK_MARK_LEGACY = '【业务场景案例数据';
  const caseBlockSuffix = businessDataBlock
    ? `\n\n${CASE_BLOCK_MARK} — 来自用户需求；填表/引入时参考理解，按场景选用关键取值】\n${businessDataBlock}`
    : '';
  return {
    businessDataFile,
    businessData,
    businessDataBlock,
    successGatesBlock,
    caseBlockSuffix,
    CASE_BLOCK_MARK,
    CASE_BLOCK_MARK_LEGACY,
    phaseNeedsBusinessData,
    stripBusinessDataBlock,
  };
}

/**
 * 按阶段是否需要业务数据改写 stepData：追加/剥离案例块后缀，并按需挂
 * business_data_block / business_data / business_data_file 字段。
 * @param {object} stepData agent step payload（就地修改）
 * @param {string} instruction 阶段原始描述
 * @param {object} ctx prepareRecordingBusinessContext 返回的注入上下文
 * @returns {void}
 */
export function applyBusinessDataToStep(stepData, instruction, ctx) {
  const wantBiz = ctx.phaseNeedsBusinessData(instruction);
  // instruction 保持干净目标文本，业务数据由执行机 format_business_data_hint
  // 统一注入一次（跟在任务文本后面），不再内嵌进每条 instruction；
  // 历史 trajectory 的 description 可能已内嵌块，这里统一剥离避免同文重复。
  instruction = ctx.stripBusinessDataBlock(instruction);
  stepData.instruction = instruction;
  // 全局硬性成功门闩：每个阶段都下发（与阶段类型无关），用户未编写时为空不挂
  if (ctx.successGatesBlock) {
    stepData.success_gates_block = ctx.successGatesBlock;
  }
  if (wantBiz && ctx.businessDataBlock) {
    stepData.business_data_block = ctx.businessDataBlock;
  }
  // Optional flat KV only when this phase may use values
  if (wantBiz && ctx.businessData) {
    stepData.business_data = ctx.businessData;
    if (ctx.businessDataFile) stepData.business_data_file = ctx.businessDataFile;
  }
}
