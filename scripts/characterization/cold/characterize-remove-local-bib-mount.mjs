#!/usr/bin/env node
/**
 * Cold pin: local BiB mount removed (no ensureGlobalBrowser, no attachLive CDP connect).
 * Complements characterize-executor-only-bib.mjs (503 gates); this pin targets dead mount code.
 *
 *   node scripts/characterization/cold/characterize-remove-local-bib-mount.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/** @param {string} dir @returns {string[]} */
function listJsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listJsFiles(full));
    else if (name.endsWith('.js') || name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

/** @param {string} src @param {string} fnName @returns {string} */
function sliceFunctionBody(src, fnName) {
  const needle = `export async function ${fnName}`;
  const idx = src.indexOf(needle);
  assert.ok(idx >= 0, `${fnName} must be exported from remote-bridge/index.js`);
  const paramOpen = src.indexOf('(', idx);
  assert.ok(paramOpen >= 0, `${fnName} param list not found`);
  let depth = 0;
  let paramClose = -1;
  for (let i = paramOpen; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        paramClose = i;
        break;
      }
    }
  }
  assert.ok(paramClose >= 0, `${fnName} param list close not found`);
  const braceStart = src.indexOf('{', paramClose);
  assert.ok(braceStart >= 0, `${fnName} body not found`);
  depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(braceStart, i + 1);
    }
  }
  throw new Error(`${fnName} body brace mismatch`);
}

function main() {
  const srcRoot = join(ROOT, 'src');
  for (const file of listJsFiles(srcRoot)) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
    const content = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      content,
      /export async function ensureGlobalBrowser\b/,
      `${rel} must not export ensureGlobalBrowser`,
    );
    assert.doesNotMatch(
      content,
      /(?<!export async )function ensureGlobalBrowser\b/,
      `${rel} must not define ensureGlobalBrowser`,
    );
  }

  const bridge = read('src/cdp/remote-bridge/index.js');
  const attachBody = sliceFunctionBody(bridge, 'attachLive');
  const throwOnly = attachBody.includes('local BiB mount removed');
  if (!throwOnly) {
    assert.doesNotMatch(
      attachBody,
      /refreshCdpEndpoints\s*\(\s*\)/,
      'attachLive must not call refreshCdpEndpoints for local mount',
    );
    assert.doesNotMatch(
      attachBody,
      /connect\s*\(\s*gb\.cdpWsUrl\s*\)/,
      'attachLive must not connect(gb.cdpWsUrl) for local mount',
    );
    assert.doesNotMatch(
      attachBody,
      /gb\.cdpWsUrl/,
      'attachLive must not reference gb.cdpWsUrl for local mount',
    );
    assert.doesNotMatch(
      attachBody,
      /new CdpClient\s*\(\s*\)/,
      'attachLive must not construct CdpClient for local mount',
    );
  }

  const phaseHighlight = read('src/services/trajectory/phase-highlight-screenshot.js');
  assert.doesNotMatch(
    phaseHighlight,
    /getAttachedCdpClient/,
    'phase-highlight-screenshot must not import or call getAttachedCdpClient',
  );

  console.log('characterize-remove-local-bib-mount: OK');
}

main();
