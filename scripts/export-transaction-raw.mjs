/**
 * Joint-debug helper: write bare partner envelope for importDemand.
 * Usage:
 *   node scripts/export-transaction-raw.mjs --id 109 --systemId 98 --projectId 31 [--out path.json]
 */
import fs from 'fs';
import path from 'path';
import * as trajectoryDao from '../src/dao/trajectory-dao.js';
import { buildTransactionPayload } from '../src/services/transaction-export.js';

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  return process.argv[i + 1] ?? def;
}

const id = Number(arg('id'));
const systemId = arg('systemId');
const projectId = arg('projectId');
const out = arg('out', path.resolve(`scripts/action/import_traj_${id || 'x'}.json`));

if (!Number.isFinite(id) || id <= 0 || !systemId || !projectId) {
  console.error('Usage: node scripts/export-transaction-raw.mjs --id <trajId> --systemId <id> --projectId <id> [--out file.json]');
  process.exit(1);
}

const traj = await trajectoryDao.getById(id);
if (!traj) {
  console.error(`Trajectory not found: ${id}`);
  process.exit(1);
}

const { payload, count, skipped, stats } = buildTransactionPayload(traj, { systemId, projectId });
await trajectoryDao.markExported(id);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
const entry = payload.transcationEventTypeList?.[0] || {};
console.log(JSON.stringify({
  ok: true,
  out,
  trajectoryId: id,
  isExport: 1,
  count,
  skipped,
  stats,
  systemId: entry.systemId,
  projectId: entry.projectId,
  transcId: entry.transcId,
  listLen: payload.transcationEventTypeList?.length ?? 0,
}, null, 2));
process.exit(0);
