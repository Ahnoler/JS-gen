/**
 * KB 需求模块作业区：登记/列表/查询 data/kb/req/<moduleKey>/ 工作区。
 */
import { access, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../http/app-error.js';

/** @typedef {'registered'|'sliced'|'drafted'} ReqModuleStatus */

/**
 * @typedef {{
 *   moduleKey: string,
 *   moduleName: string,
 *   sourcePath: string,
 *   sourceKind: 'req',
 *   status: ReqModuleStatus,
 *   note?: string,
 *   warnings: string[],
 *   createdAt: string,
 *   updatedAt: string
 * }} ReqModuleManifest
 */

/** moduleKey 合法字符：小写字母数字与连字符段。 */
export const MODULE_KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const DEFAULT_ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'kb', 'req');

function resolveRootDir(rootDir) {
  return rootDir ?? DEFAULT_ROOT_DIR;
}

/**
 * 校验 moduleKey 格式；非法时抛 VALIDATION AppError。
 * @param {string} key moduleKey 待校验值
 * @returns {void}
 */
export function assertModuleKey(key) {
  if (!MODULE_KEY_RE.test(key)) {
    throw new AppError(`Invalid moduleKey: ${key}`, { code: 'VALIDATION' });
  }
}

/**
 * 模块作业区目录绝对路径。
 * @param {string} moduleKey 模块键
 * @param {string} [rootDir] 作业区根目录（缺省=data/kb/req）
 * @returns {string} 模块目录绝对路径
 */
export function moduleDir(moduleKey, rootDir) {
  assertModuleKey(moduleKey);
  return join(resolveRootDir(rootDir), moduleKey);
}

async function isSourceAccessible(sourcePath) {
  try {
    await access(sourcePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readManifestFile(manifestPath) {
  try {
    const raw = await readFile(manifestPath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

/**
 * 登记或幂等更新需求模块作业区。
 * @param {object} opts 登记选项
 * @param {string} [opts.rootDir] 作业区根目录（缺省=data/kb/req）
 * @param {string} opts.moduleKey 模块键
 * @param {string} opts.moduleName 模块中文名
 * @param {string} opts.sourcePath 源文档路径
 * @param {string} [opts.note] 备注
 * @param {boolean} [opts.reset] 为 true 时清空 chapters/drafts 产物
 * @returns {Promise<ReqModuleManifest>} 写入后的 manifest
 */
export async function registerReqModule({
  rootDir,
  moduleKey,
  moduleName,
  sourcePath,
  note,
  reset = false,
}) {
  assertModuleKey(moduleKey);
  const modDir = moduleDir(moduleKey, rootDir);
  const manifestPath = join(modDir, 'manifest.json');
  const sourceLinkPath = join(modDir, 'source.link.json');
  const chaptersDir = join(modDir, 'chapters');
  const draftsDir = join(modDir, 'drafts');

  const existing = await readManifestFile(manifestPath);
  const now = new Date().toISOString();
  const warnings = [];
  if (!(await isSourceAccessible(sourcePath))) {
    warnings.push('sourcePath not accessible from server');
  }

  if (reset) {
    await rm(chaptersDir, { recursive: true, force: true });
    await rm(draftsDir, { recursive: true, force: true });
  }

  await mkdir(chaptersDir, { recursive: true });
  await mkdir(draftsDir, { recursive: true });

  /** @type {ReqModuleManifest} */
  const manifest = {
    moduleKey,
    moduleName,
    sourcePath,
    sourceKind: 'req',
    status: reset ? 'registered' : (existing?.status ?? 'registered'),
    warnings,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  if (note !== undefined) {
    manifest.note = note;
  } else if (existing?.note !== undefined) {
    manifest.note = existing.note;
  }

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  await writeFile(
    sourceLinkPath,
    `${JSON.stringify({ sourcePath, sourceKind: 'req' }, null, 2)}\n`,
    'utf-8',
  );

  return manifest;
}

/**
 * 列出已登记模块（跳过无 manifest 的子目录）。
 * @param {object} [opts] 查询选项
 * @param {string} [opts.rootDir] 作业区根目录（缺省=data/kb/req）
 * @returns {Promise<ReqModuleManifest[]>} manifest 列表（按 moduleKey 排序）
 */
export async function listReqModules({ rootDir } = {}) {
  const root = resolveRootDir(rootDir);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }

  const rows = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const manifest = await readManifestFile(join(root, ent.name, 'manifest.json'));
    if (manifest) rows.push(manifest);
  }
  return rows.sort((a, b) => a.moduleKey.localeCompare(b.moduleKey));
}

async function dirHasEntries(dirPath) {
  try {
    const names = await readdir(dirPath);
    return names.length > 0;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
}

async function pathExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function countDraftFiles(draftsDir) {
  try {
    const names = await readdir(draftsDir);
    return names.filter((n) => n.endsWith('.json')).length;
  } catch (e) {
    if (e.code === 'ENOENT') return 0;
    throw e;
  }
}

/**
 * 读取模块详情（manifest + 目录探测字段）。
 * @param {object} opts 查询选项
 * @param {string} [opts.rootDir] 作业区根目录（缺省=data/kb/req）
 * @param {string} opts.moduleKey 模块键
 * @returns {Promise<ReqModuleManifest & { hasChapters: boolean, hasThroughChains: boolean, draftCount: number }>} 详情
 */
export async function getReqModule({ rootDir, moduleKey }) {
  assertModuleKey(moduleKey);
  const modDir = moduleDir(moduleKey, rootDir);
  const manifest = await readManifestFile(join(modDir, 'manifest.json'));
  if (!manifest) {
    throw new AppError(`Req module not found: ${moduleKey}`, { code: 'NOT_FOUND' });
  }

  return {
    ...manifest,
    hasChapters: await dirHasEntries(join(modDir, 'chapters')),
    hasThroughChains: await pathExists(join(modDir, 'through-chains.md')),
    draftCount: await countDraftFiles(join(modDir, 'drafts')),
  };
}
