/**
 * Add trajectory failure-reason columns: failed_kind / failed_reason / failed_at.
 *
 * Failed_kind is the machine code, failed_reason is the user-facing category
 * text shown on the frontend (AI toast + list "录制异常" tooltip). Detailed
 * causes remain in backend logs only. Existing rows keep NULL (no backfill;
 * the UI simply shows no tooltip when absent).
 */
export async function up(knex) {
  const hasKind = await knex.schema.hasColumn('trajectory', 'failed_kind');
  if (!hasKind) {
    await knex.raw(`
      ALTER TABLE trajectory ADD COLUMN failed_kind VARCHAR(48) NULL
        COMMENT '录制失败机器码（llm_* / phase_failed / quality_failed / zero_step / runner_error / user_marked_failed / batch_failed）；NULL=无失败记录'
    `);
  }
  const hasReason = await knex.schema.hasColumn('trajectory', 'failed_reason');
  if (!hasReason) {
    await knex.raw(`
      ALTER TABLE trajectory ADD COLUMN failed_reason VARCHAR(255) NULL
        COMMENT '录制失败的用户可见类别文案（与前端 toast/列表悬浮一致）；详细原因仅在日志'
    `);
  }
  const hasAt = await knex.schema.hasColumn('trajectory', 'failed_at');
  if (!hasAt) {
    await knex.raw(`
      ALTER TABLE trajectory ADD COLUMN failed_at DATETIME(3) NULL
        COMMENT '最近一次录制失败时间'
    `);
  }
}

export async function down(knex) {
  for (const col of ['failed_kind', 'failed_reason', 'failed_at']) {
    // eslint-disable-next-line no-await-in-loop
    const has = await knex.schema.hasColumn('trajectory', col);
    if (has) {
      // eslint-disable-next-line no-await-in-loop
      await knex.raw(`ALTER TABLE trajectory DROP COLUMN ${col}`);
    }
  }
}
