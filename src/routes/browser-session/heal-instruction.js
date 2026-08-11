import { existsSync, readFileSync } from 'fs';
import path from 'path';

/**
 * Single-step heal prompt for live steps/replay.
 * Only redo the failed recorded action — no extra diagnosis / fill / next-step ops.
 *
 * @param {{ action?: string, params?: object, id?: string|number }} failedEntry
 * @param {string} [errorResult]
 * @returns {string}
 */
export function buildStepHealInstruction(failedEntry, errorResult = '') {
  const action = failedEntry?.action || 'unknown';
  const params = failedEntry?.params || {};
  const intent = describeActionIntent(action, params);
  const err = errorResult ? String(errorResult) : '(unknown)';

  return [
    '当前为步骤回放失败后的单步自愈阶段。页面已停在失败步。',
    '请只完成下面这一步的原意图，成功后立即 done(success=true) 停止。',
    '不要做任何额外操作：不要补填其它字段、不要诊断整表、不要点确认/确定/保存（除非原意图本身就是该按钮）、不要执行轨迹下一步。',
    '',
    `【失败动作】${action}`,
    `【原意图】${intent}`,
    `【失败原因】${err}`,
    '',
    '约束：',
    '- 仅用与失败动作等价的 Element UI 动作重做这一步（控件文案轻微变化时可找等价控件）。',
    '- 禁止 fill/select 其它无关字段；禁止 sync_tasks_from_errors / 整表 auto-fill。',
    '- 不要导航离开当前流程。',
    '- 行选/引入类步骤：选中后弹窗可能仍保持打开——这是正常的；不要点确认/确定去关窗（那是轨迹下一步）。',
    '- 完成后立即 done(success=true)。系统对单步自愈的 done 使用单独判定，不会因弹窗仍开着而拒绝。',
  ].join('\n');
}

/**
 * Type B — form structure change heal (distinct from single-step Type A).
 * AI only fills newly added fields in the browser; control plane persists steps separately.
 *
 * @param {{ container?: string, added_required?: string[], added_optional?: string[], missing_required?: string[], missing_optional?: string[] }} report
 * @returns {string}
 */
export function buildFormStructureHealInstruction(report = {}) {
  const container = report.container || 'main';
  const addedReq = Array.isArray(report.added_required) ? report.added_required : [];
  const addedOpt = Array.isArray(report.added_optional) ? report.added_optional : [];
  const missingReq = Array.isArray(report.missing_required) ? report.missing_required : [];
  const missingOpt = Array.isArray(report.missing_optional) ? report.missing_optional : [];
  const toFill = [...addedReq, ...addedOpt];

  const lines = [
    '当前为【表单结构变化自愈】阶段（healType=form_structure），不是单步自愈。',
    `表单容器：${container}`,
    '页面已停在结构校验检查点。请只填写下方新增字段，成功后立即 done(success=true) 停止。',
    '',
  ];
  if (missingReq.length || missingOpt.length) {
    lines.push('【已从表单移除的字段】（勿再填写；控制面会删除对应步骤）');
    for (const l of missingReq) lines.push(`  - [必填已删] "${l}"`);
    for (const l of missingOpt) lines.push(`  - [可选已删] "${l}"`);
    lines.push('');
  }
  lines.push('【必须填写的新增字段】');
  if (!toFill.length) {
    lines.push('  （无新增字段 — 直接 done）');
  } else {
    for (const l of addedReq) lines.push(`  - [必填] "${l}"`);
    for (const l of addedOpt) lines.push(`  - [可选] "${l}"`);
  }
  lines.push('');
  lines.push('约束：');
  lines.push('- 仅填写上述新增字段（fill_form_field / select_option / fill_date_field / click_radio 等）。');
  lines.push('- 不要点保存/提交/确认；不要导航；不要处理其它业务步骤。');
  lines.push('- 禁止整表 auto-fill / sync_tasks_from_errors。');
  lines.push('- 完成后立即 done(success=true)。系统对表单结构自愈的 done 使用单独判定，不会因弹窗仍开着而拒绝。');
  return lines.join('\n');
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
      return `点击保存/提交（${p.button_text || p.text || '保存'}）`;
    case 'click_element_by_index':
      return `点击 "${p.text || p.index || ''}"`;
    case 'click_menu_item':
      return `点击菜单 "${p.menu_text || p.text || ''}"`;
    case 'click_table_row_radio':
      return `在表格中选中行单选（行匹配: "${p.row_text || p.text || p.row_match || ''}"）`;
    case 'click_table_row_button':
      return `点击表格行按钮 "${p.button_text || p.text || ''}"（行匹配: ${p.row_text || p.row_match || ''}）`;
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
      ? `当前页面已通过 _replay（scripts/controller/actions/_replay.py）自动回放了前 ${replayedCount} 步操作，处于第 ${failedStep} 步的待操作状态。无需重复导航和登录，直接从第 ${failedStep} 步继续；若需填表，对主页面/抽屉字段调用 fill/select 以触发隐式 auto-fill。\n\n`
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
