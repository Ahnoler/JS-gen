/**
 * Shared JSON example helper for API group modules (extracted from catalog.js).
 * @param {object} obj value to stringify for API docs examples
 * @returns {string} pretty-printed JSON (2-space indent)
 */
export const J = (obj) => JSON.stringify(obj, null, 2);
