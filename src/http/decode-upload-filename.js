/**
 * Repair multer/busboy filenames: UTF-8 bytes decoded as latin1 (mojibake).
 * Leave already-Unicode CJK and ASCII names alone.
 */
const CJK = /[\u3400-\u9fff]/;

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

/** Split on the compose separator so mixed CJK + mojibake segments stay intact. */
export function repairMojibakeText(text) {
  return String(text ?? '').split(' · ').map(decodeUploadFilename).join(' · ');
}
