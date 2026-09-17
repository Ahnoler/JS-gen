/**
 * Orchestrate req-module parse: resolve source, extract, LLM slice, write artifacts.
 */
import { access, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, join, relative, resolve, isAbsolute } from 'node:path';
import { AppError } from '../../http/app-error.js';
import { getReqModule, moduleDir } from '../kb-req-modules.js';
import { parseThroughChainsMarkdown } from '../req-draft-traj/parse-through-chains.js';
import { PROPOSE_CACHE_FILENAME } from '../req-draft-traj/propose-cache.js';
import { extractSourceText as defaultExtract, SOURCE_TEXT_MAX_CHARS } from './extract-source-text.js';
import { sliceReqDoc } from './slice-req-doc.js';

/**
 * @typedef {{
 *   moduleKey: string,
 *   status: 'sliced',
 *   sourceDoc: string,
 *   chapterCount: number,
 *   chainCount: number,
 *   canProposeAtoms: boolean,
 *   warnings: string[],
 * }} ParseReqModuleResult
 */

/**
 * True when a path exists.
 * @param {string} filePath Path to check
 * @returns {Promise<boolean>} Whether the path exists
 */
async function pathExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve `rel` under `modDir`, rejecting path traversal.
 * @param {string} modDir Module workspace directory
 * @param {string} rel Relative path from source.link.json
 * @returns {string} Absolute path inside the module dir
 */
function resolveUnderModule(modDir, rel) {
  const abs = resolve(modDir, rel);
  const relToMod = relative(modDir, abs);
  if (!relToMod || relToMod.startsWith('..') || isAbsolute(relToMod)) {
    throw new AppError('localCopy path invalid', { code: 'VALIDATION' });
  }
  return abs;
}

/**
 * Read source.link.json if present.
 * @param {string} modDir Module workspace directory
 * @returns {Promise<object>} Parsed link object (empty on missing/invalid)
 */
