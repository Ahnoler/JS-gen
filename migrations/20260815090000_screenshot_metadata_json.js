/**
 * screenshot.metadata_json — 阶段长图元数据：
 * { imageWidth, imageHeight, contentWidth, contentHeight, truncated,
 *   elements: [{ index, kind, label, layers, regionId, parentRegionId, rect, outsideRoot }],
 *   regionTree: { pageLabel, roots } | null }
 */

export async function up(knex) {
  if (await knex.schema.hasTable('screenshot')) {
    if (!(await knex.schema.hasColumn('screenshot', 'metadata_json'))) {
      await knex.schema.alterTable('screenshot', (t) => {
        t.json('metadata_json').nullable()
          .comment('阶段长图元数据（长宽/元素坐标/region_tree）；kind=phase_highlight 时有效')
          .after('mime_type');
      });
    }
  }
}

export async function down(knex) {
  if (await knex.schema.hasTable('screenshot')) {
    if (await knex.schema.hasColumn('screenshot', 'metadata_json')) {
      await knex.schema.alterTable('screenshot', (t) => {
        t.dropColumn('metadata_json');
      });
    }
  }
}
