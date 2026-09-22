import { readFileSync } from 'fs';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const server = readFileSync('server.mjs', 'utf8');
assert(server.includes("app.get('/ops'"), 'GET /ops missing');
assert(server.includes('ops-console/index.html') || server.includes("ops-console', 'index.html'"), 'sendFile target');

const html = readFileSync('src/dashboard/ops-console/index.html', 'utf8');
assert(html.includes('id="ops-tab-exec"') && html.includes('id="ops-tab-shots"'), 'tabs');
assert(html.includes('ops.css') && html.includes('app.js'), 'assets');

const docs = readFileSync('api-docs.html', 'utf8');
assert(docs.includes('href="/ops"'), 'docs link');

console.log('characterize-ops-page: OK');
