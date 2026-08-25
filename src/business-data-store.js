import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import path from 'path';

import { BUSINESS_DATA_DIR } from '../config/config.js';

function indexPath() {
  return path.join(BUSINESS_DATA_DIR, 'index.json');
}

export function ensureBusinessDataDir() {
  if (!existsSync(BUSINESS_DATA_DIR)) mkdirSync(BUSINESS_DATA_DIR, { recursive: true });
}

export function loadBusinessDataIndex() {
  ensureBusinessDataDir();
  if (!existsSync(indexPath())) return [];
  try { return JSON.parse(readFileSync(indexPath(), 'utf-8')); } catch { return []; }
}

function saveBusinessDataIndex(list) {
  ensureBusinessDataDir();
  writeFileSync(indexPath(), JSON.stringify(list, null, 2), 'utf-8');
}


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

export function getBusinessDataRecord(recordId) {
  const list = loadBusinessDataIndex();
  return list.find(r => r.recordId === recordId) || null;
}

export function loadBusinessDataJson(recordId) {
  const record = getBusinessDataRecord(recordId);
  if (!record) return null;
  const filePath = path.join(BUSINESS_DATA_DIR, record.fileName);
  if (!existsSync(filePath)) return null;
  try { return JSON.parse(readFileSync(filePath, 'utf-8')); } catch { return null; }
}

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
