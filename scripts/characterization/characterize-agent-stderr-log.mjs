/**
 * Characterization: multi-slot agent stderr prefix + filter helpers.
 * Spec: docs/superpowers/specs/2026-08-11-multi-slot-stderr-isolation-design.md
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shortSid, prefixLine, createStderrLineBuffer } from '../../executor/stderr-prefix.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function testShortSid() {
  assert.equal(shortSid('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), 'a1b2c3d4');
  assert.equal(shortSid('ABCDEF12-....'), 'abcdef12'.slice(0, 8)); // lowercased stripped
}

function testPrefixLine() {
  const line = prefixLine(1, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'hello');
  assert.equal(line, '[slot:1 sid:a1b2c3d4] hello');
}

function testLineBufferSplitsAndPrefixes() {
  const flushed = [];
  const buf = createStderrLineBuffer({
    slotIndex: 0,
    sessionId: 'a1b2c3d4-0000-0000-0000-000000000001',
    flushMs: 10_000,
    maxLines: 50,
    onFlush: (lines) => flushed.push(...lines),
  });
  buf.push('line1\nline2\npartial');
  buf.flush();
  assert.deepEqual(flushed, [
    '[slot:0 sid:a1b2c3d4] line1',
    '[slot:0 sid:a1b2c3d4] line2',
  ]);
  buf.push('tail\n');
  buf.flush();
  assert.equal(flushed[2], '[slot:0 sid:a1b2c3d4] partialtail');
  buf.dispose();
}

function testMaxLinesFlush() {
  const batches = [];
  const buf = createStderrLineBuffer({
    slotIndex: 2,
    sessionId: 'deadbeef-0000-0000-0000-000000000002',
    flushMs: 60_000,
    maxLines: 3,
    onFlush: (lines) => batches.push(lines),
  });
  buf.push('a\nb\nc\n');
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 3);
  buf.dispose();
}

function testFlushEndDrainsPending() {
  const flushed = [];
  const buf = createStderrLineBuffer({
    slotIndex: 0,
    sessionId: 'a1b2c3d4-0000-0000-0000-000000000001',
    flushMs: 10_000,
    onFlush: (lines) => flushed.push(...lines),
  });
  buf.push('no newline yet');
  buf.flush();
  assert.deepEqual(flushed, []);
  buf.flush({ end: true });
  assert.deepEqual(flushed, ['[slot:0 sid:a1b2c3d4] no newline yet']);
  buf.dispose();
}

function testEmptyLinesPreserved() {
  const sessionId = 'a1b2c3d4-0000-0000-0000-000000000001';
  const flushed = [];
  const buf = createStderrLineBuffer({
    slotIndex: 0,
    sessionId,
    flushMs: 10_000,
    maxLines: 50,
    onFlush: (lines) => flushed.push(...lines),
  });
  buf.push('a\n\nb\n');
  buf.flush();
  assert.equal(flushed.length, 3);
  assert.equal(flushed[0], prefixLine(0, sessionId, 'a'));
  assert.equal(flushed[1], prefixLine(0, sessionId, ''));
  assert.ok(flushed[1].endsWith('] '));
  assert.equal(flushed[2], prefixLine(0, sessionId, 'b'));
  buf.dispose();
}

async function main() {
  testShortSid();
  testPrefixLine();
  testLineBufferSplitsAndPrefixes();
  testMaxLinesFlush();
  testFlushEndDrainsPending();
  testEmptyLinesPreserved();

  // Service tests imported only if module exists (Task 2+); skip soft if missing for Task 1 alone.
  const svcPath = path.join(ROOT, 'src/services/agent-stderr-log-service.js');
  if (fs.existsSync(svcPath)) {
    const {
      filterLines,
      appendLines,
      resolveLogDir,
      listLogFilesMatching,
      clearSessionLog,
      logPathForSession,
      stripLinePrefix,
      stripLinePrefixes,
    } = await import('../../src/services/agent-stderr-log-service.js');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-stderr-'));
    process.env.AGENT_STDERR_LOG_DIR = dir;
    try {
      const sessionId = 'sess-aaaa-bbbb-cccc-ddddeeee0001';
      appendLines(sessionId, [
        '[slot:0 sid:sessaaaa] A',
        '[slot:1 sid:other000] B',
        '[slot:0 sid:sessaaaa] C',
      ]);
      const all = filterLines({
        sessionId,
        slot: 0,
      });
      assert.deepEqual(all, [
        '[slot:0 sid:sessaaaa] A',
        '[slot:0 sid:sessaaaa] C',
      ]);
      assert.equal(stripLinePrefix('[slot:0 sid:4588fafc] hello'), 'hello');
      assert.deepEqual(stripLinePrefixes(all), ['A', 'C']);
      const bySid = filterLines({ sid: 'sessaaaa' });
      assert.ok(bySid.every((l) => l.includes('sid:sessaaaa')));
      assert.ok(listLogFilesMatching({ slot: 0 }).length >= 1);
      assert.ok(resolveLogDir().includes(dir) || resolveLogDir() === dir);

      const cleared = clearSessionLog(sessionId);
      assert.equal(cleared.cleared, true);
      assert.equal(cleared.sessionId, sessionId);
      assert.equal(fs.existsSync(logPathForSession(sessionId)), false);
      const clearedAgain = clearSessionLog(sessionId);
      assert.equal(clearedAgain.cleared, false);
    } finally {
      delete process.env.AGENT_STDERR_LOG_DIR;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log('PASS characterize-agent-stderr-log');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
