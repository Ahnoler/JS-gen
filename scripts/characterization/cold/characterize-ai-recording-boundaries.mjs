#!/usr/bin/env node
/** Cold pins for AI recording event ownership and non-business observations. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const runner = fs.readFileSync(path.join(root, 'src/services/trajectory/trajectory-recording-runner.js'), 'utf8');
const meta = fs.readFileSync(path.join(root, 'src/models/meta-step-actions.js'), 'utf8');
const state = fs.readFileSync(path.join(root, 'scripts/state.py'), 'utf8');
const action = fs.readFileSync(path.join(root, 'scripts/models/action.py'), 'utf8');

assert.match(meta, /ENGINEERING_STEP_ACTIONS[\s\S]*read_business_date/);
assert.match(state, /'read_business_date'/);
assert.match(action, /"read_business_date",/);
assert.match(runner, /type === 'phase_state_key'/);
assert.match(runner, /phase_state_key_ignored_/);
assert.match(runner, /phaseNumber: statePayload\?\.phase \?\? statePayload\?\.phaseNumber \?\? null/);
console.log('characterize-ai-recording-boundaries: OK');
