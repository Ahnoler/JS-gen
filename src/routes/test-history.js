import { readFileSync, existsSync, unlinkSync } from 'fs';
import path from 'path';
import { GENERATED_DIR } from '../config.js';
import { loadGeneratedIndex, saveGeneratedIndex } from '../script-utils.js';

export default function (app) {
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

  app.get('/api/test/history/:testId', (req, res) => {
    const list = loadGeneratedIndex();
    const record = list.find(r => r.testId === req.params.testId);
    if (!record) return res.status(404).json({ error: 'Test record not found' });

    const filePath = path.join(GENERATED_DIR, record.fileName);
    let script = '';
    if (existsSync(filePath)) script = readFileSync(filePath, 'utf-8');

    res.json({ ...record, script });
  });

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
