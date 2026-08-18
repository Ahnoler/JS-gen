/**
 * Screenshot MinIO storage.
 *
 * Replace inline image_data BLOB storage with MinIO object references.
 * Adds:
 *   - storage_type: 'db' | 'minio' (new rows use 'minio')
 *   - storage_path: MinIO object key
 *   - image_url:    public/API URL for the image
 * Drops image_data because new screenshots are stored in MinIO, not as base64/BLOB.
 */

export async function up(knex) {
  if (!(await knex.schema.hasTable('screenshot'))) return;

  const hasStorageType = await knex.schema.hasColumn('screenshot', 'storage_type');
  if (!hasStorageType) {
    await knex.schema.alterTable('screenshot', (t) => {
      t.string('storage_type', 16).notNullable().defaultTo('minio')
        .comment('图片存储类型: db|minio')
        .after('mime_type');
      t.string('storage_path', 512).nullable()
        .comment('MinIO object key（storage_type=minio 时有效）')
        .after('storage_type');
      t.string('image_url', 1024).nullable()
        .comment('图片访问 URL（可为 MinIO 直链或本服务 API 路径）')
        .after('storage_path');
    });
  }

  if (await knex.schema.hasColumn('screenshot', 'image_data')) {
    await knex.schema.alterTable('screenshot', (t) => {
      t.dropColumn('image_data');
    });
  }
}

export async function down(knex) {
  if (!(await knex.schema.hasTable('screenshot'))) return;

  if (!(await knex.schema.hasColumn('screenshot', 'image_data'))) {
    await knex.schema.alterTable('screenshot', (t) => {
      t.specificType('image_data', 'MEDIUMBLOB').nullable()
        .comment('PNG 图片二进制（已迁移到 MinIO 后废弃）');
    });
  }

  if (await knex.schema.hasColumn('screenshot', 'storage_type')) {
    await knex.schema.alterTable('screenshot', (t) => {
      t.dropColumn('storage_type');
    });
  }
  if (await knex.schema.hasColumn('screenshot', 'storage_path')) {
    await knex.schema.alterTable('screenshot', (t) => {
      t.dropColumn('storage_path');
    });
  }
  if (await knex.schema.hasColumn('screenshot', 'image_url')) {
    await knex.schema.alterTable('screenshot', (t) => {
      t.dropColumn('image_url');
    });
  }
}
