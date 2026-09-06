/**
 * File-based business data store: index + per-record JSON persistence under BUSINESS_DATA_DIR.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import path from 'path';

import { BUSINESS_DATA_DIR } from '../config/config.js';

function indexPath() {
  return path.join(BUSINESS_DATA_DIR, 'index.json');
}

/**
 * Ensure the business data directory exists.
 * @returns {void} result
 */
export function ensureBusinessDataDir() {
  if (!existsSync(BUSINESS_DATA_DIR)) mkdirSync(BUSINESS_DATA_DIR, { recursive: true });
}

/**
 * Load and parse the business data index.json (returns [] on missing/parse error).
 * @returns {object[]} result
 */
export function loadBusinessDataIndex() {
  ensureBusinessDataDir();
  if (!existsSync(indexPath())) return [];
  try { return JSON.parse(readFileSync(indexPath(), 'utf-8')); } catch { return []; }
}

function saveBusinessDataIndex(list) {
  ensureBusinessDataDir();
  writeFileSync(indexPath(), JSON.stringify(list, null, 2), 'utf-8');
}


/**
 * Save a business data record (already written by Python) to the index.
 * @param {object} opts opts
 * @param {string} opts.businessDataPath path to the JSON file already on disk
 * @param {string} [opts.sessionId] session id
 * @param {string} [opts.model] model
 * @param {string} [opts.description] description
 * @returns {{ record: object, data: object }} saved record and parsed business data
 */
export function saveBusinessDataRecord({ businessDataPath, sessionId, model, description }) {
  ensureBusinessDataDir();
  // Python already wrote the file to the business_data dir, no copy needed
  const fileName = path.basename(businessDataPath);
  const recordId = fileName.replace(/\.json$/, '');

  const content = readFileSync(businessDataPath, 'utf-8');
  const data = JSON.parse(content);
  const keyCount = Object.keys(data).length;

  const record = {
    recordId,
    fileName,
    sessionId: sessionId || '',
    model: model || '',
    description: description || '',
    keyCount,
    createdAt: new Date().toISOString(),
  };

  const list = loadBusinessDataIndex();
  list.unshift(record);
  saveBusinessDataIndex(list);

  return { record, data };
}

/**
 * Look up a business data record from the index by id.
 * @param {string} recordId record id
 * @returns {object|null} result
 */
export function getBusinessDataRecord(recordId) {
  const list = loadBusinessDataIndex();
  return list.find(r => r.recordId === recordId) || null;
}

/**
 * Load and parse a business data record's full JSON by id.
 * @param {string} recordId record id
 * @returns {object|null} result
 */
export function loadBusinessDataJson(recordId) {
  const record = getBusinessDataRecord(recordId);
  if (!record) return null;
  const filePath = path.join(BUSINESS_DATA_DIR, record.fileName);
  if (!existsSync(filePath)) return null;
  try { return JSON.parse(readFileSync(filePath, 'utf-8')); } catch { return null; }
}

/**
 * Delete a business data JSON file and remove it from the index.
 * @param {string} recordId record id
 * @returns {boolean} result
 */
export function deleteBusinessData(recordId) {
  const list = loadBusinessDataIndex();
  const idx = list.findIndex(r => r.recordId === recordId);
  if (idx === -1) return false;

  const record = list[idx];
  const filePath = path.join(BUSINESS_DATA_DIR, record.fileName);
  try { if (existsSync(filePath)) unlinkSync(filePath); } catch {}

  list.splice(idx, 1);
  saveBusinessDataIndex(list);
  return true;
}
