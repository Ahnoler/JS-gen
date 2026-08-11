/**
 * Batch trajectory Excel template / parse helpers.
 * Columns: 交易名称 | 需求描述
 */
import ExcelJS from 'exceljs';
import { BATCH_IMPORT_MAX_ROWS } from '../../config/config.js';
import { XLSX_MIME } from '../http/upload-xlsx.js';

export const BATCH_EXCEL_HEADERS = Object.freeze(['交易名称', '需求描述']);
/** Download name for GET /api/v2/trajectories/batch/template */
export const BATCH_TEMPLATE_FILENAME = '批量录制导入模板.xlsx';
export { XLSX_MIME };

/**
 * @typedef {{ rowNumber: number, name: string, requirement: string }} BatchExcelValidRow
 * @typedef {{ rowNumber: number, name?: string, requirement?: string, error: string }} BatchExcelRejectedRow
 */

export function sampleTemplateRows() {
  return [
    {
      rowNumber: 2,
      name: '开户交易',
      requirement: '1、登录系统。\n2、新增客户。',
    },
  ];
}

/**
 * @param {Array<{ name: string, requirement: string }>} rows
 * @returns {Promise<Buffer>}
 */
export async function buildTemplateBuffer(rows = sampleTemplateRows()) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'JS-gen';
  wb.created = new Date();
  const ws = wb.addWorksheet('批量录制', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = [
    { header: BATCH_EXCEL_HEADERS[0], key: 'name', width: 24 },
    { header: BATCH_EXCEL_HEADERS[1], key: 'requirement', width: 60 },
  ];
  const header = ws.getRow(1);
  header.height = 22;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF808080' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  for (const row of rows) {
    ws.addRow({
      name: row.name || '',
      requirement: row.requirement || '',
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function cellText(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    if (value.richText) {
      return value.richText.map((t) => t.text || '').join('');
    }
    if (value.text != null) return String(value.text);
    if (value.result != null) return String(value.result);
  }
  return String(value);
}

/**
 * Parse uploaded .xlsx buffer.
 * @returns {Promise<{
 *   valid: BatchExcelValidRow[],
 *   rejected: BatchExcelRejectedRow[],
 *   skippedEmpty: number,
 * }>}
 */
export async function parseBatchExcelBuffer(buffer, {
  maxRows = BATCH_IMPORT_MAX_ROWS,
} = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) {
    throw Object.assign(new Error('Excel 中没有工作表'), { code: 'VALIDATION' });
  }

  const h1 = cellText(ws.getRow(1).getCell(1).value).trim();
  const h2 = cellText(ws.getRow(1).getCell(2).value).trim();
  if (h1 !== BATCH_EXCEL_HEADERS[0] || h2 !== BATCH_EXCEL_HEADERS[1]) {
    throw Object.assign(
      new Error(`表头必须为「${BATCH_EXCEL_HEADERS[0]}」「${BATCH_EXCEL_HEADERS[1]}」`),
      { code: 'VALIDATION' },
    );
  }

  /** @type {BatchExcelValidRow[]} */
  const valid = [];
  /** @type {BatchExcelRejectedRow[]} */
  const rejected = [];
  let skippedEmpty = 0;
  let nonEmpty = 0;

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const name = cellText(row.getCell(1).value).trim();
    const requirement = cellText(row.getCell(2).value).trim();
    if (!name && !requirement) {
      skippedEmpty += 1;
      return;
    }
    nonEmpty += 1;
    if (!name || !requirement) {
      rejected.push({
        rowNumber,
        name,
        requirement,
        error: !name ? '交易名称不能为空' : '需求描述不能为空',
      });
      return;
    }
    valid.push({ rowNumber, name, requirement });
  });

  if (nonEmpty > maxRows) {
    throw Object.assign(
      new Error(`非空数据行超过上限 ${maxRows}`),
      { code: 'VALIDATION', statusCode: 400 },
    );
  }

  return { valid, rejected, skippedEmpty };
}
