/**
 * Deadlock forensics — best-effort capture of InnoDB deadlock evidence when the
 * recording persist path hits a MySQL lock error (deadlock / lock wait timeout).
 * Pure side channel: it never throws, never rejects, and never affects the
 * caller's retry/broadcast semantics.
 */
import { getDB } from '#config/database.js';

/** InnoDB status 段界分隔线（SHOW ENGINE INNODB STATUS 各 section 之间的 “------------”）。 */
const SECTION_DELIMITER = '------------';
/** 找不到 LATEST DETECTED DEADLOCK 标记时回退截取的 Status 末尾长度。 */
const FALLBACK_TAIL_CHARS = 4000;
/** 单条取证输出的段落上限（防超长刷屏）。 */
const MAX_OUTPUT_CHARS = 8000;
/** SHOW ENGINE INNODB STATUS 查询超时（毫秒），取证绝不拖住外层持久化路径。 */
const STATUS_QUERY_TIMEOUT_MS = 3000;

/**
 * 从 knex raw 结果中防御式取出含 Status 长文本的行对象（mysql2 下 raw 返回
 * [rows, fields]，兼容一至两层嵌套数组）。
 * @param {unknown} rows knex raw 查询结果（形态随驱动而异）
 * @returns {string|null} Status 长文本；取不到时 null
 */
function extractInnodbStatusText(rows) {
  const candidates = [];
  const collect = (value, depth) => {
    if (value == null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      if (depth > 0) {
        for (const item of value) collect(item, depth - 1);
      }
      return;
    }
    candidates.push(value);
  };
  collect(rows, 2);
  for (const row of candidates) {
    if (typeof row.Status === 'string' && row.Status.length > 0) return row.Status;
  }
  return null;
}

/**
 * 从 InnoDB status 全文截取 LATEST DETECTED DEADLOCK 段：标记行起、至其后下一个
 * “------------” 段界为止；找不到标记则回退取末尾 4000 字符。
 * @param {string} status SHOW ENGINE INNODB STATUS 的 Status 长文本
 * @returns {string} 截取出的段落
 */
function extractDeadlockSection(status) {
  const marker = 'LATEST DETECTED DEADLOCK';
  const start = status.indexOf(marker);
  if (start < 0) return status.slice(-FALLBACK_TAIL_CHARS);
  // 标记行下方紧跟一条与标记同宽的表头 “----…” 线，越过它再找下一个段界
  let from = start + marker.length;
  const lineEnd = status.indexOf('\n', from);
  if (lineEnd >= 0) {
    let p = lineEnd + 1;
    while (p < status.length && status[p] === '-') p += 1;
    if (p > lineEnd + 1 && status[p] === '\n') from = p + 1;
  }
  const end = status.indexOf(SECTION_DELIMITER, from);
  return end >= 0 ? status.slice(start, end) : status.slice(start);
}

/**
 * 死锁复发自动取证：仅当 err 是 MySQL 锁类错误（ER_LOCK_DEADLOCK/1213、
 * ER_LOCK_WAIT_TIMEOUT/1205）时，best-effort 执行 SHOW ENGINE INNODB STATUS 并把
 * LATEST DETECTED DEADLOCK 段输出到 console.error。守卫之后的一切包在 try/catch
 * 中全吞——本函数永不 reject，也绝不影响外层 retry/broadcast 语义。
 * @param {unknown} err persist 失败的原始错误
 * @param {{ trajectoryDbId?: number|string, actionId?: string|null }} [context] 录制上下文（仅用于输出标注）
 * @param {{ db?: import('knex').Knex }} [opts] 可选依赖注入（characterization pin 桩 DB 用；省略时用 getDB()）
 * @returns {Promise<void>} 恒 resolve；取证结果只落到 console.error
 */
export async function captureDeadlockForensics(err, context, opts) {
  const isLockError = !!err && typeof err === 'object'
    && (err.code === 'ER_LOCK_DEADLOCK' || err.errno === 1213
      || err.code === 'ER_LOCK_WAIT_TIMEOUT' || err.errno === 1205);
  if (!isLockError) return;
  try {
    const db = opts?.db || getDB();
    const rows = await db.raw('SHOW ENGINE INNODB STATUS').timeout(STATUS_QUERY_TIMEOUT_MS);
    const status = extractInnodbStatusText(rows);
    if (!status) return;
    const section = extractDeadlockSection(status);
    console.error(`[record] deadlock forensics trajectoryDbId=${context?.trajectoryDbId} actionId=${context?.actionId} :: ${section.slice(0, MAX_OUTPUT_CHARS)}`);
  } catch {
    // 取证失败必须完全静默：绝不抛错、绝不影响外层 retry/broadcast 语义
  }
}
