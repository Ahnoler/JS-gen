/**
 * Per-chain chapter excerpts for the draft-traj atomize user payload.
 * Copies existing chapter text only (H1 + 要点/first section + ZJJK windows).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractZjjkCodes, resolveChapterRef } from './provenance.js';

/** Default per-excerpt cap (JS string length; matches MAX_CHAIN_PAYLOAD_CHARS units). */
export const DEFAULT_MAX_PER_EXCERPT = 2800;

/** Marker appended when an excerpt is cut at a paragraph boundary. */
export const EXCERPT_TRUNCATED_MARK = '\n…(truncated)';

/**
 * @typedef {object} ChapterExcerpt
 * @property {string} chainId Matching through-chain id
 * @property {string} fileName Chapter file name under chapters/
 * @property {string} ref Provenance ref (`chapters/<file>#<title>`)
 * @property {string} excerpt Copied chapter window (never invented)
 */

/**
 * Parse `chapters/<file>#title` into the file name.
 * @param {string} ref resolveChapterRef ref
 * @returns {string} File name or empty string
 */
function fileNameFromRef(ref) {
  const rest = String(ref || '').replace(/\\/g, '/').replace(/^chapters\//, '');
  const hash = rest.indexOf('#');
  return (hash >= 0 ? rest.slice(0, hash) : rest).trim();
}

/**
 * Ordered unique ZJJK codes from a chain's steps.
 * @param {{ steps?: Array<{ zjjk?: string }> }} chain Through-chain
 * @returns {string[]} Codes
 */
function chainZjjkCodes(chain) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const step of chain.steps || []) {
    for (const code of extractZjjkCodes(step.zjjk)) {
      if (seen.has(code)) continue;
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

/**
 * Resolve args: first step that carries a real ZJJK, else chain hint + title.
 * @param {{ title?: string, chapterHint?: string, steps?: Array<{ zjjk?: string, action?: string }> }} chain Through-chain
 * @returns {{ chapterHint: string, zjjk: string, actionHint: string }} Resolver options
 */
function resolveOptsForChain(chain) {
  const step = (chain.steps || []).find((s) => extractZjjkCodes(s.zjjk).length > 0);
  if (step) {
    return {
      chapterHint: chain.chapterHint || '',
      zjjk: step.zjjk || '',
      actionHint: step.action || chain.title || '',
    };
  }
  return {
    chapterHint: chain.chapterHint || '',
    zjjk: '',
    actionHint: chain.title || '',
  };
}

/**
 * First markdown H1 line, or empty.
 * @param {string} content Chapter markdown
 * @returns {string} H1 line
 */
function findH1Line(content) {
  const match = String(content || '').match(/^#\s+.+$/m);
  return match ? match[0].trim() : '';
}

/**
 * Slice from a heading through the next same-or-higher `## ` heading.
 * @param {string} content Chapter markdown
 * @param {RegExp} headingRe Heading matcher (sticky not required; `m` flag expected)
 * @returns {string} Section text including the heading
 */
function extractSection(content, headingRe) {
  const text = String(content || '');
  const match = text.match(headingRe);
  if (!match || match.index == null) {
    return '';
  }
  const start = match.index;
  const after = start + match[0].length;
  const rest = text.slice(after);
  const next = rest.search(/\n##\s+/);
  const body = next >= 0 ? text.slice(start, after + next) : text.slice(start);
  return body.trim();
}

/**
 * `## 要点摘要` when present, else the first `## ` section, else intro under H1.
 * @param {string} content Chapter markdown
 * @returns {string} Preferred lead section
 */
function firstSubstantiveSection(content) {
  const yaodian = extractSection(content, /^##\s+要点摘要\s*$/m);
  if (yaodian) {
    return yaodian;
  }
  const firstH2 = extractSection(content, /^##\s+.+$/m);
  if (firstH2) {
    return firstH2;
  }
  const text = String(content || '');
  const h1 = text.match(/^#\s+.+$/m);
  if (!h1 || h1.index == null) {
    return '';
  }
  const afterH1 = text.slice(h1.index + h1[0].length);
  const nextH2 = afterH1.search(/\n##\s+/);
  return (nextH2 >= 0 ? afterH1.slice(0, nextH2) : afterH1).trim();
}

/**
 * Paragraphs (blank-line separated) that mention any of the given ZJJK codes.
 * @param {string} content Chapter markdown
 * @param {string[]} codes ZJJK codes
 * @returns {string[]} Matching paragraphs in file order
 */
function zjjkWindows(content, codes) {
  if (!codes.length) {
    return [];
  }
  return String(content || '')
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter((para) => para && codes.some((code) => para.includes(code)));
}

/**
 * Append a unique chunk (skip if already contained in assembled text).
 * @param {string[]} chunks Accumulator
 * @param {string} piece Candidate text
 */
function pushUniqueChunk(chunks, piece) {
  const chunk = String(piece || '').trim();
  if (!chunk) {
    return;
  }
  const hay = chunks.join('\n\n');
  if (hay.includes(chunk)) {
    return;
  }
  chunks.push(chunk);
}

/**
 * Trim at the last paragraph/line boundary before maxChars; mark if cut.
 * @param {string} text Source excerpt
 * @param {number} maxChars Inclusive budget for kept body (marker may extend length)
 * @returns {string} Possibly truncated excerpt
 */
export function trimExcerptAtParagraph(text, maxChars) {
  const src = String(text || '');
  if (!Number.isFinite(maxChars) || maxChars < 0 || src.length <= maxChars) {
    return src;
  }
  if (maxChars === 0) {
    return '';
  }
  let cut = src.slice(0, maxChars);
  const lastBreak = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('\n'));
  if (lastBreak >= Math.floor(maxChars * 0.4)) {
    cut = cut.slice(0, lastBreak);
  }
  return `${cut.trimEnd()}${EXCERPT_TRUNCATED_MARK}`;
}

/**
 * Build a projection-only excerpt from one chapter file.
 * @param {string} content Chapter markdown
 * @param {string[]} [zjjkCodes] Codes from the matching chain's steps
 * @param {number} [maxChars] Per-excerpt cap
 * @returns {string} Copied window
 */
export function excerptChapterContent(content, zjjkCodes = [], maxChars = DEFAULT_MAX_PER_EXCERPT) {
  const text = String(content || '');
  const h1 = findH1Line(text);
  let section = firstSubstantiveSection(text);
  if (h1 && section) {
    if (section === h1) {
      section = '';
    } else if (section.startsWith(`${h1}\n`)) {
      section = section.slice(h1.length).trim();
    }
  }
  const chunks = [];
  pushUniqueChunk(chunks, h1);
  pushUniqueChunk(chunks, section);
  for (const win of zjjkWindows(text, zjjkCodes)) {
    pushUniqueChunk(chunks, win);
  }
  return trimExcerptAtParagraph(chunks.join('\n\n'), maxChars);
}

/**
 * Shrink excerpts to an aggregate character budget, shortest chains first.
 * @param {ChapterExcerpt[]} excerpts Per-chain excerpts
 * @param {Array<{ chainId: string, steps?: unknown[] }>} [chains] Chains (for step counts)
 * @param {number} maxTotal Sum of excerpt string lengths
 * @returns {ChapterExcerpt[]} Possibly shortened copies (empty excerpts dropped)
 */
export function shrinkExcerptsToTotal(excerpts, chains = [], maxTotal) {
  const copy = (excerpts || []).map((e) => ({ ...e }));
  if (!Number.isFinite(maxTotal) || maxTotal < 0) {
    return copy;
  }
  const stepCount = new Map((chains || []).map((c) => [c.chainId, (c.steps || []).length]));
  const totalLen = () => copy.reduce((n, e) => n + String(e.excerpt || '').length, 0);
  if (totalLen() <= maxTotal) {
    return copy.filter((e) => String(e.excerpt || '').length > 0);
  }
  const order = copy
    .map((e, i) => ({
      i,
      steps: stepCount.get(e.chainId) ?? 0,
      len: String(e.excerpt || '').length,
    }))
    .sort((a, b) => a.steps - b.steps || a.len - b.len);
  const caps = [Math.min(1400, maxTotal), 700, 350, 120, 0];
  for (const cap of caps) {
    if (totalLen() <= maxTotal) {
      break;
    }
    for (const { i } of order) {
      if (totalLen() <= maxTotal) {
        break;
      }
      const cur = String(copy[i].excerpt || '');
      if (cur.length <= cap) {
        continue;
      }
      copy[i] = {
        ...copy[i],
        excerpt: cap === 0 ? '' : trimExcerptAtParagraph(cur, cap),
      };
    }
  }
  return copy.filter((e) => String(e.excerpt || '').length > 0);
}

/**
 * Resolve one excerpt per chain via existing `resolveChapterRef` (no second matcher).
 * @param {object} opts Builder options
 * @param {Array<{ chainId: string, title?: string, chapterHint?: string, steps?: Array<{ zjjk?: string, action?: string }> }>} opts.chains Through-chains
 * @param {string} opts.chaptersDir Absolute path to module `chapters/`
 * @param {number} [opts.maxPerExcerpt] Per-excerpt cap (default 2800)
 * @param {number} [opts.maxTotal] Optional aggregate excerpt-text budget
 * @returns {Promise<ChapterExcerpt[]>} Per-chain excerpts; `[]` when dir missing/empty/unmatched
 */
export async function buildChapterExcerpts({
  chains = [],
  chaptersDir,
  maxPerExcerpt = DEFAULT_MAX_PER_EXCERPT,
  maxTotal,
} = {}) {
  if (!chaptersDir) {
    return [];
  }
  /** @type {ChapterExcerpt[]} */
  const result = [];
  for (const chain of chains) {
    if (!chain || !chain.chainId) {
      continue;
    }
    let resolved;
    try {
      resolved = await resolveChapterRef({
        chaptersDir,
        ...resolveOptsForChain(chain),
      });
    } catch (e) {
      if (e && e.code === 'ENOENT') {
        return [];
      }
      throw e;
    }
    if (!resolved) {
      continue;
    }
    const fileName = fileNameFromRef(resolved.ref);
    if (!fileName) {
      continue;
    }
    let content = '';
    try {
      content = await readFile(join(chaptersDir, fileName), 'utf-8');
    } catch (e) {
      if (e && e.code === 'ENOENT') {
        continue;
      }
      throw e;
    }
    const excerpt = excerptChapterContent(content, chainZjjkCodes(chain), maxPerExcerpt);
    if (!excerpt) {
      continue;
    }
    result.push({
      chainId: chain.chainId,
      fileName,
      ref: resolved.ref,
      excerpt,
    });
  }
  if (Number.isFinite(maxTotal)) {
    return shrinkExcerptsToTotal(result, chains, maxTotal);
  }
  return result;
}
