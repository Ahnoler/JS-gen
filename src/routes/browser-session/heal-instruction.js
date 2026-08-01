import { existsSync, readFileSync } from 'fs';
import path from 'path';

/**
 * Heal prompt for live steps/replay when a step fails.
 * Emphasizes diagnosing page/structure changes (new required fields, validation
 * errors after save) — not blindly retrying the same action.
 * Scope is exactly ONE recorded step; do not advance into the next trajectory step.
 *
 * @param {{ action?: string, params?: object, id?: string|number }} failedEntry
 * @param {string} [errorResult]
 * @param {{ nextEntry?: { action?: string, params?: object }|null }} [opts]
 * @returns {string}
 */
export function buildStepHealInstruction(failedEntry, errorResult = '', opts = {}) {
  const action = failedEntry?.action || 'unknown';
  const params = failedEntry?.params || {};
  const intent = describeActionIntent(action, params);
  const err = errorResult ? String(errorResult) : '(unknown)';
  const looksLikeValidation = /validation|form.?error|必填|err-save|el-form-item__error|not-found|missing/i.test(err);
  const nextEntry = opts?.nextEntry || null;
  const nextHint = nextEntry
    ? describeActionIntent(nextEntry.action || '', nextEntry.params || {})
    : '';
  const failedIsConfirm = isConfirmLike(action, params);
  const pickerLike = isPickerSelectAction(action);

  return [
    '当前为步骤回放失败后的自愈阶段。页面结构或校验可能已变化（例如表单新增必填字段、标签改名、保存后出现校验红字）。',
    '你的目标：先诊断并排除阻塞，再完成下方「原意图」——且只完成这一步；成功后立即 done() 停止。',
    '严禁执行轨迹中的下一步（确认/确定/保存/关闭弹窗等会由后续回放步骤执行）。',
    '',
    `【失败动作】${action}`,
    `【原意图】${intent}`,
    `【失败原因】${err}`,
    nextHint
      ? `【下一步（禁止现在做）】${nextHint} — 留给确定性回放，自愈阶段不要点。`
      : '',
    '',
    '【推荐排查顺序】',
    '1. 用 get_page_state() 查看 notifications / formErrors；若有校验红字，调用 sync_tasks_from_errors() 或 scroll_to_form_error() 定位未填/错误字段。',
    '2. 若失败原因含校验/必填/保存失败，或页面上出现 .el-form-item__error：逐项补齐新增或未填的必填字段（fill_form_field / select_option / select_date 等）。可用一次 fill/select 触发隐式 auto-fill；scan_form_fields 只建任务列表、不会自动填表。',
    '3. 若是控件找不到（not-found）：在当前页找文案相近的等价控件完成同一意图，不要离开当前流程去乱点菜单。',
    '4. 阻塞清除后，重新执行原意图'
      + (isSaveLike(action, params)
        ? '（优先 click_save()，确认 ok-save-success 或校验已清空）。'
        : pickerLike
          ? '（仅完成行内选择/单选；弹窗仍保持打开）。'
          : '（完成与失败动作等价的操作）。'),
    '5. 原意图达成后立即 done(success=true)，停止本轮。不要再点确认/确定/保存（除非原意图本身就是这些按钮）。',
    '',
    '约束：',
    '- 【单步边界】本轮只修复失败的那一步；等价操作完成后立刻 done，不要「顺便」做完弹窗流程。',
    pickerLike && !failedIsConfirm
      ? '- 【弹窗/引入】click_table_row_radio / 行选择：只点目标行的单选/行本体；禁止再点「确认」「确定」「提交」「关闭」。'
      : '',
    !failedIsConfirm
      ? '- 除非【失败动作】本身是确认/确定类按钮，否则禁止点击文案为 确认/确定/OK/提交 的按钮。'
      : '',
    '- 允许为完成原意图而补填「新增必填 / 校验失败」字段；不要改写已填对的业务值，除非校验要求必须改。',
    '- 不要导航到无关页面，不要开始下一段业务流程。',
    '- 禁用且带旁路按钮的字段走 request_intervention，不要硬填。',
    looksLikeValidation
      ? '- 本次失败很像表单校验/结构变更：请优先按第 1–2 步排查，不要只重复点击保存。'
      : '- 若重试原动作仍失败，再按第 1–2 步做表单诊断。',
  ].filter(Boolean).join('\n');
}

function isSaveLike(action, params) {
  const a = String(action || '');
  if (a === 'click_save') return true;
  const text = String(params?.text || params?.button_text || params?.menu_text || '');
  return /保存|提交|确定|确认|submit|save/i.test(text);
}

/** Confirm / OK footer buttons (often the *next* recorded step after a picker). */
function isConfirmLike(action, params) {
  const a = String(action || '');
  if (a === 'click_save') return true;
  const text = String(params?.text || params?.button_text || params?.menu_text || '');
  return /^(确认|确定|OK|Ok|ok|提交)$/i.test(text.trim())
    || /确认|确定/.test(text);
}

