/**
 * System-mgmt Excel template / export / import helpers.
 * Columns match product template:
 *   *父节点 | *类型 | *名称 | 地址（系统下填写） | 备注
 * Parent path uses '/' separators (empty = under root).
 */
import ExcelJS from 'exceljs';
import { NODE_TYPE, TYPE_LABEL } from '../models/hierarchy-constants.js';

export const EXCEL_HEADERS = Object.freeze([
  '*父节点',
  '*类型',
  '*名称',
  '地址（系统下填写）',
  '备注',
]);

export const EXCEL_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const TYPE_BY_LABEL = Object.freeze({
  系统: NODE_TYPE.SYSTEM,
  模块: NODE_TYPE.MODULE,
  功能: NODE_TYPE.FUNCTION,
  system: NODE_TYPE.SYSTEM,
  module: NODE_TYPE.MODULE,
  function: NODE_TYPE.FUNCTION,
  [String(NODE_TYPE.SYSTEM)]: NODE_TYPE.SYSTEM,
  [String(NODE_TYPE.MODULE)]: NODE_TYPE.MODULE,
  [String(NODE_TYPE.FUNCTION)]: NODE_TYPE.FUNCTION,
});

/**
 * @param {string|number} raw
 * @returns {number|null}
 */
export function parseTypeCell(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (TYPE_BY_LABEL[s] != null) return TYPE_BY_LABEL[s];
  const n = Number(s);
  if ([NODE_TYPE.SYSTEM, NODE_TYPE.MODULE, NODE_TYPE.FUNCTION].includes(n)) return n;
  return null;
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
export function splitParentPath(raw) {
  const s = String(raw ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!s || s === '根' || s === '/') return [];
  return s.split('/').map((p) => p.trim()).filter(Boolean);
}

/**
 * @param {string[]} parts
 */
export function joinParentPath(parts = []) {
  return parts.filter(Boolean).join('/');
}

/**
 * @typedef {{ parentPath: string, type: number, name: string, url: string, description: string, rowNumber: number }} ExcelRow
 */

/**
 * Sample rows for empty template download.
 * @returns {ExcelRow[]}
 */
export function sampleTemplateRows() {
  return [
    {
      parentPath: '',
      type: NODE_TYPE.SYSTEM,
      name: '示例系统',
      url: 'https://example.com',
      description: '',
      rowNumber: 2,
    },
    {
      parentPath: '示例系统',
      type: NODE_TYPE.MODULE,
      name: '示例模块',
      url: '',
      description: '',
      rowNumber: 3,
    },
    {
      parentPath: '示例系统/示例模块',
      type: NODE_TYPE.FUNCTION,
      name: '示例功能',
      url: '',
      description: '',
      rowNumber: 4,
    },
  ];
}

/**
 * Flatten nested export nodes → Excel rows.
 * @param {Array<{ type:number, name:string, url?:string, description?:string, children?:any[] }>} nodes
 * @returns {ExcelRow[]}
 */
export function flattenNodesToRows(nodes = []) {
  /** @type {ExcelRow[]} */
  const rows = [];
  let rowNumber = 2;

  function walk(list, parentParts) {
    for (const node of list || []) {
      const type = Number(node.type);
      const name = String(node.name || '').trim();
      if (!name) continue;
      rows.push({
        parentPath: joinParentPath(parentParts),
        type,
        name,
        url: type === NODE_TYPE.SYSTEM ? String(node.url || '') : '',
        description: String(node.description || ''),
        rowNumber: rowNumber++,
      });
      const children = Array.isArray(node.children) ? node.children : [];
      if (children.length) walk(children, [...parentParts, name]);
    }
  }

  walk(nodes, []);
  return rows;
}

/**
 * Build .xlsx buffer.
 * @param {ExcelRow[]} rows
 * @param {{ sheetName?: string }} [opts]
 * @returns {Promise<Buffer>}
 */
export async function buildExcelBuffer(rows = [], { sheetName = '系统树' } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'JS-gen';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = [
    { header: EXCEL_HEADERS[0], key: 'parentPath', width: 28 },
    { header: EXCEL_HEADERS[1], key: 'type', width: 12 },
    { header: EXCEL_HEADERS[2], key: 'name', width: 24 },
    { header: EXCEL_HEADERS[3], key: 'url', width: 36 },
    { header: EXCEL_HEADERS[4], key: 'description', width: 28 },
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
      parentPath: row.parentPath || '',
      type: TYPE_LABEL[row.type] || String(row.type),
      name: row.name || '',
      url: row.url || '',
      description: row.description || '',
    });
  }

  // Hint for parent path column (Excel comment on A2 if sample exists)
  if (rows.length) {
    const cell = ws.getCell('A2');
    cell.note = {
      texts: [{ text: "父节点路径按 '/' 分割" }],
    };
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/**
 * Parse uploaded workbook buffer → normalized rows.
 * @param {Buffer|ArrayBuffer|Uint8Array} buffer
 * @returns {Promise<ExcelRow[]>}
 */
export async function parseExcelBuffer(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) {
    throw Object.assign(new Error('Excel 中没有工作表'), { code: 'VALIDATION' });
  }

  const headerRow = ws.getRow(1);
  const headerMap = {};
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const h = String(cell.value ?? '').trim();
    if (h) headerMap[normalizeHeader(h)] = col;
  });

  const colParent = headerMap.parent ?? headerMap['*父节点'] ?? 1;
  const colType = headerMap.type ?? headerMap['*类型'] ?? 2;
  const colName = headerMap.name ?? headerMap['*名称'] ?? 3;
  const colUrl = headerMap.url ?? headerMap['地址（系统下填写）'] ?? headerMap.address ?? 4;
  const colDesc = headerMap.description ?? headerMap['备注'] ?? headerMap.remark ?? 5;

  /** @type {ExcelRow[]} */
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const parentRaw = cellText(row.getCell(colParent));
    const typeRaw = cellText(row.getCell(colType));
    const name = cellText(row.getCell(colName)).trim();
    const url = cellText(row.getCell(colUrl)).trim();
    const description = cellText(row.getCell(colDesc)).trim();

    // skip completely empty data rows
    if (!parentRaw && !typeRaw && !name && !url && !description) return;

    const type = parseTypeCell(typeRaw);
    if (type == null) {
      throw Object.assign(
        new Error(`第 ${rowNumber} 行类型无效「${typeRaw}」（期望：系统/模块/功能）`),
        { code: 'VALIDATION' },
      );
    }
    if (!name) {
      throw Object.assign(new Error(`第 ${rowNumber} 行缺少名称`), { code: 'VALIDATION' });
    }

    const parentParts = splitParentPath(parentRaw);
    const expectedDepth = type === NODE_TYPE.SYSTEM ? 0
      : type === NODE_TYPE.MODULE ? 1
        : 2;
    if (parentParts.length !== expectedDepth) {
      throw Object.assign(
        new Error(
          `第 ${rowNumber} 行「${name}」类型为${TYPE_LABEL[type]}，父节点路径应有 ${expectedDepth} 段（用 / 分隔），实际「${parentRaw || '(空)'}」`,
        ),
        { code: 'VALIDATION' },
      );
    }

    rows.push({
      parentPath: joinParentPath(parentParts),
      type,
      name,
      url,
      description,
      rowNumber,
    });
  });

  if (!rows.length) {
    throw Object.assign(new Error('Excel 中没有有效数据行'), { code: 'VALIDATION' });
  }

  // Parents before children
  rows.sort((a, b) => {
    const da = splitParentPath(a.parentPath).length;
    const db = splitParentPath(b.parentPath).length;
    if (da !== db) return da - db;
    return a.rowNumber - b.rowNumber;
  });

  return rows;
}

function normalizeHeader(h) {
  const s = String(h || '').trim();
  const map = {
    '*父节点': 'parent',
    父节点: 'parent',
    parent: 'parent',
    parentPath: 'parent',
    '*类型': 'type',
    类型: 'type',
    type: 'type',
    '*名称': 'name',
    名称: 'name',
    name: 'name',
    '地址（系统下填写）': 'url',
    地址: 'url',
    url: 'url',
    备注: 'description',
    description: 'description',
    remark: 'description',
  };
  return map[s] || s;
}

function cellText(cell) {
  if (!cell || cell.value == null) return '';
  const v = cell.value;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return String(v);
  }
  if (typeof v === 'object') {
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text || '').join('');
    if (v.hyperlink != null && v.text != null) return String(v.text);
  }
  return String(v);
}
