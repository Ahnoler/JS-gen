/**
 * Add trajectory.persistent_record_status: 录制前的持久状态基线。
 *
 * 规则：record_status 是持久状态(draft/failed/recorded/completed)时，基线=当前状态；
 * 处于临时 recording 的旧行，基线回填为 draft（保留旧有「录音→draft」语义，可由后续录制重建）。
 */
export async function up(knex) {
  const has = await knex.schema.hasColumn('trajectory', 'persistent_record_status');
  if (has) return;

  await knex.raw(`
    ALTER TABLE trajectory ADD COLUMN persistent_record_status
      ENUM('draft','failed','recorded','completed') NOT NULL DEFAULT 'draft'
      COMMENT '录制前的持久状态基线（不包含 recording）；进入录制中时记录，录制结束时据此恢复，保证临时录制不降级持久状态'
  `);

  await knex.raw(`
    UPDATE trajectory
    SET persistent_record_status = record_status
    WHERE record_status IN ('draft','failed','recorded','completed')
  `);
}

export async function down(knex) {
  const has = await knex.schema.hasColumn('trajectory', 'persistent_record_status');
  if (!has) return;
  await knex.raw('ALTER TABLE trajectory DROP COLUMN persistent_record_status');
}