async function readSourceLink(modDir) {
  try {
    return JSON.parse(await readFile(join(modDir, 'source.link.json'), 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Resolve the file to parse: prefer localCopy, else a readable sourcePath.
 * @param {string} modDir Module workspace directory
 * @param {{ sourcePath?: string }} manifest Module manifest
 * @returns {Promise<{ absPath: string, sourceDoc: string }|null>} Resolved source or null
 */
async function resolveParseSource(modDir, manifest) {
  const link = await readSourceLink(modDir);
  const localCopy = String(link.localCopy || '').trim();
  if (localCopy) {
    try {
      const abs = resolveUnderModule(modDir, localCopy);
      if (await pathExists(abs)) {
        return { absPath: abs, sourceDoc: localCopy };
      }
    } catch (e) {
      if (e instanceof AppError && e.code === 'VALIDATION') throw e;
    }
  }

  const sourcePath = String(link.sourcePath || manifest.sourcePath || '').trim();
  if (sourcePath && await pathExists(sourcePath)) {
    return { absPath: sourcePath, sourceDoc: sourcePath };
  }
  return null;
}

/**
 * Sanitize an LLM chapter fileName to a basename under chapters/.
 * @param {string} name Candidate file name
 * @param {number} index 0-based chapter index
 * @returns {string} Safe `NN-….md` basename
 */
function safeChapterFileName(name, index) {
  const base = basename(String(name || '').replace(/\\/g, '/'));
  if (base && !base.includes('..') && /^\d{2}-[^/\\]+\.md$/u.test(base)) {
    return base;
  }
  const padded = String(index + 1).padStart(2, '0');
  const slug = (base.replace(/\.md$/i, '') || 'chapter').replace(/[/\\]+/g, '-');
  return `${padded}-${slug}.md`;
}

/**
 * True when the module already has slice artifacts that parse will overwrite.
 * @param {string} modDir Module workspace directory
 * @returns {Promise<boolean>} Whether chapters/*.md or through-chains.md exist
 */
async function hasExistingSlice(modDir) {
  if (await pathExists(join(modDir, 'through-chains.md'))) return true;
  try {
    const names = await readdir(join(modDir, 'chapters'));
    return names.some((n) => n.endsWith('.md'));
  } catch {
    return false;
  }
}

/**
 * Delete existing chapter markdown files (leave the directory).
 * @param {string} chaptersDir chapters/ directory
 * @returns {Promise<void>}
 */
async function clearChapterMarkdown(chaptersDir) {
  let names;
  try {
    names = await readdir(chaptersDir);
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  await Promise.all(names.filter((n) => n.endsWith('.md')).map((n) => rm(join(chaptersDir, n), { force: true })));
}

/**
 * Delete `.draft-traj-propose.json` if present so propose cannot use a stale slice.
 * @param {string} modDir Module workspace directory
 * @returns {Promise<void>}
 */
async function deleteProposeCache(modDir) {
  try {
    await unlink(join(modDir, PROPOSE_CACHE_FILENAME));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

/**
 * Parse a req-module source into chapters + proposeable through-chains.
 * Always overwrites slice outputs; `force` is reserved (without force, warn).
 * @param {object} opts Parse options
 * @param {string} opts.moduleKey Req module key
 * @param {string} [opts.rootDir] Req modules root directory
 * @param {boolean} [opts.force] Reserved; currently still overwrites (emits slice_overwritten when artifacts exist)
 * @param {(text: string) => Promise<string>} [opts.callLLM] Injectable LLM caller (offline tests)
 * @param {(filePath: string) => Promise<{ text: string, truncated: boolean }>} [opts.extractSourceText] Injectable extractor
 * @returns {Promise<ParseReqModuleResult>} Parse result for the API envelope
 */
export async function parseReqModule({
  moduleKey,
  rootDir,
  force = false,
  callLLM,
  extractSourceText: extractFn = defaultExtract,
}) {
  const mod = await getReqModule({ rootDir, moduleKey });
  const modDir = moduleDir(moduleKey, rootDir);
  const resolved = await resolveParseSource(modDir, mod);
  if (!resolved) {
    throw new AppError('source required: upload localCopy or provide a readable sourcePath', {
      code: 'SOURCE_REQUIRED',
      status: 400,
    });
  }

  const extracted = await extractFn(resolved.absPath);
  const warnings = [];
  if (extracted.truncated || extracted.text.length >= SOURCE_TEXT_MAX_CHARS) {
    warnings.push('source_truncated');
  }

  const sliced = await sliceReqDoc({
    sourceText: extracted.text,
    moduleKey,
    callLLM,
  });

  if (!force && await hasExistingSlice(modDir)) {
    warnings.push('slice_overwritten');
  }

  const chaptersDir = join(modDir, 'chapters');
  await clearChapterMarkdown(chaptersDir);
  const writtenNames = [];
  for (let i = 0; i < sliced.chapters.length; i += 1) {
    const ch = sliced.chapters[i];
    const fileName = safeChapterFileName(ch.fileName, i);
    writtenNames.push(fileName);
    await writeFile(join(chaptersDir, fileName), ch.content.endsWith('\n') ? ch.content : `${ch.content}\n`, 'utf-8');
  }
  await writeFile(join(modDir, 'through-chains.md'), sliced.throughChainsMarkdown.endsWith('\n')
    ? sliced.throughChainsMarkdown
    : `${sliced.throughChainsMarkdown}\n`, 'utf-8');

  const { chains } = parseThroughChainsMarkdown(sliced.throughChainsMarkdown);
  const now = new Date().toISOString();
  const manifest = {
    moduleKey: mod.moduleKey,
    moduleName: mod.moduleName,
    sourcePath: mod.sourcePath,
    sourceKind: mod.sourceKind,
    status: 'sliced',
    warnings: Array.isArray(mod.warnings) ? mod.warnings : [],
    createdAt: mod.createdAt,
    updatedAt: now,
  };
  if (mod.note !== undefined) {
    manifest.note = mod.note;
  }
  await writeFile(join(modDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  await deleteProposeCache(modDir);

  return {
    moduleKey,
    status: 'sliced',
    sourceDoc: resolved.sourceDoc,
    chapterCount: writtenNames.length,
    chainCount: chains.length,
    canProposeAtoms: true,
    warnings,
  };
}
