import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

export const PORT = parseInt(process.env.PORT || '4097', 10);
export const HOST = process.env.HOST || '0.0.0.0';
export const PROJECT_DIR = process.env.PROJECT_DIR || PROJECT_ROOT;
export const GENERATED_DIR = path.join(PROJECT_DIR, 'scripts', 'generated');
export const TRAJECTORIES_DIR = path.join(PROJECT_DIR, 'scripts', 'trajectories');
export const SKILL_DIR = path.join(PROJECT_ROOT, '.opencode', 'skills', 'playwright-skill');
export const TMP_DIR = process.env.TMPDIR || process.env.TMP || process.env.TEMP || os.tmpdir();
export const DASHBOARD_DIR = PROJECT_ROOT;
