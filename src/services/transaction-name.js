/**
 * Shared transaction-name sanitizer — strips filesystem-unsafe characters.
 *
 * Used by both V2 (transaction-export.js) and V3 (transaction-export-v3.js)
 * to normalize trajectory names before sending to the partner platform.
 */

/**
 * Sanitize a raw transaction name by replacing filesystem-unsafe characters
 * (\ / : * ? " < > | ') with underscores. Returns empty string for empty input.
 * @param {string} raw raw transaction name
 * @returns {string} sanitized name with unsafe chars replaced by '_'
 */
export function sanitizeTranscationName(raw) {
  return String(raw || '').replace(/[\\/:*?"<>|']/g, '_');
}
