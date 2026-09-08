/**
 * Req→draft-traj provenance helpers: chapter resolution and atom validation.
 */
import { createHash } from 'node:crypto';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';

/** Match real page codes like ZJJK00107304 (ignore placeholders such as — / 主页). */
const ZJJK_CODE_RE = /ZJJK\d{5,}/gi;

/**
 * Chapter scoring weights (named per spec §7.3 — explainable, ordered
 * ZJJK hit > title hit > filename hit > content hit; penalties documented inline).
 */
const SCORE_ZJJK_HIT = 100;
const SCORE_TITLE_HIT = 100;
const SCORE_FILE_HIT = 80;
const SCORE_CONTENT_HIT = 60;
const PENALTY_WEAK_OVERVIEW_ZJJK = 50;
const PENALTY_WEAK_OVERVIEW_HINT = 40;
const PENALTY_REUSE_MENTION = 25;
const BOOST_ZJJK_HINT_MAX = 30;
const BOOST_ZJJK_ACTION_HINT = 15;
const BOOST_HINT_ACTION_HINT = 20;

/** Chapter content cache: chaptersDir → { signature, files }; bounded LRU. */
const CHAPTER_CACHE_LIMIT = 64;
/** @type {Map<string, { signature: string, files: Array<{ fileName: string, content: string, title: string|null }> }>} */
const chapterCache = new Map();

/**
 * List chapter .md files with content, cached per chapters directory keyed by
 * file-name+mtime signature (propose resolves one chapter per atom — without
 * the cache that is N atoms × M chapter file reads, spec F-16).
 * @param {string} chaptersDir Absolute path to chapters/
 * @returns {Promise<Array<{ fileName: string, content: string, title: string|null }>>} Chapter entries sorted by file name
 */
async function listChapterFiles(chaptersDir) {
  const entries = await readdir(chaptersDir);
  const mdNames = entries.filter((name) => name.endsWith('.md')).sort();
  const stats = await Promise.all(mdNames.map((name) => stat(join(chaptersDir, name)).catch(() => null)));
  const signature = mdNames
    .map((name, i) => `${name}:${stats[i] ? stats[i].mtimeMs : 'x'}:${stats[i] ? stats[i].size : 'x'}`)
    .join('|');

  const cached = chapterCache.get(chaptersDir);
  if (cached && cached.signature === signature) {
    chapterCache.delete(chaptersDir);
    chapterCache.set(chaptersDir, cached);
    return cached.files;
  }

  const files = [];
  for (let i = 0; i < mdNames.length; i += 1) {
    if (!stats[i]) continue;
    const content = await readFile(join(chaptersDir, mdNames[i]), 'utf-8');
    files.push({ fileName: mdNames[i], content, title: extractChapterTitle(content) });
  }
  chapterCache.set(chaptersDir, { signature, files });
  if (chapterCache.size > CHAPTER_CACHE_LIMIT) {
    const oldest = chapterCache.keys().next().value;
    chapterCache.delete(oldest);
  }
  return files;
}

/**
 * Extract ordered unique ZJJK codes from a through-chains ZJJK cell
 * (supports multi-code cells like `ZJJK00136564 / ZJJK00136733`).
 * @param {string} raw Raw ZJJK cell text
 * @returns {string[]} Uppercased unique codes in appearance order
 */
