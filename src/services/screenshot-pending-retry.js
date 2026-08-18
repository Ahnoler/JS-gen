import {
  SCREENSHOT_RETRY_INTERVAL_MS,
  SCREENSHOT_MAX_RETRY,
} from '../../config/config.js';
import * as screenshotDao from '../dao/screenshot-dao.js';
import { uploadScreenshot, removeScreenshotObject } from './minio-service.js';
import {
  readPendingFile,
  deletePendingFile,
} from './screenshot-pending-store.js';

let running = false;
let timer = null;

/**
 * Scan local screenshots and try to upload them to MinIO.
 * Returns a small summary for logging/tests.
 */
export async function retryPendingScreenshots({
  intervalMs = SCREENSHOT_RETRY_INTERVAL_MS,
  maxRetry = SCREENSHOT_MAX_RETRY,
} = {}) {
  if (running) return { skipped: true };
  running = true;
  const summary = { scanned: 0, uploaded: 0, failed: 0, skipped: 0 };
  try {
    const pending = await screenshotDao.listPending();
    const now = Date.now();

    for (const row of pending) {
      if (row.storageType !== 'local') continue;
      summary.scanned += 1;

      const retryCount = Number(row.retryCount) || 0;
      if (retryCount >= maxRetry) {
        summary.skipped += 1;
        continue;
      }

      if (row.lastRetryAt) {
        const last = new Date(row.lastRetryAt).getTime();
        if (Number.isFinite(last) && now - last < intervalMs) {
          summary.skipped += 1;
          continue;
        }
      }

      const buffer = await readPendingFile(row.id);
      if (!buffer) {
        // Local file missing: count this as a failed attempt.
        await screenshotDao.updateRetry(row.id, {
          retryCount: retryCount + 1,
          lastRetryAt: new Date(),
        });
        summary.failed += 1;
        continue;
      }

      let uploaded = null;
      try {
        uploaded = await uploadScreenshot(buffer, {
          mimeType: row.mimeType || 'image/png',
        });
      } catch (err) {
        console.warn('[screenshot-pending] retry upload failed:', err?.message || err);
        await screenshotDao.updateRetry(row.id, {
          retryCount: retryCount + 1,
          lastRetryAt: new Date(),
        });
        summary.failed += 1;
        continue;
      }

      try {
        await screenshotDao.markUploaded(row.id, {
          storagePath: uploaded.storagePath,
          imageUrl: uploaded.imageUrl,
        });
      } catch (err) {
        console.warn('[screenshot-pending] retry DB update failed:', err?.message || err);
        if (uploaded?.storagePath) {
          await removeScreenshotObject(uploaded.storagePath).catch(() => {});
        }
        await screenshotDao.updateRetry(row.id, {
          retryCount: retryCount + 1,
          lastRetryAt: new Date(),
        });
        summary.failed += 1;
        continue;
      }

      await deletePendingFile(row.id).catch(() => {});
      summary.uploaded += 1;
    }

    return summary;
  } finally {
    running = false;
  }
}

/**
 * Start the background pending-screenshot retry loop.
 * Safe to call multiple times: only one timer is created.
 */
export function startPendingScreenshotRetry() {
  if (timer) return timer;

  // Fire an initial scan shortly after startup.
  retryPendingScreenshots().catch((err) => {
    console.warn('[screenshot-pending] initial retry scan failed:', err?.message || err);
  });

  timer = setInterval(() => {
    retryPendingScreenshots().catch((err) => {
      console.warn('[screenshot-pending] scheduled retry scan failed:', err?.message || err);
    });
  }, SCREENSHOT_RETRY_INTERVAL_MS);

  // Do not keep the process alive just for retries.
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

export function stopPendingScreenshotRetry() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
