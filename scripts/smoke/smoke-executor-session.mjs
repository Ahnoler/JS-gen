/**
 * E3 smoke: USE_EXECUTOR session open/close via HTTP + executor agent.
 * Usage: node scripts/smoke/smoke-executor-session.mjs
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOKEN = 'e3-smoke-token';
const PORT = 4100;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const server = spawn('node', ['server.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      EXECUTOR_TOKEN: TOKEN,
      USE_EXECUTOR: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let booted = false;
  server.stdout.on('data', (d) => {
    if (d.toString().includes('Agent API listening')) booted = true;
  });
  server.stderr.on('data', (d) => process.stderr.write(d));

  for (let i = 0; i < 60 && !booted; i++) await sleep(250);
  if (!booted) throw new Error('server failed to start');

  const agent = spawn('node', ['executor/agent.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      EXECUTOR_TOKEN: TOKEN,
      CONTROL_PLANE_URL: `http://127.0.0.1:${PORT}`,
      EXECUTOR_NAME: 'e3-smoke-worker',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  agent.stdout.on('data', (d) => process.stderr.write(d));
  agent.stderr.on('data', (d) => process.stderr.write(d));

  for (let i = 0; i < 40; i++) {
    const list = await fetch(`http://127.0.0.1:${PORT}/api/v2/executors`).then((r) => r.json());
    if (list.nodes?.some((n) => n.status === 'online')) break;
    await sleep(250);
  }

  const create = await fetch(`http://127.0.0.1:${PORT}/api/browser/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek/deepseek-v4-flash' }),
  });
  if (!create.ok) {
    const err = await create.text();
    throw new Error(`session create failed: ${create.status} ${err}`);
  }
  const { sessionId, executorNodeUuid } = await create.json();
  console.log('OK session created', sessionId, 'on', executorNodeUuid);

  await sleep(2000);

  const del = await fetch(`http://127.0.0.1:${PORT}/api/browser/session/${sessionId}`, { method: 'DELETE' });
  if (!del.ok) throw new Error('session delete failed');
  console.log('OK session closed');

  agent.kill('SIGINT');
  server.kill('SIGTERM');
  await sleep(500);
  console.log('ALL PASSED');
}

main().catch((err) => {
  console.error('FAILED', err);
  process.exit(1);
});
