import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import path from 'path';

import { CASE_DATA_DIR } from './config.js';

function indexPath() {
  return path.join(CASE_DATA_DIR, 'index.json');
}

export function ensureCaseDataDir() {
  if (!existsSync(CASE_DATA_DIR)) mkdirSync(CASE_DATA_DIR, { recursive: true });
}

export function loadCaseDataIndex() {
  ensureCaseDataDir();
  if (!existsSync(indexPath())) return [];
  try { return JSON.parse(readFileSync(indexPath(), 'utf-8')); } catch { return []; }
}

function saveCaseDataIndex(list) {
  ensureCaseDataDir();
  writeFileSync(indexPath(), JSON.stringify(list, null, 2), 'utf-8');
}


export function saveCaseDataRecord({ caseDataPath, sessionId, model, description }) {
  ensureCaseDataDir();
  // Python already wrote the file to scripts/case_data/, no copy needed
  const fileName = path.basename(caseDataPath);
  const recordId = fileName.replace(/\.json$/, '');

  const content = readFileSync(caseDataPath, 'utf-8');
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

  const list = loadCaseDataIndex();
  list.unshift(record);
  saveCaseDataIndex(list);

  return { record, data };
}

export function getCaseDataRecord(recordId) {
  const list = loadCaseDataIndex();
  return list.find(r => r.recordId === recordId) || null;
}

export function loadCaseDataJson(recordId) {
  const record = getCaseDataRecord(recordId);
  if (!record) return null;
  const filePath = path.join(CASE_DATA_DIR, record.fileName);
  if (!existsSync(filePath)) return null;
  try { return JSON.parse(readFileSync(filePath, 'utf-8')); } catch { return null; }
}

export function deleteCaseData(recordId) {
  const list = loadCaseDataIndex();
  const idx = list.findIndex(r => r.recordId === recordId);
  if (idx === -1) return false;

  const record = list[idx];
  const filePath = path.join(CASE_DATA_DIR, record.fileName);
  try { if (existsSync(filePath)) unlinkSync(filePath); } catch {}

  list.splice(idx, 1);
  saveCaseDataIndex(list);
  return true;
}
