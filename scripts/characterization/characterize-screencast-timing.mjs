/**
 * Characterization: BiB screencast timing defaults (~30fps, resolution untouched).
 * Spec: docs/superpowers/specs/2026-08-11-bib-stream-fps-cap-design.md
 * 2026-09-05: default raised 11fps → 30fps (minForwardMs 90→33, everyNthFrame 2→1).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MIN_FORWARD_MS,
  DEFAULT_EVERY_NTH_FRAME,
  DEFAULT_STREAM_QUALITY,
  DEFAULT_STREAM_MAX_W,
  DEFAULT_STREAM_MAX_H,
  TARGET_FPS,
  resolveScreencastTiming,
  resolveScreencastStreamConfig,
  createAckPacer,
} from '../../src/cdp/screencast-timing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

assert.equal(TARGET_FPS, 30);
assert.equal(DEFAULT_MIN_FORWARD_MS, 33);
assert.equal(DEFAULT_EVERY_NTH_FRAME, 1);
assert.equal(DEFAULT_STREAM_QUALITY, 65);
assert.equal(DEFAULT_STREAM_MAX_W, 1920);
assert.equal(DEFAULT_STREAM_MAX_H, 1080);

const base = resolveScreencastTiming({});
assert.equal(base.minForwardMs, 33);
assert.equal(base.everyNthFrame, 1);

const fromEnv = resolveScreencastTiming({
  BIB_STREAM_MIN_FORWARD_MS: '120',
  BIB_STREAM_EVERY_NTH_FRAME: '3',
});
assert.equal(fromEnv.minForwardMs, 120);
assert.equal(fromEnv.everyNthFrame, 3);

const clampedLo = resolveScreencastTiming({
  BIB_STREAM_MIN_FORWARD_MS: '10',
  BIB_STREAM_EVERY_NTH_FRAME: '0',
});
assert.equal(clampedLo.minForwardMs, 25);
assert.equal(clampedLo.everyNthFrame, 1);

const clampedHi = resolveScreencastTiming({
  BIB_STREAM_MIN_FORWARD_MS: '9999',
  BIB_STREAM_EVERY_NTH_FRAME: '99',
});
assert.equal(clampedHi.minForwardMs, 500);
assert.equal(clampedHi.everyNthFrame, 5);

const bad = resolveScreencastTiming({
  BIB_STREAM_MIN_FORWARD_MS: 'nope',
  BIB_STREAM_EVERY_NTH_FRAME: '',
});
assert.equal(bad.minForwardMs, 33);
assert.equal(bad.everyNthFrame, 1);

// Stream config: defaults + env override + clamp
const cfgBase = resolveScreencastStreamConfig({});
assert.equal(cfgBase.quality, 65);
assert.equal(cfgBase.maxW, 1920);
assert.equal(cfgBase.maxH, 1080);
assert.equal(cfgBase.minForwardMs, 33);

const cfgEnv = resolveScreencastStreamConfig({
  BIB_STREAM_QUALITY: '55',
  BIB_STREAM_MAX_W: '1600',
  BIB_STREAM_MAX_H: '900',
});
assert.equal(cfgEnv.quality, 55);
assert.equal(cfgEnv.maxW, 1600);
assert.equal(cfgEnv.maxH, 900);

const cfgClamp = resolveScreencastStreamConfig({
  BIB_STREAM_QUALITY: '5',
  BIB_STREAM_MAX_W: '99',
  BIB_STREAM_MAX_H: '99999',
});
assert.equal(cfgClamp.quality, 40);
assert.equal(cfgClamp.maxW, 320);
assert.equal(cfgClamp.maxH, 4096);

// Ack pacer: coalesces to one ack per minForwardMs, acking the latest pending id
{
  const acked = [];
  const pacer = createAckPacer({ minForwardMs: 33, ack: (id) => acked.push(id) });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  pacer.schedule(1);
  pacer.schedule(2);
  pacer.schedule(3); // same window → coalesce, only latest pending survives
  await sleep(10);
  assert.deepEqual(acked, [3]); // first ack immediate, coalesced to latest id
  pacer.schedule(4); // within the same 33ms window → paced
  await sleep(10);
  assert.deepEqual(acked, [3]);
  await sleep(30);
  assert.deepEqual(acked, [3, 4]);
  pacer.cancel(); // stop-path: pending timer cleared; a fresh pacer is created on next start
  const pacer2 = createAckPacer({ minForwardMs: 33, ack: (id) => acked.push(id) });
  pacer2.schedule(10);
  pacer2.cancel();
  await sleep(40);
  assert.deepEqual(acked, [3, 4]); // cancel before fire → no ack
}

// Cue: both producers must call startScreencast with everyNthFrame from timing
const bib = fs.readFileSync(path.join(root, 'executor/bib-bridge.js'), 'utf8');
const screencast = fs.readFileSync(
  path.join(root, 'src/cdp/remote-bridge/screencast.js'),
  'utf8',
);
assert.match(bib, /resolveScreencastStreamConfig|createAckPacer|everyNthFrame/);
assert.match(screencast, /createAckPacer|everyNthFrame/);
// Must not hard-code the old 30fps forward interval as the live constant
assert.doesNotMatch(
  fs.readFileSync(path.join(root, 'src/cdp/remote-bridge/state.js'), 'utf8'),
  /export const MIN_FORWARD_MS = 33/,
);

console.log('characterize-screencast-timing: PASS');
