/**
 * 修复 batch_recording_job 存量文件名的 mojibake（UTF-8 字节被 latin1 解码）。
 *
 * 背景：2026-08-13 及更早导入的文件名在 multer/busboy 链路被错误解码
 *（「批量录制导入模板.xlsx」存成 æ¹éå¶å¯¼å¥æ¨¡æ¿.xlsx）；2026-08-14
 * batch_job_name 回填迁移直接用乱码 original_filename 生成了乱码 name。
 * 运行时链路已由 decodeUploadFilename 修复（导入路由已应用），本迁移只修存量。
 *
 * 幂等：decodeUploadFilename 对已含 CJK 或 ASCII 的名称原样返回；null 不动。
 * down 为 no-op（数据修复不可逆）。
 */
import { decodeUploadFilename } from '../src/http/decode-upload-filename.js';

export async function up(knex) {
  if (!(await knex.schema.hasTable('batch_recording_job'))) return;
  const rows = await knex('batch_recording_job').select('id', 'name', 'original_filename');
  for (const r of rows) {
    const name = r.name ? decodeUploadFilename(String(r.name)) : r.name;
    const file = r.original_filename ? decodeUploadFilename(String(r.original_filename)) : r.original_filename;
    if (name !== r.name || file !== r.original_filename) {
      await knex('batch_recording_job').where({ id: r.id }).update({ name, original_filename: file });
    }
  }
}

export async function down() {
  // no-op：数据修复不可逆
}
