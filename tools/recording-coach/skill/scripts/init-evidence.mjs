#!/usr/bin/env node
/**
 * Create an empty recording-coach evidence directory.
 *
 * Usage:
 *   node skill/scripts/init-evidence.mjs [--repo <path>] [--label <slug>]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEvidenceDir } from '../../src/workflow.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, '../templates');

/**
 * @param {string} startDir
 * @returns {string}
 */
function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'tools', 'recording-coach'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('could not find repo root containing tools/recording-coach');
    }
    dir = parent;
  }
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ help?: boolean, repo?: string, label?: string }} */
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--repo') out.repo = argv[++i];
    else if (a === '--label') out.label = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function printHelp() {
  console.log(`init-evidence — create recording-coach evidence directory

Usage:
  node skill/scripts/init-evidence.mjs [--repo <path>] [--label <slug>]

Options:
  --repo <path>   Repository root (default: auto-detect from script location)
  --label <slug>  Write hypothesis.txt with this label
  --help          Show this help
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

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const repoRoot = args.repo ? path.resolve(args.repo) : findRepoRoot(__dirname);
  const { evidenceDir } = createEvidenceDir(repoRoot);

  if (args.label) {
    fs.writeFileSync(path.join(evidenceDir, 'hypothesis.txt'), `${args.label}\n`, 'utf8');
  }

  const checklistSrc = path.join(TEMPLATES_DIR, 'evidence-checklist.md');
  const checklistBody = fs.readFileSync(checklistSrc, 'utf8');
  fs.writeFileSync(
    path.join(evidenceDir, 'evidence-checklist.md'),
    fillTemplate(checklistBody, { EVIDENCE_DIR: evidenceDir }),
    'utf8',
  );

  console.log(`evidenceDir=${evidenceDir}`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
