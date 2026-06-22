/**
 * test-fix.js — Self-healing endpoint for Playwright scripts.
 *
 * POST /api/test/fix
 *   Body: { actionFile, errors, stderr? }
 *   - Reads the action JSON file
 *   - Constructs repair prompt with atp-fix skill + error context
 *   - Calls LLM to get structured fix suggestions (action JSON changes)
 *   - Applies changes and re-assembles
 *   - Returns: { success, changes, fixedActionFile, fixedScript }
 *
 * POST /api/test/fix/preview
 *   Body: { actionFile, errors, stderr? }
 *   - Same as /fix but only returns the LLM's suggested changes without applying
 *   - Returns: { success, changes, diagnosis }
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { PROJECT_DIR } from '../config.js';
import { callLLM } from '../llm-utils.js';
import { execSync } from 'child_process';

const SCRIPTS_DIR = path.join(PROJECT_DIR, 'scripts');
const GENERATED_DIR = path.join(SCRIPTS_DIR, 'generated');
const SKILL_DIR = path.join(PROJECT_DIR, '.opencode', 'skills', 'atp-fix');

function loadSkillPrompt() {
  const skillPath = path.join(SKILL_DIR, 'SKILL.md');
  if (existsSync(skillPath)) {
    return readFileSync(skillPath, 'utf-8');
  }
  return '';
}

function buildFixPrompt(actionFile, errors, stderr) {
  const skillPrompt = loadSkillPrompt();

  // Read the action entries
  let actionEntries = [];
  let url = '';
  try {
    const absPath = path.resolve(SCRIPTS_DIR, '..', actionFile);
    if (existsSync(absPath)) {
      const data = JSON.parse(readFileSync(absPath, 'utf-8'));
      actionEntries = data?.tests?.[0]?.commands || data?.actions || [];
      url = data?.url || '';
    }
  } catch {}

  // Build a table of all action steps
  const stepsTable = actionEntries
    .map((entry, i) => {
      const a = entry.action || '';
      const p = entry.params || {};
      return `| ${i + 1} | ${a} | ${p.label_text || p.menu_text || p.tab_name || p.row_text || p.option_text || p.index || ''} | ${p.value || p.option_text || ''} | ${entry.target || (entry.element?.xpath || '')} |`;
    })
    .join('\n');

  // Pick the error context — the failed step and surrounding steps
  const failedSteps = (errors || []).map(e => e.step).filter(Boolean);
  const errorContext = errors ? errors.map(e =>
    `- Step ${e.step}: ${e.action} "${e.label || ''}" → ${e.error} (${e.details || ''})`
  ).join('\n') : '';

  return `${skillPrompt}

---

## Current Script Context

**Target URL**: ${url || '(unknown)'}

**Action Steps**:
| Step | Action | Label/Text | Value | Target/XPath |
|------|--------|-----------|-------|-------------|
${stepsTable}

## Execution Errors

${errorContext || 'No specific errors provided'}

${stderr ? `**Raw stderr**:\n\`\`\`\n${stderr.slice(-1000)}\n\`\`\`\n` : ''}

## Task

The script above failed at the indicated steps. Analyze the errors and the action entries.
For each failed step, determine what went wrong and suggest a fix.

**Output a JSON object** in the following format (no other text):

\`\`\`json
{
  "diagnosis": "Brief description of what went wrong",
  "changes": [
    {
      "step": <step number>,
      "action": "modify" | "delete" | "insert",
      "reason": "Why this change is needed",
      "entry": {
        "action": "<action type>",
        "params": { ... },
        "target": "<XPath or selector>",
        "targetType": "xpath",
        "tagName": "<tag>",
        "element": { "xpath": "...", "tag_name": "...", "attributes": {...} }
      }
    }
  ]
}
\`\`\`

Rules:
- For "modify": provide the complete corrected entry with all fields
- For "delete": no entry needed
- For "insert": provide the new entry to insert before the specified step
- Prefer fixing the selector (use ID if available, then class, then XPath)
- If a field label changed, update label_text in params
- If a step is no longer needed (e.g., the element was removed), delete it
- If additional wait/delay is needed, insert a wait_for_loading step`;
}

function parseFixResponse(llmOutput) {
  // Extract JSON from LLM output
  try {
    // Try direct parse
    return JSON.parse(llmOutput);
  } catch {}

  // Try extracting from code fence
  const jsonMatch = llmOutput.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1].trim());
    } catch {}
  }

  // Try finding a JSON object
  const objMatch = llmOutput.match(/\{[\s\S]*"changes"[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch {}
  }

  return null;
}

export default function (app) {

  /**
   * POST /api/test/fix
   * Full fix: analyze → suggest changes → apply → re-assemble
   */
  app.post('/api/test/fix', async (req, res) => {
    try {
      const { actionFile, errors, stderr } = req.body || {};
      if (!actionFile) return res.status(400).json({ error: 'actionFile is required' });
      if (!errors || !Array.isArray(errors) || errors.length === 0) {
        return res.status(400).json({ error: 'errors array is required' });
      }

      // 1. Build prompt
      const prompt = buildFixPrompt(actionFile, errors, stderr);

      // 2. Call LLM
      let fixResult = null;
      try {
        const llmOutput = await callLLM(prompt, null);  // null = use default model
        fixResult = parseFixResponse(llmOutput);
      } catch (llmErr) {
        return res.status(500).json({ error: 'LLM call failed: ' + llmErr.message });
      }

      if (!fixResult || !fixResult.changes || !Array.isArray(fixResult.changes)) {
        return res.status(500).json({
          error: 'LLM did not return valid fix suggestions',
          rawOutput: fixResult,
        });
      }

      // 3. Read and apply changes to action file
      const absPath = path.resolve(SCRIPTS_DIR, '..', actionFile);
      if (!existsSync(absPath)) {
        return res.status(404).json({ error: 'actionFile not found: ' + absPath });
      }

      const data = JSON.parse(readFileSync(absPath, 'utf-8'));
      const commands = data?.tests?.[0]?.commands || data?.actions || [];

      // Apply changes using the assembler's apply_changes
      // (replicated here for Node.js — see Python script_assembler.apply_changes)
      const cmds = [...commands];
      const sortedChanges = [...fixResult.changes].sort((a, b) => b.step - a.step);
      for (const change of sortedChanges) {
        const idx = change.step - 1;
        if (change.action === 'modify' && idx >= 0 && idx < cmds.length && change.entry) {
          cmds[idx] = change.entry;
        } else if (change.action === 'delete' && idx >= 0 && idx < cmds.length) {
          cmds.splice(idx, 1);
        } else if (change.action === 'insert' && change.entry) {
          cmds.splice(Math.min(idx, cmds.length), 0, change.entry);
        }
      }

      // 4. Save fixed action file
      if (!existsSync(GENERATED_DIR)) mkdirSync(GENERATED_DIR, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const fixedActionPath = path.join(GENERATED_DIR, `fixed_action_${ts}.json`);

      // Update the original data structure
      if (data?.tests?.[0]) {
        data.tests[0].commands = cmds;
      } else if (data?.actions) {
        data.actions = cmds;
      }
      writeFileSync(fixedActionPath, JSON.stringify(data, null, 2), 'utf-8');

      // 5. Re-assemble script
      const fixedScriptPath = path.join(GENERATED_DIR, `fixed_script_${ts}.js`);
      const assemblerPy = path.join(SCRIPTS_DIR, 'script_assembler.py');
      const relativeFixedAction = path.relative(PROJECT_DIR, fixedActionPath);
      execSync(`python "${assemblerPy}" "${fixedActionPath}" "${fixedScriptPath}"`, {
        encoding: 'utf-8', timeout: 30000,
      });

      const fixedScript = readFileSync(fixedScriptPath, 'utf-8');

      res.json({
        success: true,
        diagnosis: fixResult.diagnosis || '',
        changes: fixResult.changes,
        fixedActionFile: relativeFixedAction,
        fixedScriptPath,
        fixedScript,
        stats: {
          modified: fixResult.changes.filter(c => c.action === 'modify').length,
          deleted: fixResult.changes.filter(c => c.action === 'delete').length,
          inserted: fixResult.changes.filter(c => c.action === 'insert').length,
        },
      });

    } catch (err) {
      console.error('[test-fix] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/test/fix/preview
   * Preview-only: returns LLM fix suggestions without applying
   */
  app.post('/api/test/fix/preview', async (req, res) => {
    try {
      const { actionFile, errors, stderr } = req.body || {};
      if (!actionFile) return res.status(400).json({ error: 'actionFile is required' });
      if (!errors || !Array.isArray(errors) || errors.length === 0) {
        return res.status(400).json({ error: 'errors array is required' });
      }

      const prompt = buildFixPrompt(actionFile, errors, stderr);

      let fixResult = null;
      try {
        const llmOutput = await callLLM(prompt, null);
        fixResult = parseFixResponse(llmOutput);
      } catch (llmErr) {
        return res.status(500).json({ error: 'LLM call failed: ' + llmErr.message });
      }

      res.json({
        success: true,
        ...(fixResult || { changes: [], diagnosis: 'Failed to parse LLM response' }),
      });

    } catch (err) {
      console.error('[test-fix/preview] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });
}
