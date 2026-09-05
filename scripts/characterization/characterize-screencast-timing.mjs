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
  TARGET_FPS,
  resolveScreencastTiming,
} from '../../src/cdp/screencast-timing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

assert.equal(TARGET_FPS, 30);
assert.equal(DEFAULT_MIN_FORWARD_MS, 33);
assert.equal(DEFAULT_EVERY_NTH_FRAME, 1);

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

// Cue: both producers must call startScreencast with everyNthFrame from timing
const bib = fs.readFileSync(path.join(root, 'executor/bib-bridge.js'), 'utf8');
const screencast = fs.readFileSync(
  path.join(root, 'src/cdp/remote-bridge/screencast.js'),
  'utf8',
);
assert.match(bib, /resolveScreencastTiming|EVERY_NTH_FRAME|everyNthFrame/);
assert.match(screencast, /everyNthFrame/);
// Must not hard-code the old 30fps forward interval as the live constant
assert.doesNotMatch(
  fs.readFileSync(path.join(root, 'src/cdp/remote-bridge/state.js'), 'utf8'),
  /export const MIN_FORWARD_MS = 33/,
);

console.log('characterize-screencast-timing: PASS');
