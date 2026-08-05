/**
 * Smoke: system_ref_data / system_ref_entry CRUD by trajectory.
 *
 * Prerequisites:
 *   npx knex migrate:latest --knexfile config/knexfile.js
 *
 * Usage: node scripts/smoke/smoke-system-ref.mjs
 */
import { getDB } from '../../config/database.js';
import * as systemRefDao from '../../src/dao/system-ref-dao.js';

const db = getDB();
try {
  const [tables] = await db.raw("SHOW TABLES LIKE 'system_ref%'");
  if (!tables?.length) {
    throw new Error('system_ref tables missing — run migrate:latest');
  }
  console.log('tables ok:', tables.length);

  const traj = await db('trajectory').orderBy('id', 'desc').first();
  if (!traj) {
    console.log('No trajectory — skip CRUD smoke');
  } else {
    const tid = traj.id;
    console.log('smoke trajectoryId=', tid);
    const saved = await systemRefDao.replaceEntriesForTrajectory(tid, [
      { fieldKey: '客户名称', fieldValue: '测试参考公司' },
      { fieldKey: '证件号码', fieldValue: '91440101TEST' },
    ], { source: 'manual', verificationStatus: 'verified', description: 'smoke' });
    if (saved.length !== 2) throw new Error(`expected 2 entries, got ${saved.length}`);

    const listed = await systemRefDao.listEntriesByTrajectory(tid, {
      verificationStatus: 'verified',
    });
    if (listed.length !== 2) throw new Error(`verified filter expected 2, got ${listed.length}`);

    const headers = await systemRefDao.list({ trajectoryId: tid, pageSize: 5 });
    if (!headers.total) throw new Error('expected header row');

    await systemRefDao.removeByTrajectory(tid);
    const after = await systemRefDao.listEntriesByTrajectory(tid);
    if (after.length !== 0) throw new Error('expected empty after delete');
  }
  console.log('smoke-system-ref: OK');
} finally {
  await db.destroy();
}
