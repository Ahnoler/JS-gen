/**
 * One-shot: emit scripts/actions/_locator_helpers_js.py from PAGE_LOCATOR_HELPERS.
 *   node scripts/_gen_locator_helpers_py.mjs
 */
import { writeFileSync } from 'node:fs';
import { PAGE_LOCATOR_HELPERS } from '../src/cdp/locator-candidates.js';

const body = String(PAGE_LOCATOR_HELPERS || '');
if (!body.includes('buildLocatorSnap')) {
  console.error('PAGE_LOCATOR_HELPERS missing buildLocatorSnap');
  process.exit(1);
}

const out = `# Auto-generated / keep in sync with src/cdp/locator-candidates.js PAGE_LOCATOR_HELPERS.
# Regenerate: node scripts/_gen_locator_helpers_py.mjs
# Used by scripts/actions/_js_snippets.py and scripts/manual_recorder/js.py.

PAGE_LOCATOR_HELPERS = r'''${body}'''
`;

writeFileSync(new URL('./actions/_locator_helpers_js.py', import.meta.url), out, 'utf8');
console.log(`ok: wrote _locator_helpers_js.py (${body.length} helper chars)`);
