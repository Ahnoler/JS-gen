/**
 * Parse req-module through-chains markdown into structured chain/step data.
 */

/**
 * @typedef {{
 *   index: number,
 *   action: string,
 *   page?: string,
 *   zjjk?: string,
 *   buttons?: string,
 * }} ThroughChainStep
 */

/**
 * @typedef {{
 *   chainId: string,
 *   title: string,
 *   chapterHint: string,
 *   steps: ThroughChainStep[],
 * }} ThroughChain
 */

/**
 * Slugify a short label for stable atom keys (preserves CJK letters/digits).
 * @param {string} value Raw label
 * @returns {string} Slug fragment
 */
function slugPart(value) {
  return String(value || '')
    .trim()
    .replace(/[\s\u3000]+/g, '-')
    .replace(/[【】→]/g, '')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/**
 * Derive chainId from a `### 主链 X：…` heading line.
 * @param {string} headingLine Markdown heading without leading hashes
 * @returns {string} chain slug such as `chain-a`
 */
function chainIdFromHeading(headingLine) {
  const letterMatch = headingLine.match(/主链\s*([A-Za-z0-9]+)/);
  if (letterMatch) {
    return `chain-${String(letterMatch[1]).toLowerCase()}`;
  }
  return slugPart(headingLine) || 'chain';
}

/**
 * Split a markdown table row into trimmed cell values.
 * @param {string} line Table row line
 * @returns {string[]} Trimmed cell values for the row
 */
function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/**
 * True when a markdown table row is a separator (---).
 * @param {string} line Table row line
 * @returns {boolean} True when every cell is a markdown separator
 */
function isTableSeparator(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

/**
 * Map table header labels to canonical column keys.
 * @param {string[]} headers Header cell labels
 * @returns {Record<number, 'index'|'action'|'page'|'zjjk'|'buttons'>} Column index map
 */
function mapTableColumns(headers) {
  /** @type {Record<number, 'index'|'action'|'page'|'zjjk'|'buttons'>} */
  const map = {};
  headers.forEach((header, idx) => {
    if (/^#\s*$|^序号$/.test(header)) {
      map[idx] = 'index';
    } else if (/步骤/.test(header)) {
      map[idx] = 'action';
    } else if (/页面|弹窗/.test(header)) {
      map[idx] = 'page';
    } else if (/ZJJK/i.test(header)) {
      map[idx] = 'zjjk';
    } else if (/按钮/.test(header)) {
      map[idx] = 'buttons';
    }
  });
  return map;
}

/**
 * Parse a markdown table block into step rows.
 * @param {string[]} lines Table lines including header and separator
 * @returns {ThroughChainStep[]} Parsed step rows (empty when table invalid)
 */
function parseStepsTable(lines) {
  if (lines.length < 2) {
    return [];
  }

  const headers = splitTableRow(lines[0]);
  const columnMap = mapTableColumns(headers);
  const hasRequiredColumns = Object.values(columnMap).includes('action')
    && Object.values(columnMap).includes('zjjk');
  if (!hasRequiredColumns) {
    return [];
  }

  /** @type {ThroughChainStep[]} */
  const steps = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim().startsWith('|') || isTableSeparator(line)) {
      continue;
    }
    const cells = splitTableRow(line);
    /** @type {ThroughChainStep} */
    const step = { index: steps.length + 1, action: '' };
    for (const [idxText, key] of Object.entries(columnMap)) {
      const idx = Number(idxText);
      const value = cells[idx] ?? '';
      if (key === 'index') {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) {
          step.index = parsed;
        }
      } else if (key === 'action') {
        step.action = value;
      } else if (key === 'page' && value) {
        step.page = value;
      } else if (key === 'zjjk' && value) {
        step.zjjk = value;
      } else if (key === 'buttons' && value) {
        step.buttons = value;
      }
    }
    if (step.action) {
      steps.push(step);
    }
  }
  return steps;
}

/**
 * Parse through-chains markdown into chain metadata and table steps.
 * @param {string} md Raw markdown
 * @returns {{ chains: ThroughChain[] }} Parsed chains with table steps
 */
export function parseThroughChainsMarkdown(md) {
  const lines = String(md || '').split(/\r?\n/);
  /** @type {ThroughChain[]} */
  const chains = [];
  /** @type {ThroughChain|null} */
  let current = null;
  /** @type {string[]} */
  let tableLines = [];

  const flushTable = () => {
    if (!current || tableLines.length === 0) {
      tableLines = [];
      return;
    }
    const steps = parseStepsTable(tableLines);
    if (steps.length > 0) {
      current.steps = steps;
      chains.push(current);
    }
    current = null;
    tableLines = [];
  };

  for (const line of lines) {
    const chainHeading = line.match(/^###\s+(.+)$/);
    if (chainHeading) {
      flushTable();
      const title = chainHeading[1].trim();
      current = {
        chainId: chainIdFromHeading(title),
        title,
        chapterHint: '',
        steps: [],
      };
      continue;
    }

    if (current) {
      const chapterMatch = line.match(/章节出处\*{0,2}\s*[：:]\s*(.+)$/);
      if (chapterMatch) {
        current.chapterHint = chapterMatch[1].trim();
        continue;
      }

      if (line.trim().startsWith('|')) {
        tableLines.push(line);
        continue;
      }
    }

    if (tableLines.length > 0 && !line.trim().startsWith('|')) {
      flushTable();
    }
  }

  flushTable();
  return { chains };
}

/**
 * True when through-chains markdown yields at least one parsed table step
 * (draft-traj propose needs structured step tables, not prose-only lists).
 * @param {string} md Raw through-chains.md content
 * @returns {boolean} Whether propose can produce structured atom candidates
 */
export function hasProposeableChainSteps(md) {
  const { chains } = parseThroughChainsMarkdown(md);
  return chains.some((c) => Array.isArray(c.steps) && c.steps.length > 0);
}

/**
 * Build a stable title-independent atom key for propose/commit idempotency.
 * Key shape `<module-slug>:<chain-slug>:<step-index>`; invalid stepIndex → 0.
 * Title is deliberately excluded: LLM re-runs rephrase titles, and a rephrased
 * title must not produce a new atom identity (spec F-01).
 * @param {object} opts Atom identity fields
 * @param {string} opts.moduleKey Req module key
 * @param {string} opts.chainId Parsed chain id
 * @param {number} [opts.stepIndex] 1-based step index
 * @returns {string} Stable atom key
 */
export function buildAtomKey({ moduleKey, chainId, stepIndex }) {
  const mod = slugPart(moduleKey);
  const chain = slugPart(chainId);
  const idx = Number(stepIndex);
  const step = Number.isFinite(idx) ? String(idx) : '0';
  return `${mod}:${chain}:${step}`;
}
