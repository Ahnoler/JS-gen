/**
 * 用于组装系统消息内容及塑造消息行的纯辅助函数。
 *
 * 本模块维护重新导出给服务层和路由层的稳定消息常量，以及批量导入通知的
 * 转义、格式化、链接构建和 API 结构规则。
 */
export {
  MSG_TYPE_BATCH_IMPORT,
  MSG_TITLE_BATCH_IMPORT,
  SOURCE_TYPE_BATCH_IMPORT,
  MSG_STATUS_UNREAD,
  MSG_STATUS_READ,
  DICT_TYPE_SYS_MSG,
} from '../../models/constants.js';

import {
  MSG_TYPE_BATCH_IMPORT,
  MSG_TITLE_BATCH_IMPORT,
  MSG_STATUS_UNREAD,
  MSG_STATUS_READ,
} from '../../models/constants.js';
import {
  decodeUploadFilename,
  repairMojibakeText,
} from '../../http/decode-upload-filename.js';

const JOB_STATUS_LABEL = {
  completed: '已完成',
  completed_with_errors: '已完成（有失败）',
  failed: '失败',
  cancelled: '已取消',
};

/**
 * Escape HTML special characters in a string.
 * @param {string} s input string
 * @returns {string} HTML-escaped string
 */
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Map a batch job status code to its Chinese display label.
 * @param {string} status job status code
 * @returns {string} display label, or the raw status if unknown
 */
export function jobStatusLabel(status) {
  const key = String(status || '');
  if (!key) return '';
  return Object.prototype.hasOwnProperty.call(JOB_STATUS_LABEL, key)
    ? JOB_STATUS_LABEL[key]
    : key;
}

/**
 * 读取数值型摘要字段，并将缺失或无效值规范为零。
 * @param {object|null|undefined} summary 批处理任务摘要对象
 * @param {string} key 摘要属性名
 * @returns {number} 有限数值型摘要值；否则为零
 */
function summaryInt(summary, key) {
  const v = Number(summary?.[key]);
  return Number.isFinite(v) ? v : 0;
}

/**
 * Compose the HTML content body for a batch-import system message.
 * @param {object} [root0] content fields
 * @param {string} [root0.functionName] function display name
 * @param {string} [root0.filename] uploaded file name
 * @param {string} [root0.jobStatus] batch job status code
 * @param {object} [root0.summary] job summary counts (total, accepted, rejected, …)
 * @returns {string} HTML content string
 */
export function composeBatchImportMsgContent({
  functionName = '',
  filename = '',
  jobStatus = '',
  summary = {},
} = {}) {
  const line1 = [
    escapeHtml(String(functionName || '').trim()),
    escapeHtml(decodeUploadFilename(String(filename || '')).trim()),
    String(jobStatusLabel(jobStatus) || '').trim(),
  ]
    .filter(Boolean)
    .join(' · ');
  const line2 = `共 ${summaryInt(summary, 'total')} 条 · 受理 ${summaryInt(summary, 'accepted')} · 拒绝 ${summaryInt(summary, 'rejected')} · 已存草稿 ${summaryInt(summary, 'drafted')} · 已录制 ${summaryInt(summary, 'recorded')} · 失败 ${summaryInt(summary, 'failed')}`;
  return `${line1}<br>${line2}`;
}

/**
 * Build the UI link URL for a batch import detail page.
 * @param {string|number} batchId batch job id
 * @returns {string} link URL with encoded batch id
 */
export function batchImportLinkUrl(batchId) {
  return `/ui-recording?batchId=${encodeURIComponent(String(batchId || ''))}`;
}

/**
 * 为日期或时间组成部分左侧补零至两位。
 * @param {number|string} n 组成部分的值
 * @returns {string} 两位组成部分字符串
 */
function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Format a message creation time as 'YYYY-MM-DD HH:mm:ss'.
 * @param {Date|string|number} value date value
 * @returns {string} formatted timestamp, or empty string if unparseable
 */
export function formatMsgCreateTime(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())} ${pad2(value.getHours())}:${pad2(value.getMinutes())}:${pad2(value.getSeconds())}`;
  }
  const s = String(value);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (m) return `${m[1]} ${m[2]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return formatMsgCreateTime(d);
  return s;
}

/**
 * Shape a DB row into the system-message API response object.
 * @param {object} row sys_msg DB row
 * @param {object} [root1] options
 * @param {string} [root1.msgTypeLabel] display label for the message type
 * @returns {object} shaped system-message API object
 */
export function shapeSysMsgApi(row, { msgTypeLabel } = {}) {
  const r = row || {};
  const title = String(r.msgTitle || MSG_TITLE_BATCH_IMPORT);
  const status = Number(r.msgStatus) === MSG_STATUS_READ ? MSG_STATUS_READ : MSG_STATUS_UNREAD;
  return {
    msgId: r.id,
    msgTitle: title,
    workItemName: title,
    msgContent: repairMojibakeText(r.msgContent || ''),
    msgType: Number(r.msgType) || MSG_TYPE_BATCH_IMPORT,
    msgTypeLabel: msgTypeLabel || title,
    msgStatus: status,
    createTime: formatMsgCreateTime(r.createTime),
    createBy: r.createBy || '系统',
    belongItemName: r.belongItemName || '',
    linkUrl: r.linkUrl || '',
  };
}
