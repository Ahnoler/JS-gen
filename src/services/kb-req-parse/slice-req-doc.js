/**
 * LLM slice of a req-module source document into chapters + through-chains.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../http/app-error.js';
import { callLLM as defaultCallLLM } from '../../llm-utils.js';
import { parseLlmJsonObject } from '../operation-component-signature.js';
import { hasProposeableChainSteps } from '../req-draft-traj/parse-through-chains.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, '../../../scripts/prompts/req-module-parse-prompt.md');

/** Parse LLM may run 1–3+ minutes; longer than the default 120s chat timeout. */
export const PARSE_LLM_TIMEOUT_MS = 180_000;

/**
 * Load the req-module parse system prompt from disk.
 * @returns {string} Prompt text
 */
function loadParsePrompt() {
  if (existsSync(PROMPT_PATH)) {
    return readFileSync(PROMPT_PATH, 'utf-8');
  }
  return '你是需求分册切片助手。只输出 JSON：{"chapters":[{"fileName":"01-slug.md","content":"..."}],"throughChainsMarkdown":"..."}';
}

/**
 * Ask the LLM to slice source text into chapters + proposeable through-chains.
 * @param {object} opts Slice options
 * @param {string} opts.sourceText Extracted source plain text
 * @param {string} opts.moduleKey Req module key
 * @param {(text: string, model?: string, llmOpts?: object) => Promise<string>} [opts.callLLM] Injectable LLM caller
 * @returns {Promise<{ chapters: Array<{ fileName: string, content: string }>, throughChainsMarkdown: string }>} Parsed slice
 */
export async function sliceReqDoc({ sourceText, moduleKey, callLLM }) {
  const prompt = `${loadParsePrompt()}\n\n---\n\nmoduleKey: ${moduleKey}\n\n<source>\n${sourceText}\n</source>`;
  const llmFn = callLLM || ((text, model, llmOpts) => defaultCallLLM(text, model, {
    timeoutMs: PARSE_LLM_TIMEOUT_MS,
    ...llmOpts,
  }));

  let raw;
  try {
    raw = await llmFn(prompt);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(e.message || 'LLM request failed', { code: 'LLM_FAILED', status: 502 });
  }

  const parsed = parseLlmJsonObject(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new AppError('LLM output is not a valid slice JSON object', {
      code: 'SLICE_INVALID',
      status: 400,
    });
  }

  const throughChainsMarkdown = String(parsed.throughChainsMarkdown || '');
  if (!hasProposeableChainSteps(throughChainsMarkdown)) {
    throw new AppError('LLM through-chains.md has no parseable step table', {
      code: 'SLICE_INVALID',
      status: 400,
    });
  }

  if (!Array.isArray(parsed.chapters) || parsed.chapters.length === 0) {
    throw new AppError('LLM output missing chapters', { code: 'SLICE_INVALID', status: 400 });
  }

  const chapters = parsed.chapters.map((ch, index) => {
    const fileName = String(ch?.fileName || '').trim();
    const content = String(ch?.content || '');
    if (!content.trim()) {
      throw new AppError(`LLM chapter ${index} is empty`, { code: 'SLICE_INVALID', status: 400 });
    }
    return { fileName, content };
  });

  return { chapters, throughChainsMarkdown };
}
