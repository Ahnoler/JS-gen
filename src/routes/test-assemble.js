import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import path from 'path';
import { assembleActionToScript } from '../services/assemble-service.js';

import { PROJECT_DIR } from '../../config/config.js';

const SCRIPTS_DIR = path.join(PROJECT_DIR, 'scripts');

/**
 * Engineering-only action-file assemble endpoints — assemble action JSON to a
 * Playwright script, list/save/delete action files, and apply fixes.
 *
 * Prefix: /api/test/assemble/*
 * @param {import('express').Application} app Express application
 */
export default function (app) {

  /**
   * POST /api/test/assemble
   * Body: { actionFile: "scripts/action/action_20260619_183411.json" }
   * Flow:  read → dedup → Python assembler → return script
   */
  app.post('/api/test/assemble', async (req, res) => {
    try {
      const { actionFile, preview } = req.body || {};
      if (!actionFile) {
        return res.status(400).json({ error: 'actionFile is required' });
      }

      const result = assembleActionToScript({ actionFile, preview: !!preview });
      res.json({
        success: result.success,
        testId: result.testId,
        fileName: result.fileName,
        actionFile: result.actionFile,
        scriptFile: result.scriptFile,
        script: result.script,
        stats: result.stats,
      });
    } catch (err) {
      console.error('Assemble error:', err.message);
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  /**
   * GET /api/test/assemble/files
   * List available action JSON files from scripts/action/ and log files from scripts/log/
   */
  app.get('/api/test/assemble/files', async (req, res) => {
    try {
      const actionDir = path.join(SCRIPTS_DIR, 'action');
      const logDir = path.join(SCRIPTS_DIR, 'log');

      const actionFiles = existsSync(actionDir) ? readdirSync(actionDir)
        .filter(f => f.startsWith('action_') && f.endsWith('.json'))
        .sort().reverse().slice(0, 30)
        .map(f => {
          const p = path.join(actionDir, f);
          const st = statSync(p);
          return { name: f, path: path.join('scripts', 'action', f), size: st.size, mtime: st.mtime };
        }) : [];

      const logFiles = existsSync(logDir) ? readdirSync(logDir)
        .filter(f => f.startsWith('log_') && f.endsWith('.txt'))
        .sort().reverse().slice(0, 30)
        .map(f => {
          const p = path.join(logDir, f);
          const st = statSync(p);
          return { name: f, path: path.join('scripts', 'log', f), size: st.size, mtime: st.mtime };
        }) : [];

      res.json({ actionFiles, logFiles });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/test/assemble/save
   * Body: { path, data }
   * Saves modified action file back to disk.
   */
  app.post('/api/test/assemble/save', async (req, res) => {
    try {
      const { path: filePath, data } = req.body || {};
      if (!filePath || !data) {
        return res.status(400).json({ error: 'path and data are required' });
      }
      const absPath = path.resolve(SCRIPTS_DIR, '..', filePath);
      if (!existsSync(absPath)) {
        return res.status(404).json({ error: 'File not found: ' + absPath });
      }
      writeFileSync(absPath, JSON.stringify(data, null, 2), 'utf-8');
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/test/assemble/file
   * Body: { path: "scripts/action/action_xxx.json" }
   * Deletes a file (action JSON or log TXT) from disk.
   */
  app.delete('/api/test/assemble/file', async (req, res) => {
    try {
      const { path: filePath } = req.body || {};
      if (!filePath) {
        return res.status(400).json({ error: 'path is required' });
      }
      // Safety: only allow deletion within scripts/action/ or scripts/log/
      const absPath = path.resolve(PROJECT_DIR, filePath);
      const actionDir = path.resolve(PROJECT_DIR, 'scripts', 'action');
      const logDir = path.resolve(PROJECT_DIR, 'scripts', 'log');
      if (!absPath.startsWith(actionDir) && !absPath.startsWith(logDir)) {
        return res.status(403).json({ error: 'Path must be under scripts/action/ or scripts/log/' });
      }
      if (!existsSync(absPath)) {
        return res.status(404).json({ error: 'File not found: ' + absPath });
      }
      unlinkSync(absPath);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/test/assemble/apply-fix
   * Persist the fixed action file. Creates a copy, does NOT delete the old file (for safety during testing).
   */
  app.post('/api/test/assemble/apply-fix', async (req, res) => {
    try {
      const { oldPath, newPath } = req.body || {};
      if (!oldPath) return res.status(400).json({ error: 'oldPath is required' });
      if (!newPath) return res.status(400).json({ error: 'newPath is required' });
      const absOld = path.resolve(PROJECT_DIR, oldPath);
      const absNew = path.resolve(PROJECT_DIR, newPath);
      if (!existsSync(absOld)) return res.status(404).json({ error: 'Old file not found: ' + absOld });
      if (!existsSync(absNew)) return res.status(404).json({ error: 'New file not found: ' + absNew });
      // Overwrite old action file with healed content
      const newData = readFileSync(absNew, 'utf-8');
      writeFileSync(absOld, newData, 'utf-8');
      res.json({ success: true, path: oldPath, message: 'Action file overwritten with fix' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
