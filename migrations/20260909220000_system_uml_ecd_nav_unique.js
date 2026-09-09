/**
 * system.uml_ecd_nav — STORED generated: uml_ecd when menu_xpath and uml_ecd both non-empty (trim);
 * UNIQUE uk_uml_ecd_nav. Navigable menus only.
 */
async function indexExists(knex, table, name) {
  const rows = await knex.raw(
    `SELECT 1 AS ok FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`,
    [table, name],
  );
  return (rows[0] || []).length > 0;
}

export async function up(knex) {
  const dups = await knex.raw(`
    SELECT uml_ecd AS umlEcd, COUNT(*) AS c, GROUP_CONCAT(id ORDER BY id) AS ids
    FROM \`system\`
    WHERE menu_xpath IS NOT NULL AND TRIM(menu_xpath) <> ''
      AND uml_ecd IS NOT NULL AND TRIM(uml_ecd) <> ''
    GROUP BY uml_ecd
    HAVING c > 1
    ORDER BY c DESC
    LIMIT 20
  `);
  const rows = dups[0] || [];
  if (rows.length) {
    console.error('[migration] navigable uml_ecd duplicates (fix before uk_uml_ecd_nav):', rows);
    throw new Error(
      `Cannot add uk_uml_ecd_nav: ${rows.length} duplicate uml_ecd group(s) among xpath rows`,
    );
  }

  const hasCol = await knex.schema.hasColumn('system', 'uml_ecd_nav');
  if (!hasCol) {
    await knex.raw(`
      ALTER TABLE \`system\`
      ADD COLUMN \`uml_ecd_nav\` VARCHAR(64)
        GENERATED ALWAYS AS (
          CASE
            WHEN \`menu_xpath\` IS NOT NULL AND TRIM(\`menu_xpath\`) <> ''
             AND \`uml_ecd\` IS NOT NULL AND TRIM(\`uml_ecd\`) <> ''
            THEN \`uml_ecd\`
            ELSE NULL
          END
        ) STORED
        COMMENT '可导航唯一：有 xpath 且非空 uml_ecd 时等于 uml_ecd'
        AFTER \`uml_ecd\`
    `);
    console.log('[migration] added system.uml_ecd_nav');
  }

  if (!(await indexExists(knex, 'system', 'uk_uml_ecd_nav'))) {
    await knex.raw('ALTER TABLE `system` ADD UNIQUE INDEX `uk_uml_ecd_nav` (`uml_ecd_nav`)');
    console.log('[migration] added system.uk_uml_ecd_nav');
  }
}

export async function down(knex) {
  if (await indexExists(knex, 'system', 'uk_uml_ecd_nav')) {
    await knex.raw('ALTER TABLE `system` DROP INDEX `uk_uml_ecd_nav`');
  }
  if (await knex.schema.hasColumn('system', 'uml_ecd_nav')) {
    await knex.schema.alterTable('system', (t) => t.dropColumn('uml_ecd_nav'));
  }
}
