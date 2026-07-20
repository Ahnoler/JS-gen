/**
 * Legacy JSON case-data catalog — OFFLINE (410 Gone).
 * Prefer registering via legacy-gone.js; this file kept for direct imports.
 */
import { registerGoneCatalog } from './legacy-gone.js';

export default function (app) {
  registerGoneCatalog(app, '/api/case-data', '/api/v2/case-data', ['/:id/file']);
}
