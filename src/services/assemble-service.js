/**
 * Shared action-file → Playwright script assembly (used by /api/test/assemble and replay).
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { deduplicateActionFile } from '../dedup.js';
import { getInjectionCode } from '../ctrl-actions.js';
import { PROJECT_DIR, TMP_DIR } from '../../config/config.js';
import { PYTHON_EXE } from '../runtime/agent-process.js';
import { ensureGeneratedDir, loadGeneratedIndex, saveGeneratedIndex } from '../script-utils.js';

const SCRIPTS_DIR = path.join(PROJECT_DIR, 'scripts');
const GENERATED_DIR = path.join(SCRIPTS_DIR, 'generated');

/**
 * @param {object} opts
 * @param {string} opts.actionFile — relative path like scripts/action/action_db_1.json OR absolute
 * @param {boolean} [opts.preview]
 * @param {string} [opts.description]
 * @returns {{ success: true, testId: string, fileName: string, actionFile: string, scriptFile: string, script: string, stats: object, dedupedCommands: object[] }}
 */
export function assembleActionToScript({ actionFile, preview = false, description } = {}) {
  if (!actionFile) throw new Error('actionFile is required');

  const absPath = path.isAbsolute(actionFile)
    ? actionFile
    : path.resolve(SCRIPTS_DIR, '..', actionFile);
  if (!existsSync(absPath)) {
    const err = new Error('actionFile not found: ' + absPath);
    err.statusCode = 404;
    throw err;
  }

  const raw = readFileSync(absPath, 'utf-8');
  const dedupedJson = deduplicateActionFile(raw);
  const meta = dedupedJson._meta;
  const dedupedCommands = dedupedJson?.tests?.[0]?.commands || dedupedJson?.actions || [];

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  let cleanPath;
  let scriptPath;

  if (preview) {
    cleanPath = path.join(TMP_DIR, `cleaned_preview_${ts}.json`);
    scriptPath = path.join(TMP_DIR, `script_preview_${ts}.js`);
  } else {
    if (!existsSync(GENERATED_DIR)) mkdirSync(GENERATED_DIR, { recursive: true });
    cleanPath = path.join(GENERATED_DIR, `cleaned_${ts}.json`);
    scriptPath = path.join(GENERATED_DIR, `script_${ts}.js`);
    writeFileSync(cleanPath, JSON.stringify(dedupedJson, null, 2), 'utf-8');
  }

  const actionName = path.basename(absPath);
  const tsMatch = actionName.match(/^action_(\d{8}_\d{6})\.json$/);
  let formSnapshotArg = '';
  if (tsMatch) {
    const formPath = path.join(SCRIPTS_DIR, 'forms', `form_${tsMatch[1]}.json`);
    if (existsSync(formPath)) {
      formSnapshotArg = ` --form-snapshot "${formPath}"`;
    }
  }

  const ctrlInjectionPath = path.join(TMP_DIR, `ctrl_injection_${ts}.js`);
  writeFileSync(ctrlInjectionPath, getInjectionCode(), 'utf-8');

  const assemblerPy = path.join(SCRIPTS_DIR, 'script_assembler.py');
  if (!existsSync(cleanPath)) writeFileSync(cleanPath, JSON.stringify(dedupedJson, null, 2), 'utf-8');
  execSync(
    `"${PYTHON_EXE}" "${assemblerPy}" "${cleanPath}" "${scriptPath}" --ctrl-injection "${ctrlInjectionPath}"${formSnapshotArg}`,
    { encoding: 'utf-8', timeout: 30000, env: { ...process.env, PYTHONPATH: PROJECT_DIR } },
  );

  const script = readFileSync(scriptPath, 'utf-8');

  let testId = '';
  let fileName = '';
  if (!preview) {
    ensureGeneratedDir();
    const index = loadGeneratedIndex();
    testId = 'assembled_' + ts;
    fileName = `script_${ts}.js`;
    index.unshift({
      testId,
      fileName,
      description: description || ('Assembled from ' + path.basename(absPath)),
      url: '',
      steps: [],
      createdAt: new Date().toISOString(),
      fromAssemble: true,
    });
    saveGeneratedIndex(index);
  }

  return {
    success: true,
    testId,
    fileName,
    actionFile: path.isAbsolute(actionFile)
      ? path.relative(path.resolve(SCRIPTS_DIR, '..'), absPath).replace(/\\/g, '/')
      : actionFile,
    scriptFile: scriptPath,
    script,
    stats: {
      original: meta.originalCount,
      deduped: meta.dedupedCount,
      removed: meta.removedCount,
    },
    dedupedCommands,
  };
}
