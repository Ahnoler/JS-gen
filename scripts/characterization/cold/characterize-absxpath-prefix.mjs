/**
 * Characterization: absXPath emits the standard /html root prefix so that
 * page-internal document.evaluate (no Playwright prefix fixup) resolves
 * xpath_full absolute paths.
 *
 * Asserts:
 *   1. PAGE_LOCATOR_HELPERS absXPath loops to document.documentElement (not
 *      document.body) and returns '/html' + parts — so the product is
 *      /html/body/div[1]/... rather than /div[1]/... .
 *   2. enrich.py resolveByXpath delegates to resolveXpathAny, whose
 *      normalization fallback tries the raw expression, a '//' relative form,
 *      and a '/html' absolute form — so legacy /div[1]/... data still resolves.
 *
 * Pure string/regex assertions — no browser launch.
 *
 *   node scripts/characterization/characterize-absxpath-prefix.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PAGE_LOCATOR_HELPERS } from '../../src/cdp/locator-candidates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function ok(name) {
  console.log(`ok: ${name}`);
}

// 1. absXPath loops to document.documentElement (includes body) and prefixes /html.
{
  assert.ok(
    PAGE_LOCATOR_HELPERS.includes('cur !== document.documentElement'),
    'absXPath must loop while cur !== document.documentElement (include body, stop at root)',
  );
  assert.ok(
    /return\s+'\/html'\s*\+/.test(PAGE_LOCATOR_HELPERS),
    "absXPath must return '/html' + parts so the product starts with /html",
  );
  // No longer terminates at document.body (the old bug).
  assert.ok(
    !/cur !== document\.body/.test(PAGE_LOCATOR_HELPERS),
    'absXPath must NOT terminate at document.body (old rootless bug)',
  );
  ok('absXPath emits /html root prefix via document.documentElement loop');
}

// 2. absXPath product form: /html/body/... — verify the id short-circuit branch
//    is unchanged (still '//*[@id=...]').
{
  assert.ok(
    PAGE_LOCATOR_HELPERS.includes("//*[@id=\"") || PAGE_LOCATOR_HELPERS.includes('/*@id='),
    'absXPath id short-circuit branch must remain //*[@id=...]',
  );
  assert.ok(
    !PAGE_LOCATOR_HELPERS.includes('isGeneratedId(node.id)) return /'),
    'absXPath id short-circuit must not return a bare / absolute path',
  );
  ok('absXPath id short-circuit unchanged');
}

// 3. enrich.py resolveByXpath → resolveXpathAny normalization fallback.
{
  const enrichPath = join(__dirname, '..', 'controller', 'actions', 'js_snippets', 'enrich.py');
  const src = readFileSync(enrichPath, 'utf8');

  assert.ok(
    src.includes('function resolveXpathAny'),
    'enrich.py must define resolveXpathAny normalization helper',
  );
  assert.ok(
    /resolveByXpath\s*\([^)]*\)\s*\{[\s\S]*?return\s+resolveXpathAny/.test(src),
    'resolveByXpath must delegate to resolveXpathAny',
  );
  // The fallback tries '//' relative form (candidate push '/'+s) and '/html' absolute.
  assert.ok(
    src.includes("candidates.push('/' + s)"),
    "resolveXpathAny must push '/' + s (// relative fallback) for /div[1]/... input",
  );
  assert.ok(
    src.includes("candidates.push('/html' + s)"),
    "resolveXpathAny must push '/html' + s (/html absolute fallback) for /div[1]/... input",
  );
  // Guard condition: only normalizes when s starts with '/' but not '//' or '/html'.
  assert.ok(
    src.includes("s.charAt(0) === '/'") && src.includes("s.charAt(1) !== '/'"),
    "resolveXpathAny normalization guard must check s[0]=='/' and s[1]!='//'",
  );
  assert.ok(
    src.includes("s.indexOf('/html') !== 0"),
    "resolveXpathAny normalization guard must skip already-/html paths",
  );
  ok('enrich.py resolveByXpath normalizes /div[1]/... via // and /html fallbacks');
}

// 4. The generated Python mirror (_locator_helpers_js.py) carries the same fix.
{
  const mirrorPath = join(__dirname, '..', 'controller', 'actions', 'js_snippets', '_locator_helpers_js.py');
  const mirror = readFileSync(mirrorPath, 'utf8');
  assert.ok(
    mirror.includes('cur !== document.documentElement'),
    '_locator_helpers_js.py mirror must contain document.documentElement loop',
  );
  assert.ok(
    /return\s+'\/html'\s*\+/.test(mirror),
    '_locator_helpers_js.py mirror must return /html + parts',
  );
  ok('Python mirror _locator_helpers_js.py carries /html root prefix');
}

console.log('\nall characterize-absxpath-prefix assertions passed');
