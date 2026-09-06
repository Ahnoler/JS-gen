/**
 * Repair multer/busboy filenames: UTF-8 bytes decoded as latin1 (mojibake).
 * Leave already-Unicode CJK and ASCII names alone.
 */
const CJK = /[\u3400-\u9fff]/;

/**
 * Decode a mojibake upload filename (UTF-8 bytes misread as latin1) back to proper text.
 * Leaves already-Unicode CJK and ASCII names unchanged.
 * @param {string} name raw filename from multer/busboy
 * @returns {string} repaired filename
 */
export function decodeUploadFilename(name) {
  const raw = String(name ?? '');
  if (!raw) return '';
  if (CJK.test(raw)) return raw;
  try {
    const repaired = Buffer.from(raw, 'latin1').toString('utf8');
    if (repaired.includes('\uFFFD')) return raw;
    if (CJK.test(repaired)) return repaired;
  } catch {
    /* keep raw */
  }
  return raw;
}

/**
 * Split on the compose separator so mixed CJK + mojibake segments stay intact.
 * @param {string} text raw text that may contain mojibake segments
 * @returns {string} text with each segment repaired via decodeUploadFilename
 */
export function repairMojibakeText(text) {
  return String(text ?? '').split(' · ').map(decodeUploadFilename).join(' · ');
}
