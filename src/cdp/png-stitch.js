/**
 * Vertical PNG slice stitching for phase long-screenshots.
 */
import { PNG } from 'pngjs';

const DEFAULT_MAX_BYTES = 12_000_000;

/**
 * Stitch PNG screenshot slices vertically into one long image.
 * @param {Buffer[]} buffers PNG buffers to stitch (must share width).
 * @param {object} [opts] Stitch options.
 * @param {number} [opts.overlap] Single-value overlap (rows cropped from every slice i>=1). Default 48.
 * @param {number[]|null} [opts.overlaps] Per-slice overlap array; slice i skip = overlaps[i] ?? 0.
 * @param {number} [opts.maxBytes] Max output bytes; downsamples by 2× when exceeded.
 * @returns {Buffer} Stitched PNG buffer.
 */
export function stitchPngSlices(buffers, { overlap = 48, overlaps = null, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (!Array.isArray(buffers) || !buffers.length) {
    throw new Error('stitchPngSlices: empty buffers');
  }
  const pngs = buffers.map((b) => PNG.sync.read(Buffer.isBuffer(b) ? b : Buffer.from(b)));
  const width = pngs[0].width;
  const ov = Math.max(0, Number(overlap) || 0);
  const perSlice = Array.isArray(overlaps) ? overlaps : null;
  const skipOf = (i) => {
    if (i === 0) return 0;
    return perSlice ? Math.max(0, Number(perSlice[i]) || 0) : ov;
  };
  let height = pngs[0].height;
  for (let i = 1; i < pngs.length; i++) {
    if (pngs[i].width !== width) {
      throw new Error('stitchPngSlices: width mismatch');
    }
    height += Math.max(0, pngs[i].height - skipOf(i));
  }
  const out = new PNG({ width, height });
  let y = 0;
  for (let i = 0; i < pngs.length; i++) {
    const src = pngs[i];
    const skip = Math.min(skipOf(i), src.height);
    for (let row = skip; row < src.height; row++) {
      const srcStart = (row * width) << 2;
      const dstStart = (y * width) << 2;
      src.data.copy(out.data, dstStart, srcStart, srcStart + (width << 2));
      y += 1;
    }
  }
  let packed = PNG.sync.write(out);
  if (packed.length > maxBytes && height > 2) {
    const half = new PNG({ width, height: Math.floor(height / 2) });
    for (let row = 0; row < half.height; row++) {
      const srcStart = ((row * 2) * width) << 2;
      const dstStart = (row * width) << 2;
      out.data.copy(half.data, dstStart, srcStart, srcStart + (width << 2));
    }
    packed = PNG.sync.write(half);
  }
  return packed;
}
