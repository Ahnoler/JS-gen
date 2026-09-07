/**
 * Req→draft-traj provenance helpers: chapter resolution and atom validation.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';

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

  if (normalizedTitle && (normalizedTitle.includes(hint) || hint.includes(normalizedTitle))) {
    return 100;
  }
  if (normalizedFile && (normalizedFile.includes(hint) || hint.includes(normalizedFile))) {
    return 80;
  }
  if (normalizedContent.includes(hint) || hint.includes(normalizedContent.slice(0, hint.length + 20))) {
    return 60;
  }
  return 0;
}

/**
 * Resolve a chapter reference under a module's chapters directory.
 * @param {object} opts Lookup options
 * @param {string} opts.chaptersDir Absolute path to chapters/
 * @param {string} [opts.chapterHint] Hint from through-chains bullet
 * @param {string} [opts.zjjk] Preferred ZJJK code to locate chapter file
 * @returns {Promise<string|null>} `chapters/<file>#<title>` or null
 */
export async function resolveChapterRef({ chaptersDir, chapterHint = '', zjjk = '' }) {
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
  const zjjkCode = String(zjjk || '').trim();

  if (zjjkCode) {
    for (const fileName of mdFiles) {
      const content = await readFile(join(chaptersDir, fileName), 'utf-8');
      if (content.includes(zjjkCode)) {
        const title = extractChapterTitle(content);
        if (title) {
          return `chapters/${fileName}#${title}`;
        }
        return `chapters/${fileName}`;
      }
    }
  }

  let bestFile = null;
  let bestTitle = null;
  let bestScore = 0;
  for (const fileName of mdFiles) {
    const content = await readFile(join(chaptersDir, fileName), 'utf-8');
    const score = scoreChapterHintMatch(fileName, content, chapterHint);
    if (score > bestScore) {
      bestScore = score;
      bestFile = fileName;
      bestTitle = extractChapterTitle(content);
    }
  }

  if (bestFile && bestScore > 0) {
    if (bestTitle) {
      return `chapters/${bestFile}#${bestTitle}`;
    }
    return `chapters/${bestFile}`;
  }

  return null;
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
