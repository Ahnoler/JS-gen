#!/usr/bin/env node
/**
 * Assemble preflight probe list and optionally run preflight_readonly.
 *
 * Usage:
 *   node skill/scripts/preflight-probes.mjs --evidence <dir> [--profile none|rating-credit|custom]
 *     [--custom-json <path>] [--run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTools } from '../../src/tools.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASE_URL = 'http://127.0.0.1:4097';

const PROFILES = {
  none: [],
  'rating-credit': [
    // 占位：路径以 http://localhost:4097/api/docs 为准（或 http://127.0.0.1:4097/api/docs）
    // 暂无稳定 GET path；选择本 profile 须同时提供 --custom-json
  ],
  custom: [],
};

const API_DOCS_HINT = 'http://127.0.0.1:4097/api/docs';

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{
   *   help?: boolean,
   *   evidence?: string,
   *   profile?: string,
   *   customJson?: string,
   *   run?: boolean,
   * }} */
  const out = { profile: 'none' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--evidence') out.evidence = argv[++i];
    else if (a === '--profile') out.profile = argv[++i];
    else if (a === '--custom-json') out.customJson = argv[++i];
    else if (a === '--run') out.run = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function printHelp() {
  console.log(`preflight-probes — assemble probes.json and optionally run preflight_readonly

Usage:
  node skill/scripts/preflight-probes.mjs --evidence <dir> \\
    [--profile none|rating-credit|custom] [--custom-json <path>] [--run]

Options:
  --evidence <dir>       Evidence directory (required)
  --profile <name>       Probe profile (default: none)
  --custom-json <path>   JSON array of probe paths or { path } objects
  --run                  Call preflight_readonly after writing probes.json
  --help                 Show this help

Profiles:
  none            probes = []
  rating-credit   requires --custom-json (paths per ${API_DOCS_HINT})
  custom          requires --custom-json
`);
}

/**
 * @param {unknown} raw
 * @returns {{ path: string, label?: string }[]}
 */
function normalizeProbeList(raw) {
  if (!Array.isArray(raw)) {
    throw new Error('custom-json must be a JSON array');
  }
  return raw.map((item, index) => {
    if (typeof item === 'string') {
      return { path: item };
    }
    if (item && typeof item === 'object' && typeof item.path === 'string') {
      const probe = { path: item.path };
      if (item.label != null) probe.label = String(item.label);
      return probe;
    }
    throw new Error(`custom-json[${index}] must be a string path or { path } object`);
  });
}

/**
 * @param {{ path: string }[]} probes
 */
function assertProbePaths(probes) {
  for (const probe of probes) {
    if (!String(probe.path).startsWith('/api/v2/')) {
      throw new Error(`probe path must start with /api/v2/: ${probe.path}`);
    }
  }
}

/**
 * @param {ReturnType<typeof parseArgs>} args
 * @returns {Promise<{ path: string, label?: string }[]>}
 */
async function resolveProbes(args) {
  const profile = args.profile ?? 'none';
  if (!Object.hasOwn(PROFILES, profile)) {
    throw new Error(`unknown profile: ${profile}`);
  }

  if (profile === 'none') {
    return [];
  }

  if (!args.customJson) {
    if (profile === 'rating-credit') {
      console.error(
        `profile rating-credit requires --custom-json with GET paths (see ${API_DOCS_HINT})`,
      );
      process.exit(2);
    }
    if (profile === 'custom') {
      console.error('profile custom requires --custom-json');
      process.exit(2);
    }
  }

  const raw = JSON.parse(fs.readFileSync(path.resolve(args.customJson), 'utf8'));
  const probes = normalizeProbeList(raw);
  assertProbePaths(probes);
  return probes;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.evidence) {
    throw new Error('missing required argument: --evidence');
  }

  const evidenceDir = path.resolve(args.evidence);
  if (!fs.existsSync(evidenceDir) || !fs.statSync(evidenceDir).isDirectory()) {
    throw new Error(`evidence directory not found: ${evidenceDir}`);
  }

  const probes = await resolveProbes(args);
  const probesPath = path.join(evidenceDir, 'probes.json');
  fs.writeFileSync(probesPath, JSON.stringify(probes, null, 2), 'utf8');

  if (!args.run) {
    console.log(JSON.stringify({ ok: true, evidenceDir, probesPath, probeCount: probes.length }));
    return;
  }

  const workflowPath = path.join(evidenceDir, 'workflow.json');
  if (!fs.existsSync(workflowPath)) {
    throw new Error(`no workflow.json in ${evidenceDir}`);
  }

  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  if (workflow.phase !== 'ReadyToCreate') {
    throw new Error(`--run requires workflow phase ReadyToCreate, have ${workflow.phase}`);
  }

  const baseUrl = process.env.JSGEN_BASE_URL || DEFAULT_BASE_URL;
  const tools = createTools({ evidenceDir, baseUrl });
  await tools.handlers.preflight_readonly({ probes });
  console.log(JSON.stringify({ ok: true, evidenceDir, probesPath, preflightPath: path.join(evidenceDir, 'preflight.json') }));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
