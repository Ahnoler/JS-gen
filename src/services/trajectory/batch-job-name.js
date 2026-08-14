/**
 * Batch job task name formula：文件名(去扩展名) + '_MMDD-HHmm'（服务器本地时区）。
 * 运行时创建与迁移回填共用，保持零依赖纯函数。
 */

/** 去掉最后一个扩展名；无点或点在首位（如 ".xlsx"）时原样返回。 */
export function stripExtension(filename) {
  const s = String(filename || '').trim();
  const idx = s.lastIndexOf('.');
  return idx > 0 ? s.slice(0, idx) : s;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 'MMDD-HHmm'，服务器本地时区。 */
export function formatMonthDayHourMinute(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}-${pad2(dt.getHours())}${pad2(dt.getMinutes())}`;
}

/** 文件名部分最大长度（后缀 '_MMDD-HHmm' 共 10 字符 + 分隔符 1，512-11=501）。 */
export const BATCH_JOB_NAME_MAX_FILENAME = 501;

/**
 * defaultJobName('批量录制导入模板.xlsx', new Date(2026, 7, 14, 12, 51))
 *   → '批量录制导入模板_0814-1251'
 */
export function defaultJobName(originalFilename, createdAt) {
  const base = stripExtension(originalFilename) || '批量导入';
  return `${base.slice(0, BATCH_JOB_NAME_MAX_FILENAME)}_${formatMonthDayHourMinute(createdAt)}`;
}
