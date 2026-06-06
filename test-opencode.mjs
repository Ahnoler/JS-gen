import { createOpencodeServer } from '@opencode-ai/sdk/v2/server';
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'opencode.json'), 'utf-8'));
console.log('[test] Config providers:', Object.keys(cfg.provider));
console.log('[test] Provider config:', JSON.stringify(cfg.provider.myprovider, null, 2));

const server = await createOpencodeServer({
  hostname: '127.0.0.1',
  port: 0,
  timeout: 15000,
  config: cfg,
});
console.log('[test] Server URL:', server.url);

const client = createOpencodeClient({
  baseUrl: server.url,
  directory: __dirname,
});

console.log('[test] Testing /agent endpoint...');
const agentsResult = await client.app.agents().catch(err => ({ error: err.toString() }));
console.log('[test] Agents:', agentsResult.error ? 'ERROR: ' + agentsResult.error : JSON.stringify(agentsResult.data?.map(a => a.name)));

console.log('[test] Testing /config/providers endpoint...');
const providersResult = await client.config.providers().catch(err => ({ error: err.toString() }));
console.log('[test] Providers:', providersResult.error ? 'ERROR: ' + providersResult.error : JSON.stringify(providersResult.data));

server.close();
process.exit(0);
