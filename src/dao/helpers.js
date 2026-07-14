/**
 * Utility: convert camelCase object keys to snake_case for DB inserts.
 * Converts top-level keys only. Preserves id and skips undefined values.
 */
export function toDbRow(obj) {
  const row = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined) continue;
    const snake = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    row[snake] = val;
  }
  return row;
}

/**
 * Utility: convert snake_case DB row back to camelCase entity.
 * Converts top-level keys only. Preserves id.
 */
export function fromDbRow(row) {
  if (!row) return null;
  const obj = {};
  for (const [key, val] of Object.entries(row)) {
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    obj[camel] = val;
  }
  return obj;
}

/**
 * Utility: convert an array of DB rows to camelCase entities.
 */
export function fromDbRows(rows) {
  return rows.map(fromDbRow);
}
