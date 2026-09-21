#!/usr/bin/env node
/**
 * Tier A instruction-following eval for recording-coach skill (OpenCode + LLM).
 * Fixture: tools/recording-coach/eval/fixtures/tier-a.v1.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOpencodeExe } from '../src/opencode-path.mjs';
import { startCoachOpencodeSession } from '../src/opencode-session.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COACH_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(COACH_ROOT, '..', '..');
const FIXTURE_PATH = path.join(COACH_ROOT, 'eval', 'fixtures', 'tier-a.v1.json');
const OUT_DIR = path.join(REPO_ROOT, 'tmp');

/**
 * True if `needle` appears as a positive claim (not only inside a denial).
 * Avoids false fails like 「不允许 curl」matching forbid「允许 curl」.
 * @param {string} text
 * @param {string} needle
 * @returns {boolean}
 */
export function positiveForbidHit(text, needle) {
  if (!needle) return false;
  let from = 0;
  while (from <= text.length) {
    const i = text.indexOf(needle, from);
    if (i < 0) return false;
    const before = text.slice(Math.max(0, i - 8), i);
    const denied =
      /不(允许|能|可|要|得|准)?$/.test(before) ||
      /禁止$/.test(before) ||
      /勿$/.test(before) ||
      /不得$/.test(before) ||
      /不可以$/.test(before) ||
      /别$/.test(before);
    if (!denied) return true;
    from = i + Math.max(needle.length, 1);
  }
  return false;
}

/**
 * @param {string} reply
 * @param {{ expectAny?: string[], forbidAny?: string[], expectRegex?: string | null }} caseDef
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function scoreTierACase(reply, caseDef) {
  const reasons = [];
  const text = reply || '';

  const expectAny = caseDef.expectAny ?? [];
  if (expectAny.length > 0) {
    const hit = expectAny.some((s) => text.includes(s));
    if (!hit) {
      reasons.push(`expectAny miss (need one of: ${expectAny.join(', ')})`);
    }
  }

  const forbidAny = caseDef.forbidAny ?? [];
  for (const s of forbidAny) {
    if (positiveForbidHit(text, s)) {
      reasons.push(`forbidAny hit: ${s}`);
    }
  }

  if (caseDef.expectRegex) {
    const re = new RegExp(caseDef.expectRegex, 'i');
    if (!re.test(text)) {
      reasons.push(`expectRegex miss: /${caseDef.expectRegex}/`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * @param {object} result
 * @returns {string}
 */
function extractReplyText(result) {
  const parts = result?.data?.parts || result?.parts || [];
  return parts
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text)
    .join('\n')
    .trim();
}

/**
 * @returns {string}
 */
function reportFilename() {
  const iso = new Date().toISOString().replace(/:/g, '-');
  return path.join(OUT_DIR, `recording-coach-skill-eval-A-${iso}.json`);
}

/**
 * @param {object} report
 * @returns {string}
 */
function writeReport(report) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const reportPath = reportFilename();
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  return reportPath;
}

async function main() {
  const wallStart = Date.now();

  if (!resolveOpencodeExe()) {
    console.error(
      'FAIL eval-tier-a: opencode.exe not found. Set OPENCODE_BIN or add opencode-ai/bin to PATH.',
    );
    process.exit(2);
  }

  let fixture;
  try {
    fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  } catch (e) {
    console.error(`FAIL eval-tier-a: cannot read fixture: ${e.message}`);
    process.exit(2);
  }

  const cases = fixture.cases ?? [];
  const caseResults = [];
  let session;

  try {
    session = await startCoachOpencodeSession();
    const { client, sessionId } = session;

    for (const caseDef of cases) {
      const caseStart = Date.now();
      let reply = '';
      let promptError = null;

      try {
        const result = await client.session.prompt({
          path: { id: sessionId },
          body: { parts: [{ type: 'text', text: caseDef.prompt }] },
        });
        reply = extractReplyText(result);
      } catch (e) {
        promptError = String(e.message || e);
      }

      const scored = promptError
        ? { ok: false, reasons: [`prompt error: ${promptError}`] }
        : scoreTierACase(reply, caseDef);

      const row = {
        id: caseDef.id,
        ok: scored.ok,
        reasons: scored.reasons,
        replyPreview: reply.slice(0, 800),
        wallMs: Date.now() - caseStart,
      };
      caseResults.push(row);
      console.log(`${caseDef.id} ${scored.ok ? 'PASS' : 'FAIL'}`);
    }
  } catch (e) {
    const reportPath = writeReport({
      at: new Date().toISOString(),
      evalVersion: fixture.evalVersion,
      ok: false,
      stage: 'bootstrap',
      error: String(e.message || e),
      wallMs: Date.now() - wallStart,
      cases: caseResults,
    });
    console.error(`FAIL eval-tier-a bootstrap: ${e.message || e}`);
    console.error(`report=${reportPath}`);
    process.exit(2);
  }

  const passCount = caseResults.filter((r) => r.ok).length;
  const total = cases.length;
  const allOk = passCount === total;

  const reportPath = writeReport({
    at: new Date().toISOString(),
    evalVersion: fixture.evalVersion,
    ok: allOk,
    passCount,
    total,
    wallMs: Date.now() - wallStart,
    evidenceDir: session?.evidenceDir,
    sessionId: session?.sessionId,
    cases: caseResults,
  });

  console.log(allOk ? `OK eval-tier-a ${passCount}/${total}` : `FAIL eval-tier-a ${passCount}/${total}`);
  console.log(`report=${reportPath}`);

  const exitCode = allOk ? 0 : 1;

  try {
    await session?.close?.();
  } catch {
    /* Windows UV close noise — report already written */
  }

  process.exit(exitCode);
}

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
