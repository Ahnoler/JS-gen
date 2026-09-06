/**
 * Region layer helpers: prepend/replace the page-scope layer label.
 */

function layerLabel(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/**
 * Prepend (or replace) the page-role layer at index 0 of a layers array.
 * @param {Array<{ role?: string, label?: string }>} layers Existing layers.
 * @param {string} pageLabel Incoming page label to use when no page layer exists.
 * @returns {Array<{ role: string, label: string }>} Layers with a single page layer at index 0.
 */
export function prependPageLayer(layers, pageLabel) {
  const src = Array.isArray(layers) ? layers.slice() : [];
  let existingPage = '';
  if (src[0] && src[0].role === 'page') existingPage = layerLabel(src[0].label);
  const cleaned = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] && src[i].role === 'page') continue;
    cleaned.push(src[i]);
  }
  const incoming = layerLabel(pageLabel);
  const page = existingPage || incoming;
  if (page) cleaned.unshift({ role: 'page', label: page });
  return cleaned;
}
