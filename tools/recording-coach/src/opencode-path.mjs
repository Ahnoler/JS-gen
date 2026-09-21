import fs from 'node:fs';
import path from 'node:path';

const NVM4W_OPENCODE =
  'C:\\nvm4w\\nodejs\\node_modules\\opencode-ai\\bin\\opencode.exe';

/**
 * @returns {string}
 */
function pathEnvValue() {
  return process.env.Path || process.env.PATH || '';
}

/**
 * Scan PATH for opencode.exe (Windows: .exe only, not .cmd/.ps1).
 * @returns {string | null}
 */
function scanPathForOpencodeExe() {
  const sep = process.platform === 'win32' ? ';' : ':';
  const names =
    process.platform === 'win32' ? ['opencode.exe'] : ['opencode', 'opencode.exe'];

  for (const dir of pathEnvValue().split(sep)) {
    if (!dir) continue;
    for (const name of names) {
      const full = path.join(dir, name);
      if (fs.existsSync(full)) {
        return path.resolve(full);
      }
    }
  }
  return null;
}

/**
 * Well-known install locations (nvm / node_modules next to node.exe).
 * @returns {string[]}
 */
function wellKnownOpencodePaths() {
  const nodeDir = path.dirname(process.execPath);
  const paths = [path.join(nodeDir, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe')];
  if (process.platform === 'win32' && fs.existsSync(NVM4W_OPENCODE)) {
    paths.push(NVM4W_OPENCODE);
  }
  return paths;
}

/**
 * Resolve opencode executable: OPENCODE_BIN → PATH scan → well-known fallbacks.
 * @returns {string | null}
 */
export function resolveOpencodeExe() {
  if (process.env.OPENCODE_BIN && fs.existsSync(process.env.OPENCODE_BIN)) {
    return path.resolve(process.env.OPENCODE_BIN);
  }

  const fromPath = scanPathForOpencodeExe();
  if (fromPath) return fromPath;

  for (const candidate of wellKnownOpencodePaths()) {
    if (fs.existsSync(candidate)) {
      return path.resolve(candidate);
    }
  }

  return null;
}

/**
 * Ensure opencode.exe is reachable via PATH; prepend its directory when needed.
 * Honors OPENCODE_BIN first (even when another exe is already on PATH).
 * @returns {{ exe: string, prepended: boolean }}
 */
export function ensureOpencodeOnPath() {
  const binOverride =
    process.env.OPENCODE_BIN && fs.existsSync(process.env.OPENCODE_BIN)
      ? path.resolve(process.env.OPENCODE_BIN)
      : null;

  if (binOverride) {
    const fromPath = scanPathForOpencodeExe();
    if (fromPath && path.resolve(fromPath) === binOverride) {
      return { exe: binOverride, prepended: false };
    }
    const dir = path.dirname(binOverride);
    const pathKey = process.env.Path !== undefined ? 'Path' : 'PATH';
    const current = process.env[pathKey] || '';
    const sep = process.platform === 'win32' ? ';' : ':';
    process.env[pathKey] = `${dir}${sep}${current}`;
    if (pathKey === 'Path') process.env.PATH = process.env.Path;
    else if (process.platform === 'win32') process.env.Path = process.env.PATH;
    return { exe: binOverride, prepended: true };
  }

  const fromPath = scanPathForOpencodeExe();
  if (fromPath) {
    return { exe: fromPath, prepended: false };
  }

  const exe = resolveOpencodeExe();
  if (!exe) {
    const hints = [
      'Set OPENCODE_BIN to the full path of opencode.exe',
      'or add opencode-ai/bin to your PATH',
      `or install under ${path.dirname(process.execPath)}/node_modules/opencode-ai`,
    ];
    if (process.platform === 'win32') {
      hints.push(`or install at ${NVM4W_OPENCODE}`);
    }
    throw new Error(`opencode.exe not found. ${hints.join('; ')}.`);
  }

  const dir = path.dirname(exe);
  const pathKey = process.env.Path !== undefined ? 'Path' : 'PATH';
  const current = process.env[pathKey] || '';
  const sep = process.platform === 'win32' ? ';' : ':';
  process.env[pathKey] = `${dir}${sep}${current}`;
  if (pathKey === 'Path') {
    process.env.PATH = process.env.Path;
  } else if (process.platform === 'win32') {
    process.env.Path = process.env.PATH;
  }

  return { exe, prepended: true };
}
