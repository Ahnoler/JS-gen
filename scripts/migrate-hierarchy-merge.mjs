/**
 * One-shot: run hierarchy merge against the configured DB.
 * Usage: node scripts/migrate-hierarchy-merge.mjs
 */
import { getDB, closeDB } from '../config/database.js';
import { up } from '../migrations/20260716_merge_hierarchy_to_system.js';

const db = getDB();
try {
  await up(db);
  const rows = await db('system').select('id', 'system_id', 'type', 'parent_id', 'name').orderBy('id');
  console.log('system rows:', rows);
  const hasP = await db.schema.hasTable('process');
  const hasF = await db.schema.hasTable('function_def');
  console.log('process exists=', hasP, 'function_def exists=', hasF);
  const defFn = await db('system').where({ system_id: '00000000-0000-0000-0000-000000000003' }).first();
  console.log('default function node:', defFn?.id, defFn?.type, defFn?.parent_id);
} finally {
  await closeDB();
}
