import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { deduplicateActionFile } from '../dedup.js';

import { PROJECT_DIR, TMP_DIR } from '../../../config/config.js';
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
      const { actionFile, preview } = req.body || {};
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

      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      let cleanPath, scriptPath;

      if (preview) {
        // Preview mode: write to temp, don't register in index
        cleanPath = path.join(TMP_DIR, `cleaned_preview_${ts}.json`);
        scriptPath = path.join(TMP_DIR, `script_preview_${ts}.js`);
      } else {
        if (!existsSync(GENERATED_DIR)) mkdirSync(GENERATED_DIR, { recursive: true });
        cleanPath = path.join(GENERATED_DIR, `cleaned_${ts}.json`);
        scriptPath = path.join(GENERATED_DIR, `script_${ts}.js`);
        writeFileSync(cleanPath, JSON.stringify(dedupedJson, null, 2), 'utf-8');
      }

      // Look for matching form snapshot file
      const actionName = path.basename(actionFile);  // action_20260625_153759.json
      const tsMatch = actionName.match(/^action_(\d{8}_\d{6})\.json$/);
      let formSnapshotArg = '';
      if (tsMatch) {
        const formPath = path.join(SCRIPTS_DIR, 'forms', `form_${tsMatch[1]}.json`);
        if (existsSync(formPath)) {
          formSnapshotArg = ` --form-snapshot "${formPath}"`;
        }
      }

      // Call Python assembler
      const assemblerPy = path.join(SCRIPTS_DIR, 'script_assembler.py');
      // Always write deduplicated JSON for the assembler to read
      if (!existsSync(cleanPath)) writeFileSync(cleanPath, JSON.stringify(dedupedJson, null, 2), 'utf-8');
      execSync(`python "${assemblerPy}" "${cleanPath}" "${scriptPath}"${formSnapshotArg}`, { encoding: 'utf-8', timeout: 30000 });

      // Read the generated script
      const script = readFileSync(scriptPath, 'utf-8');

      let testId = '', fileName = '';
      if (!preview) {
        // Register in generated index so Run/History work
        ensureGeneratedDir();
        const index = loadGeneratedIndex();
        testId = 'assembled_' + ts;
        fileName = `script_${ts}.js`;
        index.unshift({
          testId, fileName,
          description: 'Assembled from ' + path.basename(actionFile),
          url: '', steps: [],
          createdAt: new Date().toISOString(),
          fromAssemble: true,
        });
        saveGeneratedIndex(index);
      }

      res.json({
        success: true,
        testId, fileName, actionFile,
        scriptFile: scriptPath,
        script,
        stats: { original: meta.originalCount, deduped: meta.dedupedCount, removed: meta.removedCount },
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
