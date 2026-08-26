import { readFileSync, existsSync, unlinkSync } from 'fs';
import path from 'path';
import { GENERATED_DIR } from '../../config/config.js';
import { loadGeneratedIndex, saveGeneratedIndex } from '../script-utils.js';

/**
 * Generated-script history CRUD — list, read, and delete previously assembled
 * Playwright scripts stored under the generated index.
 *
 * Prefix: /api/test/history/*
 * @param {import('express').Application} app Express application
 */
export default function (app) {
  /** List all generated-script records (brief: id, fileName, description, timestamps, stepCount). */
  app.get('/api/test/history', (req, res) => {
    const list = loadGeneratedIndex();
    const brief = list.map(r => ({
      testId: r.testId,
      fileName: r.fileName,
      description: r.description,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      stepCount: (r.steps || []).length,
    }));
    res.json(brief);
  });

  /** Get a single generated-script record by testId, including the script source. */
  app.get('/api/test/history/:testId', (req, res) => {
    const list = loadGeneratedIndex();
    const record = list.find(r => r.testId === req.params.testId);
    if (!record) return res.status(404).json({ error: 'Test record not found' });

    const filePath = path.join(GENERATED_DIR, record.fileName);
    let script = '';
    if (existsSync(filePath)) script = readFileSync(filePath, 'utf-8');

    res.json({ ...record, script });
  });

  /** Delete a generated-script record and its script file by testId. */
  app.delete('/api/test/history/:testId', (req, res) => {
    const list = loadGeneratedIndex();
    const idx = list.findIndex(r => r.testId === req.params.testId);
    if (idx === -1) return res.status(404).json({ error: 'Test record not found' });

    const record = list[idx];
    const filePath = path.join(GENERATED_DIR, record.fileName);
    if (existsSync(filePath)) unlinkSync(filePath);

    list.splice(idx, 1);
    saveGeneratedIndex(list);

    res.json({ status: 'deleted', testId: record.testId });
  });
}
