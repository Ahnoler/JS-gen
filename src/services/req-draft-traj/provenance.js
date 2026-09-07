/**
 * Req→draft-traj provenance helpers: chapter resolution and atom validation.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';

/** Match real page codes like ZJJK00107304 (ignore placeholders such as — / 主页). */
const ZJJK_CODE_RE = /ZJJK\d{5,}/gi;

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
 * Read source document path from a module directory.
 * @param {string} moduleDir Absolute module workspace path
 * @returns {Promise<string>} sourcePath from source.link.json
 */
export async function loadSourceDoc(moduleDir) {
  const raw = await readFile(join(moduleDir, 'source.link.json'), 'utf-8');
  const parsed = JSON.parse(raw);
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
    score = 100;
  } else if (normalizedFile && (normalizedFile.includes(hint) || hint.includes(normalizedFile))) {
    score = 80;
  } else if (normalizedContent.includes(hint) || hint.includes(normalizedContent.slice(0, hint.length + 20))) {
    score = 60;
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
        score = Math.max(score, 100);
      } else if (normalizedFile && (normalizedFile.includes(fragHint) || fragHint.includes(normalizedFile))) {
        score = Math.max(score, 80);
      } else if (normalizedContent.includes(fragHint)) {
        score = Math.max(score, 60);
      }
    }
  }

  if (score > 0 && isWeakOverviewChapter(fileName, title)) {
    score -= 40;
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
  let score = 100;
  if (isWeakOverviewChapter(fileName, title)) {
    score -= 50;
  }
  // "复用" mentions in query chapters should lose to the defining chapter.
  const codeIdx = content.indexOf(code);
  if (codeIdx >= 0) {
    const window = content.slice(Math.max(0, codeIdx - 40), codeIdx + code.length + 40);
    if (/复用/.test(window)) {
      score -= 25;
    }
  }
  if (chapterHint) {
    const hintBoost = scoreChapterHintMatch(fileName, content, chapterHint);
    if (hintBoost > 0) score += Math.min(30, Math.floor(hintBoost / 4));
  }
  if (actionHint) {
    const actionNorm = normalizeHint(actionHint);
    const contentNorm = normalizeHint(content);
    if (actionNorm.length >= 2 && contentNorm.includes(actionNorm.slice(0, Math.min(8, actionNorm.length)))) {
      score += 15;
    }
  }
  return score;
}

/**
 * Format `chapters/<file>#<title>` when title is available.
 * @param {string} fileName Chapter file name
 * @param {string|null} title H1 title
 * @returns {string} Chapter ref string
 */
function formatChapterRef(fileName, title) {
  if (title) {
    return `chapters/${fileName}#${title}`;
  }
  return `chapters/${fileName}`;
}

/**
 * Resolve a chapter reference under a module's chapters directory.
 * @param {object} opts Lookup options
 * @param {string} opts.chaptersDir Absolute path to chapters/
 * @param {string} [opts.chapterHint] Hint from through-chains bullet
 * @param {string} [opts.zjjk] Preferred ZJJK cell (may contain multiple codes / placeholders)
 * @param {string} [opts.actionHint] Step action or atom title for tie-break
 * @returns {Promise<string|null>} `chapters/<file>#<title>` or null
 */
export async function resolveChapterRef({
  chaptersDir,
  chapterHint = '',
  zjjk = '',
  actionHint = '',
}) {
  let entries;
  try {
    entries = await readdir(chaptersDir);
  } catch (e) {
    if (e.code === 'ENOENT') {
      return null;
    }
    throw e;
  }

  const mdFiles = entries.filter((name) => name.endsWith('.md')).sort();
  /** @type {Map<string, string>} */
  const contentByFile = new Map();
  for (const fileName of mdFiles) {
    contentByFile.set(fileName, await readFile(join(chaptersDir, fileName), 'utf-8'));
  }

  const codes = extractZjjkCodes(zjjk);
  /** @type {{ fileName: string, title: string|null, score: number }|null} */
  let bestZjjk = null;
  for (const code of codes) {
    for (const fileName of mdFiles) {
      const content = contentByFile.get(fileName) || '';
      if (!content.includes(code)) continue;
      const title = extractChapterTitle(content);
      const score = scoreZjjkChapterHit(fileName, content, code, chapterHint, actionHint);
      if (!bestZjjk || score > bestZjjk.score) {
        bestZjjk = { fileName, title, score };
      }
    }
    // First code that hits any chapter wins (preserve step primary page).
    if (bestZjjk) {
      return formatChapterRef(bestZjjk.fileName, bestZjjk.title);
    }
  }

  let bestFile = null;
  let bestTitle = null;
  let bestScore = 0;
  for (const fileName of mdFiles) {
    const content = contentByFile.get(fileName) || '';
    let score = scoreChapterHintMatch(fileName, content, chapterHint);
    if (actionHint) {
      const actionNorm = normalizeHint(actionHint);
      const contentNorm = normalizeHint(content);
      if (actionNorm.length >= 2 && contentNorm.includes(actionNorm.slice(0, Math.min(8, actionNorm.length)))) {
        score += 20;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestFile = fileName;
      bestTitle = extractChapterTitle(content);
    }
  }

  if (bestFile && bestScore > 0) {
    return formatChapterRef(bestFile, bestTitle);
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
