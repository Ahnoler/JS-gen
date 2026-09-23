import { readFileSync } from 'fs';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const server = readFileSync('server.mjs', 'utf8');
assert(server.includes("app.get('/ops'"), 'GET /ops missing');
assert(server.includes('ops-console/index.html') || server.includes("ops-console', 'index.html'"), 'sendFile target');

const html = readFileSync('src/dashboard/ops-console/index.html', 'utf8');
assert(html.includes('id="ops-tab-exec"') && html.includes('id="ops-tab-shots"'), 'tabs');
assert(html.includes('id="ops-tab-history"'), 'history tab');
assert(html.includes('ops.css') && html.includes('app.js'), 'assets');

const docs = readFileSync('api-docs.html', 'utf8');
assert(docs.includes('href="/ops"'), 'docs link');

const app = readFileSync('src/dashboard/ops-console/app.js', 'utf8');
assert(app.includes('mountExecutorPanel'), 'executor mount');
const cards = readFileSync('src/dashboard/ops-console/log-cards.js', 'utf8');
assert(cards.includes('export function renderLogCards'), 'renderLogCards');
const css = readFileSync('src/dashboard/ops-console/ops.css', 'utf8');
assert(css.includes('.ops-modal') && css.includes('.ops-card-fail'), 'modal and fail color');

const appShots = readFileSync('src/dashboard/ops-console/app.js', 'utf8');
assert(appShots.includes('mountScreenshotsPanel'), 'screenshots mount');
const shots = readFileSync('src/dashboard/ops-console/screenshots-panel.js', 'utf8');
assert(shots.includes('/api/v2/screenshots/pending'), 'pending list');
assert(shots.includes('/pending/upload'), 'upload all');
assert(shots.includes("method: 'DELETE'"), 'delete');

const docsApp = readFileSync('src/dashboard/api-docs/app.js', 'utf8');
assert(!docsApp.includes('slot-monitor.js') && !docsApp.includes('pending-screenshots.js'), 'docs still imports boards');
const catalog = readFileSync('src/dashboard/api-docs/catalog.js', 'utf8');
assert(!catalog.includes('...GROUP_SLOT_MONITOR') && !catalog.includes('...GROUP_PENDING_SCREENSHOTS'), 'catalog still lists boards');
const verify = readFileSync('scripts/refactor/verify-all.sh', 'utf8');
assert(verify.includes('characterize-ops-log-cards'), 'log pin not registered');
assert(verify.includes('characterize-ops-step-line'), 'step pin not registered');
assert(verify.includes('characterize-ops-card-line'), 'card pin not registered');
assert(verify.includes('characterize-ops-page'), 'page pin not registered');

console.log('characterize-ops-page: OK');
