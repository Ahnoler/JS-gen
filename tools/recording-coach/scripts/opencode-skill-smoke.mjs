#!/usr/bin/env node
/**
 * One-shot OpenCode skill-injection smoke (A1 only).
 * Full Tier A suite: node tools/recording-coach/scripts/eval-tier-a.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOpencodeExe } from '../src/opencode-path.mjs';
import { startCoachOpencodeSession } from '../src/opencode-session.mjs';
import { scoreTierACase } from './eval-tier-a.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COACH_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(COACH_ROOT, '..', '..');
const OUT_DIR = path.join(REPO_ROOT, 'tmp');
const REPORT = path.join(OUT_DIR, 'opencode-skill-smoke-report.json');
const FIXTURE_PATH = path.join(COACH_ROOT, 'eval', 'fixtures', 'tier-a.v1.json');

const PROMPT =
  '当前 workflow 阶段是 CollectInputs。严格按已注入的 recording-coach skill 铁律：' +
  '下一步应调用的**第一个**工具名是什么？' +
  '只输出一个工具名（英文标识符），不要调用任何工具，不要开录，不要解释。';

async function main() {
  if (!resolveOpencodeExe()) {
    writeReport({ ok: false, stage: 'opencode-missing', error: 'opencode.exe not found' });
    console.error('FAIL opencode-skill-smoke: opencode.exe not found');
    process.exit(2);
  }

  let caseDef = {
    expectAny: ['save_dispatch_brief'],
    forbidAny: ['start_record'],
    expectRegex: null,
  };
  try {
    const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
    const a1 = fixture.cases?.find((c) => c.id === 'A1');
    if (a1) caseDef = a1;
  } catch {
    /* fallback to inline expectations */
  }

  let session;
  try {
    session = await startCoachOpencodeSession();
    const result = await session.client.session.prompt({
      path: { id: session.sessionId },
      body: { parts: [{ type: 'text', text: PROMPT }] },
    });

    const parts = result?.data?.parts || result?.parts || [];
    const joined = parts
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text)
      .join('\n')
      .trim();

    const scored = scoreTierACase(joined, caseDef);
    const toolMatch = joined.match(/\b(save_dispatch_brief|mark_inputs_ready|preflight_readonly|analyze_trajectory)\b/);

    writeReport({
      ok: scored.ok,
      stage: 'prompt',
      evidenceDir: session.evidenceDir,
      sessionId: session.sessionId,
      expected: 'save_dispatch_brief',
      observedTool: toolMatch?.[1] || null,
      replyPreview: joined.slice(0, 800),
      reasons: scored.reasons,
      skillBytes: session.skillText.length,
    });

    console.log(scored.ok ? 'OK opencode-skill-smoke' : 'FAIL opencode-skill-smoke');
    console.log(`expected=save_dispatch_brief observed=${toolMatch?.[1] || '(none)'}`);
    console.log(`report=${REPORT}`);

    const exitCode = scored.ok ? 0 : 1;
    try {
      await session.close();
    } catch {
      /* ignore */
    }
    process.exit(exitCode);
  } catch (e) {
    writeReport({
      ok: false,
      stage: 'session',
      evidenceDir: session?.evidenceDir,
      sessionId: session?.sessionId,
      error: String(e.message || e),
      stack: String(e.stack || '').slice(0, 1500),
    });
    console.error('FAIL', e.message || e);
    try {
      await session?.close?.();
    } catch {
      /* ignore */
    }
    process.exit(4);
  }
}

function writeReport(obj) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify({ at: new Date().toISOString(), ...obj }, null, 2), 'utf8');
}

main();