function isPickerSelectAction(action) {
  const a = String(action || '');
  return a === 'click_table_row_radio'
    || a === 'click_table_row_button'
    || a === 'click_table_row';
}

function describeActionIntent(action, params) {
  const p = params || {};
  switch (action) {
    case 'fill_form_field':
      return `填写 "${p.label_text || ''}" = "${p.value ?? ''}"`;
    case 'select_option':
      return `在 "${p.label_text || ''}" 中选择 "${p.option_text || ''}"`;
    case 'select_tree_option':
      return `在树选择 "${p.label_text || ''}" 中选择 "${p.option_text || p.node_text || ''}"`;
    case 'fill_date_field':
    case 'select_date':
      return `填写日期 "${p.label_text || ''}" = "${p.value || p.date || ''}"`;
    case 'click_save':
      return `点击保存/提交（${p.button_text || p.text || '保存'}），直到保存成功或校验通过`;
    case 'click_element_by_index':
      return `点击 "${p.text || p.index || ''}"`;
    case 'click_menu_item':
      return `点击菜单 "${p.menu_text || p.text || ''}"`;
    case 'click_table_row_radio':
      return (
        `在表格中选中行单选（行匹配: "${p.row_text || p.text || p.row_match || ''}"）。`
        + '只点该行的 radio/单选，不要点弹窗「确认/确定」。'
      );
    case 'click_table_row_button':
      return (
        `点击表格行按钮 "${p.button_text || p.text || ''}"（行匹配: ${p.row_text || p.row_match || ''}）。`
        + '只点该行按钮，不要再点弹窗确认。'
      );
    case 'click_adjacent_button':
      return `点击相邻按钮 "${p.button_text || p.text || ''}"`;
    case 'go_to_url':
      return `打开 URL ${p.url || ''}`;
    case 'switch_tab':
      return `切换标签 "${p.tab_text || p.text || ''}"`;
    case 'close_dialog':
      return '关闭对话框';
    default:
      try {
        return `${action} ${JSON.stringify(p)}`;
      } catch {
        return action;
      }
  }
}

