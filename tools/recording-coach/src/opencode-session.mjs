import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEvidenceDir, loadWorkflow, saveWorkflow } from './workflow.mjs';
import { ensureOpencodeOnPath } from './opencode-path.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COACH_ROOT = path.resolve(__dirname, '..');
const SKILL_PATH = path.join(COACH_ROOT, 'skill', 'SKILL.md');
const DEFAULT_REPO_ROOT = path.resolve(COACH_ROOT, '..', '..');

/**
 * Bootstrap OpenCode with recording-coach plugin + SKILL injection (noReply).
 * @param {{ port?: number, repoRoot?: string }} [opts]
 * @returns {Promise<{ evidenceDir: string, client: object, server: object, sessionId: string, skillText: string, close: () => Promise<void> }>}
 */
export async function startCoachOpencodeSession(opts = {}) {
  const port = opts.port ?? 4096;
  const repoRoot = opts.repoRoot ?? DEFAULT_REPO_ROOT;

  ensureOpencodeOnPath();

  if (!process.env.JSGEN_BASE_URL) {
    process.env.JSGEN_BASE_URL = 'http://127.0.0.1:4097';
  }

  let createOpencode;
  try {
    ({ createOpencode } = await import('@opencode-ai/sdk'));
  } catch (e) {
    throw new Error(`@opencode-ai/sdk not available: ${e.message}`);
  }

  const { evidenceDir } = createEvidenceDir(repoRoot);
  process.env.RECORDING_COACH_EVIDENCE_DIR = evidenceDir;

  const skillText = fs.readFileSync(SKILL_PATH, 'utf8');

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

  const { client, server } = await createOpencode({
    port,
    config: { plugin: [pluginPath] },
  });

  const session = await client.session.create({
    body: { title: `recording-coach ${path.basename(evidenceDir)}` },
  });
  const sessionId = session.data?.id ?? session.id;
  const w = loadWorkflow(evidenceDir);
  w.opencodeSessionId = sessionId;
  saveWorkflow(w);

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

  const close = async () => {
    try {
      if (client && sessionId) await client.session.abort?.({ path: { id: sessionId } });
    } catch {
      /* ignore */
    }
    try {
      await server?.close?.();
    } catch {
      /* ignore */
    }
  };

  return { evidenceDir, client, server, sessionId, skillText, close };
}
