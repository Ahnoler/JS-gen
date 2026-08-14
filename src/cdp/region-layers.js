function layerLabel(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

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
