/**
 * MinIO screenshot object storage: upload, download, presign, delete.
 */
import { randomUUID } from 'crypto';
import { Client } from 'minio';
import {
  MINIO_ENDPOINT,
  MINIO_PORT,
  MINIO_USE_SSL,
  MINIO_ACCESS_KEY,
  MINIO_SECRET_KEY,
  MINIO_BUCKET,
  MINIO_PUBLIC_URL,
} from '../../config/config.js';

let client;
let bucketPromise;

/**
 * True when all required MinIO config env vars are present.
 * @returns {boolean} whether MinIO is configured
 */
export function isMinioConfigured() {
  return Boolean(MINIO_ENDPOINT && MINIO_ACCESS_KEY && MINIO_SECRET_KEY && MINIO_BUCKET);
}

function getClient() {
  if (!client) {
    client = new Client({
      endPoint: MINIO_ENDPOINT,
      port: MINIO_PORT,
      useSSL: MINIO_USE_SSL,
      accessKey: MINIO_ACCESS_KEY,
      secretKey: MINIO_SECRET_KEY,
    });
  }
  return client;
}

async function ensureBucket() {
  if (!isMinioConfigured()) {
    throw new Error('MinIO is not configured');
  }
  if (!bucketPromise) {
    bucketPromise = (async () => {
      const c = getClient();
      const exists = await c.bucketExists(MINIO_BUCKET);
      if (!exists) {
        await c.makeBucket(MINIO_BUCKET);
      }
    })().catch((err) => {
      bucketPromise = null;
      throw err;
    });
  }
  return bucketPromise;
}

/**
 * Build a unique MinIO object name under the given prefix.
 * @param {string} [prefix] object key prefix
 * @returns {string} unique object name
 */
export function buildObjectName(prefix = 'screenshots') {
  return `${prefix}/${Date.now()}-${randomUUID()}.png`;
}

/**
 * Upload a PNG/Buffer to MinIO.
 * @param {Buffer|Uint8Array} buffer screenshot bytes
 * @param {object} [opts] upload options
 * @param {string} [opts.mimeType] content-type (default image/png)
 * @param {string} [opts.objectName] explicit object name
 * @returns {Promise<{ storageType: 'minio', storagePath: string, imageUrl: string|null }>} upload result
 */
export async function uploadScreenshot(buffer, { mimeType = 'image/png', objectName } = {}) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!buf.length) throw new Error('Cannot upload empty screenshot buffer');

  const name = objectName || buildObjectName();
  await ensureBucket();
  await getClient().putObject(MINIO_BUCKET, name, buf, buf.length, {
    'Content-Type': mimeType,
  });

  let imageUrl = MINIO_PUBLIC_URL
    ? `${MINIO_PUBLIC_URL.replace(/\/+$/, '')}/${MINIO_BUCKET}/${name}`
    : null;

  // If no public base URL is configured, store a long-lived presigned URL so the
  // screenshot table always has a usable image URL.
  if (!imageUrl) {
    try {
      imageUrl = await getClient().presignedGetObject(MINIO_BUCKET, name, 604800);
    } catch {
      // Upload succeeded; presigned URL generation is best-effort.
      imageUrl = null;
    }
  }

  return {
    storageType: 'minio',
    storagePath: name,
    imageUrl,
  };
}

/**
 * Download a screenshot object as a Buffer.
 * @param {string} objectName MinIO object name
 * @returns {Promise<Buffer>} object bytes
 */
export async function getScreenshotBuffer(objectName) {
  if (!objectName) throw new Error('MinIO object name required');
  await ensureBucket();
  const stream = await getClient().getObject(MINIO_BUCKET, objectName);
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Generate a presigned GET URL for a MinIO object.
 * @param {string} objectName MinIO object name
 * @param {number} [expires] seconds; default 7 days
 * @returns {Promise<string|null>} presigned URL, or null when objectName empty
 */
export async function getPresignedUrl(objectName, expires = 604800) {
  if (!objectName) return null;
  await ensureBucket();
  return getClient().presignedGetObject(MINIO_BUCKET, objectName, expires);
}

/**
 * Best-effort delete used by bulk cleanup paths.
 * @param {string} objectName MinIO object name
 * @returns {Promise<void>}
 */
export async function removeScreenshotObject(objectName) {
  if (!objectName) return;
  if (!isMinioConfigured()) return;
  try {
    await getClient().removeObject(MINIO_BUCKET, objectName);
  } catch (err) {
    const message = err?.message || '';
    const code = err?.code || '';
    if (code !== 'NoSuchKey' && !/NoSuchKey/i.test(message)) {
      console.warn('[minio] removeObject failed:', message);
    }
  }
}

/**
 * Strict delete used when replacing an existing screenshot.
 * Throws on any real MinIO error so callers can abort before uploading a replacement.
 * @param {string} objectName MinIO object name
 * @returns {Promise<void>}
 */
export async function removeScreenshotObjectStrict(objectName) {
  if (!objectName) return;
  if (!isMinioConfigured()) {
    throw new Error('MinIO is not configured; cannot delete old screenshot');
  }
  try {
    await getClient().removeObject(MINIO_BUCKET, objectName);
  } catch (err) {
    const message = err?.message || '';
    const code = err?.code || '';
    // Missing object is fine: there is nothing to delete.
    if (code === 'NoSuchKey' || /NoSuchKey/i.test(message)) return;
    throw err;
  }
}
