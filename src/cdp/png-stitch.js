import { PNG } from 'pngjs';

const DEFAULT_MAX_BYTES = 12_000_000;

export function stitchPngSlices(buffers, { overlap = 48, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (!Array.isArray(buffers) || !buffers.length) {
    throw new Error('stitchPngSlices: empty buffers');
  }
  const pngs = buffers.map((b) => PNG.sync.read(Buffer.isBuffer(b) ? b : Buffer.from(b)));
  const width = pngs[0].width;
  const ov = Math.max(0, Number(overlap) || 0);
  let height = pngs[0].height;
  for (let i = 1; i < pngs.length; i++) {
    if (pngs[i].width !== width) {
      throw new Error('stitchPngSlices: width mismatch');
    }
    height += Math.max(0, pngs[i].height - ov);
  }
  const out = new PNG({ width, height });
  let y = 0;
  for (let i = 0; i < pngs.length; i++) {
    const src = pngs[i];
    const skip = i === 0 ? 0 : Math.min(ov, src.height);
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
