/**
 * - trajectory.system_account_id → bind login account before recording studio
 * - trajectory_step.is_replay → mark / exclude re-executed steps from phase lists
 */
export async function up(knex) {
  const hasAccount = await knex.schema.hasColumn('trajectory', 'system_account_id');
  if (!hasAccount) {
    await knex.schema.alterTable('trajectory', (t) => {
      t.bigInteger('system_account_id')
        .unsigned()
        .nullable()
        .comment('FK → system_account.id；录制默认登录账号')
        .after('function_id');
      t.index(['system_account_id'], 'idx_traj_system_account');
    });
    // FK may fail if system_account missing on old DBs — ignore
    try {
      await knex.schema.alterTable('trajectory', (t) => {
        t.foreign('system_account_id', 'fk_traj_system_account')
          .references('id')
          .inTable('system_account')
          .onDelete('SET NULL');
      });
    } catch (err) {
      console.warn('[migration] skip fk_traj_system_account:', err.message);
    }
  }

  const hasReplay = await knex.schema.hasColumn('trajectory_step', 'is_replay');
  if (!hasReplay) {
    await knex.schema.alterTable('trajectory_step', (t) => {
      t.boolean('is_replay')
        .notNullable()
        .defaultTo(false)
        .comment('1=回放执行产生，不计入阶段步骤列表')
        .after('confirmed_at');
      t.index(['trajectory_id', 'is_replay'], 'idx_step_is_replay');
    });
  }
}

export async function down(knex) {
  const hasReplay = await knex.schema.hasColumn('trajectory_step', 'is_replay');
  if (hasReplay) {
    await knex.schema.alterTable('trajectory_step', (t) => {
      t.dropIndex(['trajectory_id', 'is_replay'], 'idx_step_is_replay');
      t.dropColumn('is_replay');
    });
  }

  const hasAccount = await knex.schema.hasColumn('trajectory', 'system_account_id');
  if (hasAccount) {
    try {
      await knex.schema.alterTable('trajectory', (t) => {
        t.dropForeign(['system_account_id'], 'fk_traj_system_account');
      });
    } catch {}
    await knex.schema.alterTable('trajectory', (t) => {
      t.dropIndex(['system_account_id'], 'idx_traj_system_account');
      t.dropColumn('system_account_id');
    });
  }
}