export function extractZjjkCodes(raw) {
  const text = String(raw || '');
  const found = text.match(ZJJK_CODE_RE) || [];
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const code of found) {
    const normalized = code.toUpperCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/**
 * Read source document path from a module directory. Prefers the local copy
 * uploaded via POST …/source (relative `source/<name>` path keeps the module
 * self-contained); falls back to the legacy sourcePath when no copy exists.
 * @param {string} moduleDir Absolute module workspace path
 * @returns {Promise<string>} Relative local-copy path or legacy sourcePath
 */
export async function loadSourceDoc(moduleDir) {
  const raw = await readFile(join(moduleDir, 'source.link.json'), 'utf-8');
  const parsed = JSON.parse(raw);
  const localCopy = String(parsed.localCopy || '').trim();
  if (localCopy) {
    try {
      await access(join(moduleDir, localCopy));
      return localCopy;
    } catch {
      // fall through to legacy sourcePath
    }
  }
  return String(parsed.sourcePath || '').trim();
}

/**
 * Extract the first markdown H1 title from chapter content.
 * @param {string} content Chapter markdown
 * @returns {string|null} Title text or null
 */
function extractChapterTitle(content) {
  const match = String(content || '').match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Normalize chapter hint text for fuzzy matching.
 * @param {string} hint Chapter hint or filename fragment
 * @returns {string} Normalized hint
 */
function normalizeHint(hint) {
  return String(hint || '')
    .replace(/§/g, '')
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[\s\u3000_-]+/g, '')
    .toLowerCase();
}

/**
 * True when a chapter is a weak provenance target (overview / empty shell).
 * @param {string} fileName Chapter file name
 * @param {string} [title] Chapter H1 title
 * @returns {boolean} Whether the chapter should be down-ranked
 */
function isWeakOverviewChapter(fileName, title = '') {
  const blob = normalizeHint(`${fileName} ${title}`);
  return /总体概述|overview|总述/.test(blob);
}

/**
 * Score how well a chapter file matches a hint (higher is better).
 * @param {string} fileName Chapter file name
 * @param {string} content Chapter file content
 * @param {string} chapterHint Hint from through-chains bullet
 * @returns {number} Match score
 */
function scoreChapterHintMatch(fileName, content, chapterHint) {
  const hint = normalizeHint(chapterHint);
  if (!hint) {
    return 0;
  }
  const title = extractChapterTitle(content) || '';
  const normalizedTitle = normalizeHint(title);
  const normalizedFile = normalizeHint(basename(fileName, '.md'));
  const normalizedContent = normalizeHint(content);

  let score = 0;
  if (normalizedTitle && (normalizedTitle.includes(hint) || hint.includes(normalizedTitle))) {
    score = SCORE_TITLE_HIT;
  } else if (normalizedFile && (normalizedFile.includes(hint) || hint.includes(normalizedFile))) {
    score = SCORE_FILE_HIT;
  } else if (normalizedContent.includes(hint) || hint.includes(normalizedContent.slice(0, hint.length + 20))) {
    score = SCORE_CONTENT_HIT;
  }

  // Multi-§ chain hints: score the best fragment (e.g. "配置产品信息" beats overview noise).
  if (score === 0 && (/[→;；|]/.test(chapterHint) || String(chapterHint).includes('§'))) {
    const fragments = String(chapterHint)
      .split(/[§→;；|/]/)
      .map((f) => f.trim())
      .filter((f) => f.length >= 2);
    for (const frag of fragments) {
      // Direct fragment score only — avoid re-entering multi-§ recursion.
      const fragHint = normalizeHint(frag);
      if (!fragHint) continue;
      if (normalizedTitle && (normalizedTitle.includes(fragHint) || fragHint.includes(normalizedTitle))) {
        score = Math.max(score, SCORE_TITLE_HIT);
      } else if (normalizedFile && (normalizedFile.includes(fragHint) || fragHint.includes(normalizedFile))) {
        score = Math.max(score, SCORE_FILE_HIT);
      } else if (normalizedContent.includes(fragHint)) {
        score = Math.max(score, SCORE_CONTENT_HIT);
      }
    }
  }

  if (score > 0 && isWeakOverviewChapter(fileName, title)) {
    score -= PENALTY_WEAK_OVERVIEW_HINT;
  }
  return score;
}

/**
 * Score a chapter that already contains a ZJJK code.
 * Prefer primary definition chapters over overview / 复用-only mentions.
 * @param {string} fileName Chapter file name
 * @param {string} content Chapter content
 * @param {string} code ZJJK code
 * @param {string} [chapterHint] Chain-level hint
 * @param {string} [actionHint] Step action / atom title
 * @returns {number} Rank score
 */
function scoreZjjkChapterHit(fileName, content, code, chapterHint = '', actionHint = '') {
  const title = extractChapterTitle(content) || '';
  let score = SCORE_ZJJK_HIT;
  if (isWeakOverviewChapter(fileName, title)) {
    score -= PENALTY_WEAK_OVERVIEW_ZJJK;
  }
  // "复用" mentions in query chapters should lose to the defining chapter.
  const codeIdx = content.indexOf(code);
  if (codeIdx >= 0) {
    const window = content.slice(Math.max(0, codeIdx - 40), codeIdx + code.length + 40);
    if (/复用/.test(window)) {
      score -= PENALTY_REUSE_MENTION;
    }
  }
  if (chapterHint) {
    const hintBoost = scoreChapterHintMatch(fileName, content, chapterHint);
    if (hintBoost > 0) score += Math.min(BOOST_ZJJK_HINT_MAX, Math.floor(hintBoost / 4));
  }
  if (actionHint) {
    const actionNorm = normalizeHint(actionHint);
    const contentNorm = normalizeHint(content);
    if (actionNorm.length >= 2 && contentNorm.includes(actionNorm.slice(0, Math.min(8, actionNorm.length)))) {
      score += BOOST_ZJJK_ACTION_HINT;
    }
  }
  return score;
}

/**
 * Format `chapters/<file>#<title>` when title is available.
 * @param {string} fileName Chapter file name
 * @param {string|null} title Chapter H1 title
 * @returns {string} Chapter ref string
 */
function formatChapterRef(fileName, title) {
  if (title) {
    return `chapters/${fileName}#${title}`;
  }
  return `chapters/${fileName}`;
}

/**
 * Build the full provenance anchor: human ref plus stable machine anchor
 * (chunkId = `<file-stem>#<h1-slug>` with normalizeHint rules; sourceHash =
 * sha256 of the chapter content at resolution time — spec D2 Phase 1).
 * @param {string} fileName Chapter file name
 * @param {string|null} title Chapter H1 title
 * @param {string} content Chapter file content
 * @returns {{ ref: string, chunkId: string, sourceHash: string }} Anchor object
 */
function chapterAnchor(fileName, title, content) {
  const stem = basename(fileName, '.md');
  const slug = normalizeHint(title || stem) || stem;
  return {
    ref: formatChapterRef(fileName, title),
    chunkId: `${stem}#${slug}`,
    sourceHash: createHash('sha256').update(content, 'utf8').digest('hex'),
  };
}

/**
 * Resolve a chapter reference under a module's chapters directory.
 * @param {object} opts Lookup options
 * @param {string} opts.chaptersDir Absolute path to chapters/
 * @param {string} [opts.chapterHint] Hint from through-chains bullet
 * @param {string} [opts.zjjk] Preferred ZJJK cell (may contain multiple codes / placeholders)
 * @param {string} [opts.actionHint] Step action or atom title for tie-break
 * @returns {Promise<{ ref: string, chunkId: string, sourceHash: string }|null>} Anchor to the resolved chapter or null
 */
export async function resolveChapterRef({
  chaptersDir,
  chapterHint = '',
  zjjk = '',
  actionHint = '',
}) {
  /** @type {Array<{ fileName: string, content: string, title: string|null }>} */
  let chapterFiles;
  try {
    chapterFiles = await listChapterFiles(chaptersDir);
  } catch (e) {
    if (e.code === 'ENOENT') {
      return null;
    }
    throw e;
  }

  const codes = extractZjjkCodes(zjjk);
  /** @type {{ fileName: string, title: string|null, score: number }|null} */
  let bestZjjk = null;
  for (const code of codes) {
    for (const chapter of chapterFiles) {
      const { fileName, content, title } = chapter;
      if (!content.includes(code)) continue;
      const score = scoreZjjkChapterHit(fileName, content, code, chapterHint, actionHint);
      if (!bestZjjk || score > bestZjjk.score) {
        bestZjjk = { fileName, title, score };
      }
    }
    // First code that hits any chapter wins (preserve step primary page).
    if (bestZjjk) {
      const best = chapterFiles.find((c) => c.fileName === bestZjjk.fileName);
      return chapterAnchor(bestZjjk.fileName, bestZjjk.title, best ? best.content : '');
    }
  }

  let bestFile = null;
  let bestTitle = null;
  let bestScore = 0;
  for (const { fileName, content } of chapterFiles) {
    let score = scoreChapterHintMatch(fileName, content, chapterHint);
    if (actionHint) {
      const actionNorm = normalizeHint(actionHint);
      const contentNorm = normalizeHint(content);
      if (actionNorm.length >= 2 && contentNorm.includes(actionNorm.slice(0, Math.min(8, actionNorm.length)))) {
        score += BOOST_HINT_ACTION_HINT;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestFile = fileName;
      bestTitle = extractChapterTitle(content);
    }
  }

  if (bestFile && bestScore > 0) {
    const best = chapterFiles.find((c) => c.fileName === bestFile);
    return chapterAnchor(bestFile, bestTitle, best ? best.content : '');
  }

  return null;
}

/**
 * Replace LLM provenance placeholders in taskDraft with resolved values.
 * @param {string} taskDraft Raw task draft (may contain `<sourceDoc>` / `<sourceChapter>`)
 * @param {string} sourceDoc Resolved source document path
 * @param {string} sourceChapter Resolved chapter ref
 * @returns {string} Task draft with placeholders filled
 */
export function fillTaskDraftProvenancePlaceholders(taskDraft, sourceDoc, sourceChapter) {
  let text = String(taskDraft || '');
  const doc = String(sourceDoc || '').trim();
  const chapter = String(sourceChapter || '').trim();
  if (doc) {
    text = text.split('<sourceDoc>').join(doc);
  }
  if (chapter) {
    text = text.split('<sourceChapter>').join(chapter);
  }
  return text.trim();
}

/**
 * Validate that an atom candidate has complete provenance fields.
 * @param {object} atom Atom candidate
 * @param {string} [atom.atomKey] Stable atom key
 * @param {string} [atom.sourceDoc] Source document path
 * @param {string} [atom.sourceChapter] Chapter reference
 * @param {string} [atom.taskDraft] Task text for analyze
 * @returns {{ ok: true } | { ok: false, reason: string }} Validation result with reason when invalid
 */
export function assertAtomProvenance(atom) {
  const atomKey = String(atom?.atomKey || '').trim();
  const sourceDoc = String(atom?.sourceDoc || '').trim();
  const sourceChapter = String(atom?.sourceChapter || '').trim();
  const taskDraft = String(atom?.taskDraft || '').trim();

  if (!atomKey) {
    return { ok: false, reason: 'missing_atom_key' };
  }
  if (!sourceDoc) {
    return { ok: false, reason: 'missing_source_doc' };
  }
  if (!sourceChapter) {
    return { ok: false, reason: 'missing_source_chapter' };
  }
  if (!taskDraft) {
    return { ok: false, reason: 'empty_task_draft' };
  }
  return { ok: true };
}