export function buildRerunResumeInstruction({ actionData, failedStep, log_file, form_changes, replayedCount, PROJECT_DIR }) {
  let resumeInstruction = '';
  try {
    const url = actionData.url || '';
    const commands = actionData?.tests?.[0]?.commands || actionData?.actions || [];
    const remaining = commands.filter((c, i) => (i + 1) >= failedStep);

    // Load heal prompt template
    const healPromptPath = path.resolve(PROJECT_DIR, 'scripts', 'prompts', 'heal-prompt.md');
    let template = '';
    try {
      template = existsSync(healPromptPath) ? readFileSync(healPromptPath, 'utf-8') : '';
    } catch (_) {}

    // Build URL section
    const replayNote = replayedCount > 0
      ? `当前页面已通过 _replay（scripts/actions/_replay.py）自动回放了前 ${replayedCount} 步操作，处于第 ${failedStep} 步的待操作状态。无需重复导航和登录，直接从第 ${failedStep} 步继续；若需填表，对主页面/抽屉字段调用 fill/select 以触发隐式 auto-fill。\n\n`
      : '';
    const urlSection = replayedCount > 0
      ? replayNote
      : (url && !url.includes('unknown'))
        ? '【目标URL】\n' + url + '\n\n'
        : '';

    // Build form changes section
    let formChangesSection = '';
    if (form_changes) {
      const changesList = Array.isArray(form_changes) ? form_changes : [form_changes];
      for (const change of changesList) {
        const container = change.container || 'main';
        const containerInfo = container !== 'main' ? ` (容器: ${container})` : '';
        const missing_required = change.missing_required || [];
        const added_required = change.added_required || [];
        const missing_optional = change.missing_optional || [];
        const added_optional = change.added_optional || [];
        const isWarning = missing_required.length === 0 && added_required.length === 0;

        if (isWarning) {
          if (missing_optional.length || added_optional.length) {
            formChangesSection += `【P3 FORM WARNING: 可选字段变化${containerInfo}（仅参考）】\n`;
            if (missing_optional.length) {
              formChangesSection += '  已移除的可选字段：' + missing_optional.map(f => '"' + f + '"').join('、') + '\n';
            }
            if (added_optional.length) {
              formChangesSection += '  新增的可选字段：' + added_optional.map(f => '"' + f + '"').join('、') + '\n';
            }
            formChangesSection += '\n';
          } else if (change.reordered) {
            formChangesSection += `【P4 FORM WARNING: 字段顺序变化${containerInfo}（仅参考）】\n\n`;
          }
        } else {
          formChangesSection += `【P2 FORM ERROR: 必填字段变化${containerInfo}（导致脚本失败，需自愈修复）】\n`;
          if (missing_required.length) {
            formChangesSection += '  已从表单中移除的必填字段（无需填写，跳过）：\n';
            missing_required.forEach(f => formChangesSection += '    - "' + f + '"\n');
          }
          if (added_required.length) {
            formChangesSection += '  表单中新增的必填字段（必须扫描页面找到并填写）：\n';
            added_required.forEach(f => formChangesSection += '    - "' + f + '"\n');
          }
          if (missing_optional.length || added_optional.length) {
            formChangesSection += '  附：可选字段变化 — 移除：' + (missing_optional.map(f => '"' + f + '"').join('、') || '无') + ' | 新增：' + (added_optional.map(f => '"' + f + '"').join('、') || '无') + '\n';
          }
          formChangesSection += '\n';
        }
      }
    }

    // Build remaining commands
    let remainingCmds = '';
    for (const cmd of remaining) {
      const stepNum = commands.indexOf(cmd) + 1;
      const a = cmd.action || ''; const p = cmd.params || {};
      if (a === 'fill_form_field') remainingCmds += '- Step ' + stepNum + ': 填写 "' + (p.label_text || '') + '" = "' + (p.value || '') + '"\n';
      else if (a === 'select_option') remainingCmds += '- Step ' + stepNum + ': 在 "' + (p.label_text || '') + '" 中选择 "' + (p.option_text || '') + '"\n';
      else if (a === 'click_element_by_index') remainingCmds += '- Step ' + stepNum + ': 点击 "' + (p.text || p.index || '') + '"\n';
      else remainingCmds += '- Step ' + stepNum + ': ' + a + '\n';
    }

    // Build log section
    let logSection = '';
    if (log_file) {
      const logPath = path.resolve(PROJECT_DIR, log_file);
      if (existsSync(logPath)) {
        const logContent = readFileSync(logPath, 'utf-8');
        if (logContent.trim()) {
          logSection = '\n---\n\n## 文件说明\n\n以下包含两份文件，供你理解任务上下文：\n\n' +
            '### 截断的 Action 文件（上方操作步骤列表）\n' +
            '- 来源于原始脚本从第 ' + failedStep + ' 步开始截断后的剩余操作步骤。\n' +
            '- 这是原始脚本期望执行的步骤（可能已不适用于当前页面状态，仅供参考业务意图）。\n' +
            '- 你需要根据下方 Log 文件中的完整上下文，理解原始录制的正确操作流程。\n\n' +
            '### 完整的 Log 文件（下方日志内容）\n' +
            '- 来源于原始录制时完整成功执行的过程日志，包含完整的导航路径和所有成功操作。\n' +
            '- 请参照 Log 中的完整操作序列来理解业务目标、导航步骤和正确的操作方式。\n' +
            '- 复现失败场景后，请根据 Log 中的业务意图重新填写表单。\n\n' +
            '## 原始执行日志\n```\n' + logContent.trim() + '\n```\n';
        }
      }
    }

    // Assemble from template
    if (template) {
      resumeInstruction = template
        .replace('{{URL_SECTION}}', urlSection)
        .replace('{{FORM_CHANGES_SECTION}}', formChangesSection)
        .replace('{{FAILED_STEP}}', String(failedStep))
        .replace('{{REMAINING_COMMANDS}}', remainingCmds || '(无剩余操作步骤)')
        .replace('{{LOG_SECTION}}', logSection);
      if (replayedCount > 0) {
        resumeInstruction = resumeInstruction.replace(
          '若上方未说明「已回放」，请根据目标 URL 与下方步骤抵达出错页面。抵达后',
          '',
        );
        resumeInstruction = resumeInstruction.replace('逐步导航并复现失败场景，抵达出错页面后，', '');
      }
    } else {
      // Fallback: build inline
      const lines = [];
      if (urlSection) lines.push(urlSection.trim());
      if (replayedCount === 0) {
        lines.push('当前为脚本执行失败后的自愈修复阶段。失败步之前的页面状态应由 _replay 自动回放重建；若未能回放，请根据目标 URL 与下方步骤抵达出错页面。抵达后对主页面/抽屉字段调用 fill/select 触发隐式 auto-fill，或逐字段填写；勿仅靠 scan_form_fields（它不再自动填表）。');
      } else {
        lines.push('当前为脚本执行失败后的自愈修复阶段。请对主页面/抽屉字段调用 fill/select 触发隐式 auto-fill，或逐字段填写；勿仅靠 scan_form_fields（它不再自动填表）。');
      }
      if (formChangesSection) lines.push('\n' + formChangesSection.trim());
      lines.push('\n## 剩余操作步骤（从第 ' + failedStep + ' 步开始）');
      lines.push(remainingCmds || '(无剩余操作步骤)');
      if (logSection) lines.push(logSection.trim());
      resumeInstruction = lines.join('\n');
    }
  } catch (e) {
    resumeInstruction = 'Continue recording from step ' + failedStep + '. See action file for details.';
  }
  return { resumeInstruction };
}
