/**
 * Extract plain text from a req-module source file (md/txt/docx MVP).
 */
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { AppError } from '../../http/app-error.js';

/** Max characters sent to the slice LLM (~80–100k). */
export const SOURCE_TEXT_MAX_CHARS = 90_000;

const TEXT_EXTS = new Set(['.md', '.txt']);

/**
 * Load mammoth's CJS/ESM default export.
 * @returns {Promise<{ extractRawText: (input: { path?: string, buffer?: Buffer }) => Promise<{ value?: string }> }>} mammoth module
 */
async function loadMammoth() {
  const mod = await import('mammoth');
  return mod.default ?? mod;
}

/**
 * Extract plain text from a source file, truncating oversized documents.
 * @param {string} filePath Absolute path to the source file
 * @returns {Promise<{ text: string, truncated: boolean, charCount: number }>} Extracted text and truncation flag
 */
export async function extractSourceText(filePath) {
  const ext = extname(filePath).toLowerCase();
  let text = '';
  try {
    if (TEXT_EXTS.has(ext)) {
      text = await readFile(filePath, 'utf-8');
    } else if (ext === '.docx') {
      const mammoth = await loadMammoth();
      const result = await mammoth.extractRawText({ path: filePath });
      text = String(result?.value || '');
    } else {
      throw new AppError(`unsupported source type: ${ext || '(none)'}`, {
        code: 'UNSUPPORTED_TYPE',
        status: 400,
      });
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(`source extract failed: ${e.message || 'unknown error'}`, {
      code: 'EXTRACT_FAILED',
      status: 400,
    });
  }

  text = String(text || '').replace(/\u0000/g, '');
  if (!text.trim()) {
    throw new AppError('source extract produced empty text', {
      code: 'EXTRACT_FAILED',
      status: 400,
    });
  }

  const truncated = text.length > SOURCE_TEXT_MAX_CHARS;
  const extracted = truncated ? text.slice(0, SOURCE_TEXT_MAX_CHARS) : text;
  return { text: extracted, truncated, charCount: extracted.length };
}
