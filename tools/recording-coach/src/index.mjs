#!/usr/bin/env node
/**
 * Recording Coach CLI — OpenCode multi-turn + workflow.json + v2 HTTP tools.
 *
 * Usage:
 *   node src/index.mjs                  # create evidence + OpenCode (or REPL fallback)
 *   node src/index.mjs --cli-only       # force CLI tool REPL (no OpenCode)
 *   node src/index.mjs --tool list_executors
 *   node src/index.mjs --resume <evidenceDir>
 *
 * Env: JSGEN_BASE_URL (default http://127.0.0.1:4097)
 * Ports: control plane 4097; OpenCode embedded server 4096 (must stay distinct).
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createEvidenceDir, loadWorkflow, saveWorkflow } from './workflow.mjs';
import { createTools } from './tools.mjs';
import { createCoachPlugin } from './opencode-plugin.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COACH_ROOT = path.resolve(__dirname, '..');
const SKILL_PATH = path.join(COACH_ROOT, 'skill', 'SKILL.md');
const REPO_ROOT = path.resolve(COACH_ROOT, '..', '..');

function parseArgs(argv) {
  const out = { cliOnly: false, tool: null, toolArgs: {}, resume: null, port: 4096 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cli-only') out.cliOnly = true;
    else if (a === '--tool') out.tool = argv[++i];
    else if (a === '--resume') out.resume = argv[++i];
    else if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--args') {
      out.toolArgs = JSON.parse(argv[++i] || '{}');
    } else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`recording-coach

  node src/index.mjs [--cli-only] [--resume <evidenceDir>]
  node src/index.mjs --tool <name> [--args '{"k":1}']
  node src/index.mjs --help

Skill: ${SKILL_PATH}
Control plane: process.env.JSGEN_BASE_URL || http://127.0.0.1:4097
OpenCode port: 4096 (default)
`);
}

async function ensureEvidence(args) {
  if (args.resume) {
    const evidenceDir = path.resolve(args.resume);
    if (!fs.existsSync(path.join(evidenceDir, 'workflow.json'))) {
      throw new Error(`no workflow.json in ${evidenceDir}`);
    }
    return { evidenceDir, workflowPath: path.join(evidenceDir, 'workflow.json') };
  }
  return createEvidenceDir(REPO_ROOT);
}

async function runSingleTool(evidenceDir, name, toolArgs) {
  const tools = createTools({ evidenceDir, baseUrl: process.env.JSGEN_BASE_URL });
  const result = await tools.call(name, toolArgs);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function runCliRepl(evidenceDir) {
  const tools = createTools({ evidenceDir, baseUrl: process.env.JSGEN_BASE_URL });
  console.log(`CLI fallback REPL — evidence: ${evidenceDir}`);
  console.log('Commands: /status  /tool <name> [jsonArgs]  /skill  /quit');
  console.log('Tools:', Object.keys(tools.handlers).join(', '));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));

  while (true) {
    const line = (await ask('coach> ')).trim();
    if (!line) continue;
    if (line === '/quit' || line === '/exit') break;
    if (line === '/status') {
      console.log(JSON.stringify(loadWorkflow(evidenceDir), null, 2));
      continue;
    }
    if (line === '/skill') {
      console.log(fs.readFileSync(SKILL_PATH, 'utf8').slice(0, 2000) + '\n…');
      continue;
    }
    if (line.startsWith('/tool ')) {
      const rest = line.slice(6).trim();
      const sp = rest.indexOf(' ');
      const name = sp < 0 ? rest : rest.slice(0, sp);
      let args = {};
      if (sp >= 0) {
        try {
          args = JSON.parse(rest.slice(sp + 1));
        } catch (e) {
          console.error('bad JSON args', e.message);
          continue;
        }
      }
      try {
        const r = await tools.call(name, args);
        console.log(JSON.stringify(r, null, 2));
      } catch (e) {
        console.error('ERROR', e.message);
      }
      continue;
    }
    console.log('unknown — use /tool|/status|/skill|/quit');
  }
  rl.close();
}

async function runOpenCode(evidenceDir, port) {
  let createOpencode;
  try {
    ({ createOpencode } = await import('@opencode-ai/sdk'));
  } catch (e) {
    console.warn('[@opencode-ai/sdk missing]', e.message);
    console.warn('Run: cd tools/recording-coach && npm install');
    console.warn('Falling back to --cli-only REPL');
    return runCliRepl(evidenceDir);
  }

  const { plugin, tools, hasPluginHelper } = await createCoachPlugin({
    evidenceDir,
    baseUrl: process.env.JSGEN_BASE_URL,
  });

  const skillText = fs.readFileSync(SKILL_PATH, 'utf8');
  process.env.RECORDING_COACH_EVIDENCE_DIR = evidenceDir;
  if (!process.env.JSGEN_BASE_URL) {
    process.env.JSGEN_BASE_URL = 'http://127.0.0.1:4097';
  }

  // Plugin entry lives under evidenceDir (not src/) so runtime files stay gitignored via tmp/
  const pluginPath = path.join(evidenceDir, 'opencode-plugin-entry.mjs');
  const pluginModUrl = path.join(COACH_ROOT, 'src', 'opencode-plugin.mjs').replace(/\\/g, '/');
  fs.writeFileSync(
    pluginPath,
    `import { createCoachPlugin } from 'file:///${pluginModUrl}';
const evidenceDir = process.env.RECORDING_COACH_EVIDENCE_DIR;
const { plugin } = await createCoachPlugin({
  evidenceDir,
  baseUrl: process.env.JSGEN_BASE_URL,
});
export default plugin;
`,
    'utf8',
  );

  console.log(`Starting OpenCode on port ${port}; control plane → ${process.env.JSGEN_BASE_URL}`);
  console.log(`evidenceDir=${evidenceDir}`);
  console.log(`plugin helper=${hasPluginHelper}`);

  let client;
  let server;
  try {
    ({ client, server } = await createOpencode({
      port,
      config: {
        plugin: [pluginPath],
      },
    }));
  } catch (e) {
    console.warn('[createOpencode failed]', e.message);
    console.warn('Falling back to CLI REPL (tools still work against 4097)');
    return runCliRepl(evidenceDir);
  }

  const session = await client.session.create({
    body: { title: `recording-coach ${path.basename(evidenceDir)}` },
  });
  const sessionId = session.data?.id ?? session.id;
  const w = loadWorkflow(evidenceDir);
  w.opencodeSessionId = sessionId;
  saveWorkflow(w);
  console.log(`OpenCode session: ${sessionId}`);

  await client.session.prompt({
    path: { id: sessionId },
    body: {
      noReply: true,
      parts: [
        {
          type: 'text',
          text:
            `# Recording Coach system context\n\n` +
            `You are the recording-coach orchestrator. Follow the skill below.\n` +
            `evidenceDir=${evidenceDir}\n` +
            `workflow phase starts at CollectInputs. Use coach tools to advance phases.\n` +
            `Control plane: ${process.env.JSGEN_BASE_URL}\n\n` +
            skillText,
        },
      ],
    },
  });

  console.log('Skill injected (noReply). Chat via OpenCode UI/API, or type lines here.');
  console.log('Local: /status /tool … /prompt <text> /quit');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));

  const injectWorkflow = async () => {
    const snap = loadWorkflow(evidenceDir);
    await client.session.prompt({
      path: { id: sessionId },
      body: {
        noReply: true,
        parts: [
          {
            type: 'text',
            text: `## workflow.json snapshot\n\`\`\`json\n${JSON.stringify(snap, null, 2)}\n\`\`\``,
          },
        ],
      },
    });
  };

  try {
    while (true) {
      const line = (await ask('coach> ')).trim();
      if (!line) continue;
      if (line === '/quit' || line === '/exit') break;
      if (line === '/status') {
        console.log(JSON.stringify(loadWorkflow(evidenceDir), null, 2));
        continue;
      }
      if (line.startsWith('/tool ')) {
        const rest = line.slice(6).trim();
        const sp = rest.indexOf(' ');
        const name = sp < 0 ? rest : rest.slice(0, sp);
        let args = {};
        if (sp >= 0) args = JSON.parse(rest.slice(sp + 1));
        try {
          console.log(JSON.stringify(await tools.call(name, args), null, 2));
        } catch (e) {
          console.error('ERROR', e.message);
        }
        continue;
      }
      if (line.startsWith('/prompt ') || !line.startsWith('/')) {
        const text = line.startsWith('/prompt ') ? line.slice(8) : line;
        await injectWorkflow();
        const result = await client.session.prompt({
          path: { id: sessionId },
          body: { parts: [{ type: 'text', text }] },
        });
        const parts = result?.data?.parts || result?.parts || [];
        for (const p of parts) {
          if (p.type === 'text' && p.text) console.log(p.text);
        }
        continue;
      }
      console.log('use /status /tool /prompt /quit');
    }
  } finally {
    rl.close();
    try {
      const cur = loadWorkflow(evidenceDir);
      if (cur.trajectoryId && (cur.phase === 'Recording' || cur.phase === 'Prepared')) {
        console.log('abort: best-effort detach…');
        await tools.call('detach_trajectory', {});
      }
      await client.session.abort?.({ path: { id: sessionId } });
    } catch (e) {
      console.warn('cleanup:', e.message);
    }
    try {
      await server?.close?.();
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  const { evidenceDir } = await ensureEvidence(args);
  console.log(`evidenceDir=${evidenceDir}`);

  if (args.tool) {
    await runSingleTool(evidenceDir, args.tool, args.toolArgs);
    return;
  }
  if (args.cliOnly) {
    await runCliRepl(evidenceDir);
    return;
  }
  await runOpenCode(evidenceDir, args.port);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
