import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { PROJECT_DIR } from '#config/config.js';
import * as execSession from '../executor-session-client.js';
import { writeAgentEvent, sessionRuntimeReady, waitForAgentEvent } from '../routes/browser-session/agent-io.js';
import { buildRerunResumeInstruction } from '../routes/browser-session/heal-instruction.js';

/**
 * 处理 rerun-replay（从失败步骤重跑）的编排逻辑：校验 action_file、
 * 通过 _replay.py 复现失败前场景（seed_action_log + 本地/executor 双分支），
 * 再生成 heal 续跑指令。仅做原样编排，不与产品回放（replay-actions）合并。
 * @param {object} options 重跑参数
 * @param {object} options.session 目标浏览器会话对象（来自 state.sessions）
 * @param {string} options.action_file 动作文件相对路径（相对项目目录）
 * @param {number} options.failedStep 失败步骤号（1-based，> 0）
 * @param {number=} options.maxSteps 重跑的最大步数（缺省 40）
 * @param {string=} options.log_file 可选日志文件路径
 * @param {object=} options.form_changes 可选表单变更信息
 * @returns {Promise<{ok: true, task: string, maxSteps: number}
 *   |{ok: false, status: number, error: string}>}
 *   成功时返回 heal 任务指令与 maxSteps；失败时返回 HTTP 状态码与错误信息。
 */
export async function rerunReplay({
  session, action_file, failedStep, maxSteps, log_file, form_changes,
}) {
  if (!action_file) return { ok: false, status: 400, error: 'action_file is required' };
  if (!failedStep || failedStep <= 0) return { ok: false, status: 400, error: 'failedStep (> 0) is required' };

  const absActionPath = path.resolve(PROJECT_DIR, action_file);
  const actionRel = path.relative(PROJECT_DIR, absActionPath);
  if (actionRel.startsWith('..') || path.isAbsolute(actionRel)) {
    return { ok: false, status: 400, error: 'action_file must be within the project directory' };
  }
  if (!existsSync(absActionPath)) return { ok: false, status: 404, error: 'Action file not found' };

  let replayedCount = 0;
  let resumeInstruction;
  try {
    const actionData = JSON.parse(readFileSync(absActionPath, 'utf-8'));
    const url = actionData.url || '';
    const commands = actionData?.tests?.[0]?.commands || actionData?.actions || [];

    // ── Reproduce failure scene via scripts/controller/actions/_replay.py ──
    // Replay failedStep 之前的操作（必要时先 go_to_url），重建页面状态后再交给 Agent 修复。
    const SKIP_REPLAY = new Set([
      'scroll_down', 'scroll_up', 'get_page_state', 'scan_form_fields', 'scan_visible_fields',
      'check_field_value', 'verify_field_value', 'take_screenshot', 'save_trajectory',
      'save_business_data', 'read_business_data', 'match_form_rule', 'init_task_list',
      'get_pending_tasks', 'sync_tasks_from_errors', 'expand_all_el_tree', 'task_done',
      'task_retry', 'save_form_snapshot',
    ]);
    const preFailure = commands.filter(
      (c, i) => (i + 1) < failedStep && !SKIP_REPLAY.has(c.action),
    );
    const replayActions = preFailure.map((c) => ({ ...c }));
    const hasGoto = replayActions.some((c) => c.action === 'go_to_url');
    if (url && !String(url).includes('unknown') && !hasGoto) {
      replayActions.unshift({ action: 'go_to_url', params: { url } });
    }

    if (replayActions.length > 0) {
      if (!sessionRuntimeReady(session)) {
        console.log('[rerun] Session runtime not ready — skipping _replay reproduce');
      } else {
        try {
          const replayPayload = {
            actions: replayActions,
            seed_action_log: true,
            is_replay: true,
          };
          let replayResult;
          if (session.useExecutor && session.executorNodeUuid) {
            const doneP = execSession.waitForSessionEvent(session.sessionId, 'replay_done', 180000);
            writeAgentEvent(session, 'replay_actions', replayPayload);
            replayResult = await doneP;
          } else {
            const doneP = waitForAgentEvent('replay_done', 180000);
            writeAgentEvent(session, 'replay_actions', replayPayload);
            replayResult = await doneP;
          }
          replayedCount = replayResult.count || 0;
          console.log(
            `[rerun] _replay done: ${replayedCount} actions `
            + `(ok=${replayResult.ok ?? '?'} failed=${replayResult.failed ?? '?'})`,
          );
        } catch (e) {
          console.log(`[rerun] _replay error (continuing with heal): ${e.message}`);
        }
      }
    }

    ({ resumeInstruction } = buildRerunResumeInstruction({
      actionData,
      failedStep,
      log_file,
      form_changes,
      replayedCount,
      PROJECT_DIR,
    }));
  } catch (e) {
    resumeInstruction = 'Continue recording from step ' + failedStep + '. See action file for details.';
  }

  return { ok: true, task: resumeInstruction, maxSteps: maxSteps || 40 };
}
