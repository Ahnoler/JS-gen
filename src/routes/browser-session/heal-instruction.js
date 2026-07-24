import { existsSync, readFileSync } from 'fs';
import path from 'path';

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
      ? `当前页面已通过 _replay（scripts/actions/_replay.py）自动回放了前 ${replayedCount} 步操作，处于第 ${failedStep} 步的待操作状态。无需重复导航和登录，直接扫描当前表单，建立任务清单，从第 ${failedStep} 步开始继续填写。\n\n`
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
        lines.push('当前为脚本执行失败后的自愈修复阶段。失败步之前的页面状态应由 _replay 自动回放重建；若未能回放，请根据目标 URL 与下方步骤抵达出错页面。抵达后扫描当前表单，建立任务清单，重新填写所有表单项。');
      } else {
        lines.push('当前为脚本执行失败后的自愈修复阶段。请扫描当前表单，建立任务清单，重新填写所有表单项。');
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
