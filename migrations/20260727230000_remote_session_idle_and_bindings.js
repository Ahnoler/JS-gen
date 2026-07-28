/**
 * remote_session: idle status + agent/trajectory bindings for 1:1 traj↔browser management.
 * - status ENUM adds `idle` (stream detached, browser still alive)
 * - agent_session_id: Python/executor session UUID
 * - trajectory_id: owning trajectory (nullable after stream detach)
 */

export async function up(knex) {
  // Expand status enum to include idle
  await knex.raw(
    "ALTER TABLE `remote_session` MODIFY `status` "
    + "ENUM('active','idle','closed','crashed') NOT NULL DEFAULT 'active' "
    + "COMMENT 'active=推流中; idle=断开画面浏览器仍在; closed=已释放; crashed=异常'",
  );

  const hasAgent = await knex.schema.hasColumn('remote_session', 'agent_session_id');
  if (!hasAgent) {
    await knex.schema.alterTable('remote_session', (t) => {
      t.string('agent_session_id', 64).nullable()
        .comment('Python/执行机 agent session UUID')
        .after('client_key');
      t.index(['agent_session_id'], 'idx_rs_agent_session');
    });
  }

  const hasTraj = await knex.schema.hasColumn('remote_session', 'trajectory_id');
  if (!hasTraj) {
    await knex.schema.alterTable('remote_session', (t) => {
      t.bigInteger('trajectory_id').unsigned().nullable()
        .comment('当前挂载交易 → trajectory.id；断开画面后可置 NULL')
        .after('agent_session_id');
      t.index(['trajectory_id'], 'idx_rs_trajectory');
    });
    try {
      await knex.schema.alterTable('remote_session', (t) => {
        t.foreign('trajectory_id', 'fk_rs_trajectory')
          .references('id')
          .inTable('trajectory')
          .onDelete('SET NULL');
      });
    } catch (err) {
      console.warn('[migration] skip fk_rs_trajectory:', err.message);
    }
  }
}

export async function down(knex) {
  // Move idle rows to closed before shrinking enum
  await knex('remote_session').where({ status: 'idle' }).update({
    status: 'closed',
    closed_at: knex.fn.now(),
  });

  const hasTraj = await knex.schema.hasColumn('remote_session', 'trajectory_id');
  if (hasTraj) {
    try {
      await knex.raw('ALTER TABLE `remote_session` DROP FOREIGN KEY `fk_rs_trajectory`');
    } catch (err) {
      console.warn('[migration] drop fk_rs_trajectory:', err.message);
    }
    await knex.schema.alterTable('remote_session', (t) => {
      t.dropIndex(['trajectory_id'], 'idx_rs_trajectory');
      t.dropColumn('trajectory_id');
    });
  }

  const hasAgent = await knex.schema.hasColumn('remote_session', 'agent_session_id');
  if (hasAgent) {
    await knex.schema.alterTable('remote_session', (t) => {
      t.dropIndex(['agent_session_id'], 'idx_rs_agent_session');
      t.dropColumn('agent_session_id');
    });
  }

  await knex.raw(
    "ALTER TABLE `remote_session` MODIFY `status` "
    + "ENUM('active','closed','crashed') NOT NULL DEFAULT 'active' "
    + "COMMENT '会话状态'",
  );
}
