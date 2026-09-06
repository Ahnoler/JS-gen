/**
 * trajectory.record_status v2：draft=未录制 / recording=录制中 / failed=录制异常 / recorded=待确认 / completed=已确认。
 * live（推流占用）并入 recording；down 有损（failed→draft，recording 无法拆回 live/recording）。
 */
export async function up(knex) {
  await knex.raw(`
    UPDATE trajectory SET record_status = 'recording' WHERE record_status = 'live'
  `);
  await knex.raw(`
    ALTER TABLE trajectory MODIFY COLUMN record_status
      ENUM('draft','recording','failed','recorded','completed') NOT NULL DEFAULT 'draft'
      COMMENT 'draft=未录制; recording=录制中; failed=录制异常; recorded=待确认; completed=已确认'
  `);
}

export async function down(knex) {
  await knex.raw(`
    UPDATE trajectory SET record_status = 'draft' WHERE record_status = 'failed'
  `);
  await knex.raw(`
    ALTER TABLE trajectory MODIFY COLUMN record_status
      ENUM('draft','live','recording','recorded','completed') NOT NULL DEFAULT 'draft'
      COMMENT 'draft=空闲; live=推流占用; recording=AI录制中; recorded=录制完成; completed=人工确认'
  `);
}
