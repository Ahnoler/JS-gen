#!/usr/bin/env node
/**
 * Cold pin: BiB/session CDP requires USE_EXECUTOR (no control-plane local fallback).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function main() {
  const config = read('config/config.js');
  assert.match(
    config,
    /USE_EXECUTOR\s*=\s*_resolve\(\s*['"]USE_EXECUTOR['"]\s*,\s*['"]true['"]\s*\)/,
    'USE_EXECUTOR default must be true',
  );

  const lifecycle = read('src/services/trajectory/trajectory-record-lifecycle.js');
  assert.match(lifecycle, /resolveTrajectoryElement/, 'resolveTrajectoryElement present');
  assert.match(
    lifecycle,
    /USE_EXECUTOR[\s\S]{0,200}503|503[\s\S]{0,200}USE_EXECUTOR/,
    'resolveTrajectoryElement must 503 when USE_EXECUTOR is false',
  );
  assert.doesNotMatch(
    lifecycle,
    /remoteBridge\.resolveElementByLabelText/,
    'local remoteBridge.resolveElementByLabelText fallback must be removed',
  );
  assert.doesNotMatch(
    lifecycle,
    /import \* as remoteBridge/,
    'trajectory-record-lifecycle must not import remote-bridge for local resolve',
  );

  const attach = read('src/services/trajectory/trajectory-attach-runner.js');
  assert.match(
    attach,
    /!USE_EXECUTOR[\s\S]{0,300}503|503[\s\S]{0,300}!USE_EXECUTOR/,
    'attach/prepare must 503 when USE_EXECUTOR is false',
  );
  assert.doesNotMatch(
    attach,
    /Local \(non-executor\) mode only supports one live trajectory/,
    'local single-live attach branch must be gone',
  );

  const remote = read('src/services/remote-session-service.js');
  for (const fn of ['attachLive', 'detachLive', 'getLiveStatus']) {
    const idx = remote.indexOf(`export async function ${fn}`);
    assert.ok(idx >= 0, `${fn} exported`);
    const slice = remote.slice(idx, idx + 500);
    assert.match(slice, /USE_EXECUTOR/, `${fn} checks USE_EXECUTOR`);
    assert.match(slice, /503/, `${fn} uses 503 when executor required`);
    assert.doesNotMatch(
      slice,
      /bridge\.attachLive|bridge\.detachLive|bridge\.getRemoteStatus/,
      `${fn} must not delegate to local remote-bridge`,
    );
  }

  const register = read('src/routes/browser-session/register.js');
  const sessionPost = register.split("app.post('/api/browser/session'")[1]?.slice(0, 2500) || '';
  assert.match(sessionPost, /USE_EXECUTOR/, 'POST /api/browser/session checks USE_EXECUTOR');
  assert.match(sessionPost, /503/, 'POST /api/browser/session 503 without executor');
  assert.doesNotMatch(
    sessionPost,
    /ensureGlobalBrowser/,
    'POST /api/browser/session must not call ensureGlobalBrowser',
  );

  const envEx = read('config/.env.example');
  assert.match(envEx, /USE_EXECUTOR\s*=\s*true/, '.env.example keeps USE_EXECUTOR=true');
  assert.match(
    envEx,
    /不再支持|不支持|required|必须/i,
    '.env.example documents that false is unsupported',
  );

  console.log('characterize-executor-only-bib: OK');
}

main();
