import { spawn } from 'child_process';
import { buildPythonSubprocessEnv, PLAYWRIGHT_BROWSERS_PATH, PYTHON_EXE } from '../executor/config.js';

const py = process.argv[2] || PYTHON_EXE;
console.log('PYTHON_EXE', py);
console.log('PLAYWRIGHT_BROWSERS_PATH', PLAYWRIGHT_BROWSERS_PATH);

const code = `
from playwright.sync_api import sync_playwright
p = sync_playwright().start()
b = p.chromium.launch(headless=True)
print('launch ok')
b.close()
p.stop()
`;

const child = spawn(py, ['-c', code], {
  env: buildPythonSubprocessEnv(),
  stdio: 'inherit',
});

child.on('exit', (c) => process.exit(c ?? 1));
