#!/usr/bin/env node
/**
 * Fill dispatch-brief.md and task-text.md from templates.
 *
 * Usage:
 *   node skill/scripts/scaffold-brief.mjs --evidence <dir> --goal <text> \
 *     --function-id <id> --account-id <id> --ref-traj <id> --task-file <path> \
 *     [--product-label <label>] [--apply]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDispatchBrief } from '../../src/dispatch-brief.mjs';
import { assertBusinessTaskText } from '../../src/task-text.mjs';
import { createTools } from '../../src/tools.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, '../templates');
const DEFAULT_BASE_URL = 'http://127.0.0.1:4097';

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{
   *   help?: boolean,
   *   evidence?: string,
   *   goal?: string,
   *   functionId?: string,
   *   accountId?: string,
   *   refTraj?: string,
   *   taskFile?: string,
   *   productLabel?: string,
   *   apply?: boolean,
   * }} */
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--evidence') out.evidence = argv[++i];
    else if (a === '--goal') out.goal = argv[++i];
    else if (a === '--function-id') out.functionId = argv[++i];
    else if (a === '--account-id') out.accountId = argv[++i];
    else if (a === '--ref-traj') out.refTraj = argv[++i];
    else if (a === '--task-file') out.taskFile = argv[++i];
    else if (a === '--product-label') out.productLabel = argv[++i];
    else if (a === '--apply') out.apply = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function printHelp() {
  console.log(`scaffold-brief — fill dispatch-brief.md and task-text.md from templates

Usage:
  node skill/scripts/scaffold-brief.mjs --evidence <dir> --goal <text> \\
    --function-id <id> --account-id <id> --ref-traj <id> --task-file <path> \\
    [--product-label <label>] [--apply]

Options:
  --evidence <dir>       Evidence directory (must contain workflow.json)
  --goal <text>          Business goal
  --function-id <id>     functionId
  --account-id <id>      systemAccountId
  --ref-traj <id>        Reference trajectory id
  --task-file <path>     File whose contents replace {{TASK_BODY}}
  --product-label <label> Product label (default: goal)
  --apply                Call save_dispatch_brief + mark_inputs_ready via createTools
  --help                 Show this help
`);
}

/**
 * @param {string} template
 * @param {Record<string, string>} vars
 */
function fillTemplate(template, vars) {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(value ?? '');
  }
  return out;
}

/**
 * @param {ReturnType<typeof parseArgs>} args
 */
function requireArgs(args) {
  const missing = [];
  if (!args.evidence) missing.push('--evidence');
  if (!args.goal) missing.push('--goal');
  if (!args.functionId) missing.push('--function-id');
  if (!args.accountId) missing.push('--account-id');
  if (!args.refTraj) missing.push('--ref-traj');
  if (!args.taskFile) missing.push('--task-file');
  if (missing.length) {
    throw new Error(`missing required arguments: ${missing.join(', ')}`);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  requireArgs(args);

  const evidenceDir = path.resolve(args.evidence);
  if (!fs.existsSync(path.join(evidenceDir, 'workflow.json'))) {
    throw new Error(`no workflow.json in ${evidenceDir}`);
  }

  const taskBody = fs.readFileSync(path.resolve(args.taskFile), 'utf8');
  const productLabel = args.productLabel ?? args.goal ?? '';
  const baseUrl = process.env.JSGEN_BASE_URL || DEFAULT_BASE_URL;

  const vars = {
    BASE_URL: baseUrl,
    FUNCTION_ID: String(args.functionId),
    SYSTEM_ACCOUNT_ID: String(args.accountId),
    REF_TRAJ: String(args.refTraj),
    EVIDENCE_DIR: evidenceDir,
    GOAL: String(args.goal),
    TASK_BODY: taskBody,
    PRODUCT_LABEL: productLabel,
  };

  const briefTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'dispatch-brief.md'), 'utf8');
  const taskTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'task-text.md'), 'utf8');

  const brief = fillTemplate(briefTemplate, vars);
  const taskText = fillTemplate(taskTemplate, vars);

  assertDispatchBrief(brief);
  assertBusinessTaskText(taskText);

  const dispatchBriefPath = path.join(evidenceDir, 'dispatch-brief.md');
  const taskTextPath = path.join(evidenceDir, 'task-text.md');
  fs.writeFileSync(dispatchBriefPath, brief, 'utf8');
  fs.writeFileSync(taskTextPath, taskText, 'utf8');

  if (args.apply) {
    const tools = createTools({ evidenceDir, baseUrl });
    await tools.handlers.save_dispatch_brief({ text: brief });
    await tools.handlers.mark_inputs_ready({
      taskText,
      goal: String(args.goal),
      functionId: Number(args.functionId),
      systemAccountId: Number(args.accountId),
      productLabel,
      businessProbeRequired: false,
    });
  }

  console.log(
    JSON.stringify({
      ok: true,
      evidenceDir,
      dispatchBriefPath,
      taskTextPath,
    }),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
