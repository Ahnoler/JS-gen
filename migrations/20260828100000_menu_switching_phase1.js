/**
 * Menu switching phase 1:
 *  - system 表加 5 列（uml_ecd/pd_cmpt_ecd/source/menu_xpath/unmatched_flag），
 *    每列独立 hasColumn 幂等守卫，均置于 sort_order 之后。
 *  - system.uml_ecd 加普通索引 idx_uml_ecd（information_schema 探测幂等）。
 *  - 新建 system_page 表：功能节点的明细页面清单，FK → system(id) ON DELETE CASCADE。
 *
 * 注意：服务器为 MySQL 5.7，严禁使用 utf8mb4_0900_ai_ci（仅 8.0 支持），
 *       本表显式指定 ENGINE=InnoDB CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci。
 *       updated_at 的 ON UPDATE CURRENT_TIMESTAMP(3) 用 createTable 后 knex.raw 补 DDL
 *       （knex schema builder 表达不了 ON UPDATE 子句）。
 *       FK 用探测式幂等添加（information_schema.TABLE_CONSTRAINTS）。
 */

async function dropFkIfExists(knex, table, name) {
  const [rows] = await knex.raw(
    `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?
       AND CONSTRAINT_TYPE = 'FOREIGN KEY' LIMIT 1`,
    [table, name],
  );
  if (rows && rows.length) {
    await knex.raw(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${name}\``);
  }
}

async function dropIndexIfExists(knex, table, indexName) {
  const [rows] = await knex.raw(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [table, indexName],
  );
  if (rows && rows.length) {
    await knex.raw(`ALTER TABLE \`${table}\` DROP INDEX \`${indexName}\``);
  }
}

async function indexExists(knex, table, indexName) {
  const [rows] = await knex.raw(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [table, indexName],
  );
  return !!(rows && rows.length);
}

async function fkExists(knex, table, name) {
  const [rows] = await knex.raw(
    `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?
       AND CONSTRAINT_TYPE = 'FOREIGN KEY' LIMIT 1`,
    [table, name],
  );
  return !!(rows && rows.length);
}

export async function up(knex) {
  // ── system 表加 5 列（每列独立 hasColumn 幂等守卫，均 .after('sort_order')）──
  const columns = [
    { name: 'uml_ecd', build: (t) => t.string('uml_ecd', 64).notNullable().defaultTo('').comment('菜单唯一ID（JSON umlEcd）') },
    { name: 'pd_cmpt_ecd', build: (t) => t.string('pd_cmpt_ecd', 64).notNullable().defaultTo('').comment('页面ID（功能级主页面便捷展示，明细在 system_page）') },
    { name: 'source', build: (t) => t.string('source', 16).notNullable().defaultTo('').comment('菜单来源：json_import/manual/ai') },
    { name: 'menu_xpath', build: (t) => t.string('menu_xpath', 2048).notNullable().defaultTo('').comment('菜单xpath（菜单扫描产物）') },
    { name: 'unmatched_flag', build: (t) => t.specificType('unmatched_flag', 'tinyint').notNullable().defaultTo(0).comment('更新导入未匹配保留标记') },
  ];

  for (const col of columns) {
    if (!(await knex.schema.hasColumn('system', col.name))) {
      await knex.schema.alterTable('system', (t) => {
        col.build(t).after('sort_order');
      });
      console.log(`[migration] added system.${col.name}`);
    }
  }

  // ── system.uml_ecd 普通索引 idx_uml_ecd（探测幂等）──
  if (!(await indexExists(knex, 'system', 'idx_uml_ecd'))) {
    await knex.raw('ALTER TABLE `system` ADD INDEX `idx_uml_ecd` (`uml_ecd`)');
    console.log('[migration] added system.idx_uml_ecd');
  }

  // ── 建表 system_page ──
  if (!(await knex.schema.hasTable('system_page'))) {
    await knex.schema.createTable('system_page', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('system_node_id').unsigned().notNullable()
        .comment('FK → system.id（功能节点）');
      t.string('page_id', 64).notNullable().comment('页面唯一ID');
      t.string('page_name', 255).defaultTo('').comment('页面名称');
      t.string('res_path', 2048).defaultTo('').comment('资源路径');
      t.string('page_type', 32).defaultTo('managePage').comment('页面类型');
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.datetime('updated_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.unique(['page_id'], 'uk_page_id');
      t.index(['system_node_id'], 'idx_system_node');
    });

    // ENGINE / CHARSET / COLLATE（knex createTable 表达不了，用 raw 补）
    await knex.raw(
      'ALTER TABLE `system_page` ENGINE=InnoDB CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    );

    // updated_at ON UPDATE CURRENT_TIMESTAMP(3)（knex 表达不了，用 raw 补 DDL）
    await knex.raw(
      'ALTER TABLE `system_page` MODIFY COLUMN `updated_at` DATETIME(3) ' +
      'NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)',
    );

    // FK fk_spage_system_node（探测式幂等添加）
    if (!(await fkExists(knex, 'system_page', 'fk_spage_system_node'))) {
      await knex.raw(
        'ALTER TABLE `system_page` ADD CONSTRAINT `fk_spage_system_node` ' +
        'FOREIGN KEY (`system_node_id`) REFERENCES `system` (`id`) ON DELETE CASCADE',
      );
    }

    console.log('[migration] created system_page');
  }
}

export async function down(knex) {
  // ── 反向：先删 FK → dropTable → 删索引 → 逐列 dropColumn ──

  if (await knex.schema.hasTable('system_page')) {
    await dropFkIfExists(knex, 'system_page', 'fk_spage_system_node');
    await knex.schema.dropTable('system_page');
    console.log('[migration] dropped system_page');
  }

  await dropIndexIfExists(knex, 'system', 'idx_uml_ecd');

  for (const colName of ['uml_ecd', 'pd_cmpt_ecd', 'source', 'menu_xpath', 'unmatched_flag']) {
    if (await knex.schema.hasColumn('system', colName)) {
      await knex.schema.alterTable('system', (t) => {
        t.dropColumn(colName);
      });
      console.log(`[migration] dropped system.${colName}`);
    }
  }
}
