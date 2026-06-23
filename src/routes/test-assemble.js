import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { deduplicateActionFile } from '../dedup.js';

import { PROJECT_DIR } from '../config.js';
import { ensureGeneratedDir, loadGeneratedIndex, saveGeneratedIndex } from '../script-utils.js';

const SCRIPTS_DIR = path.join(PROJECT_DIR, 'scripts');
const GENERATED_DIR = path.join(SCRIPTS_DIR, 'generated');

export default function (app) {

  /**
   * POST /api/test/assemble
   * Body: { actionFile: "scripts/action/action_20260619_183411.json" }
   * Flow:  read → dedup → Python assembler → return script
   */
  app.post('/api/test/assemble', async (req, res) => {
    try {
      const { actionFile } = req.body || {};
      if (!actionFile) {
        return res.status(400).json({ error: 'actionFile is required' });
      }

      // Resolve the action file path
      const absPath = path.resolve(SCRIPTS_DIR, '..', actionFile);
      if (!existsSync(absPath)) {
        return res.status(404).json({ error: 'actionFile not found: ' + absPath });
      }

      // Read and deduplicate
      const raw = readFileSync(absPath, 'utf-8');
      const dedupedJson = deduplicateActionFile(raw);
      const meta = dedupedJson._meta;

      // Write deduplicated file
      if (!existsSync(GENERATED_DIR)) {
        mkdirSync(GENERATED_DIR, { recursive: true });
      }
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const cleanPath = path.join(GENERATED_DIR, `cleaned_${ts}.json`);
      writeFileSync(cleanPath, JSON.stringify(dedupedJson, null, 2), 'utf-8');

      // Call Python assembler
      const scriptPath = path.join(GENERATED_DIR, `script_${ts}.js`);
      const assemblerPy = path.join(SCRIPTS_DIR, 'script_assembler.py');

      const cmd = `python "${assemblerPy}" "${cleanPath}" "${scriptPath}"`;
      execSync(cmd, { encoding: 'utf-8', timeout: 30000 });

      // Read the generated script
      const script = readFileSync(scriptPath, 'utf-8');

      // Register in generated index so Run/History work
      ensureGeneratedDir();
      const index = loadGeneratedIndex();
      const testId = 'assembled_' + ts;
      const addItem = {
        testId,
        fileName: `script_${ts}.js`,
        description: 'Assembled from ' + path.basename(actionFile),
        url: '',
        steps: [],
        createdAt: new Date().toISOString(),
        fromAssemble: true,
      };
      index.unshift(addItem);
      saveGeneratedIndex(index);

      res.json({
        success: true,
        testId,
        fileName: `script_${ts}.js`,
        actionFile,
        scriptFile: scriptPath,
        script,
        stats: {
          original: meta.originalCount,
          deduped: meta.dedupedCount,
          removed: meta.removedCount,
        },
      });

    } catch (err) {
      console.error('Assemble error:', err.message);
      res.status(500).json({ error: err.message });
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
}
