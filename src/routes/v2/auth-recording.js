/**
 * Auth recording APIs — trigger / inspect the two-segment (login + logout)
 * dry-run recording job for a system.
 * Spec: docs/superpowers/specs/2026-09-07-auth-recording-design.md
 */
import * as authRecording from '../../services/auth-recording/index.js';
import { asyncHandler } from '../../http/app-error.js';

/**
 * Register auth-recording routes.
 * @param {import('express').Application} app Express application
 */
export default function registerAuthRecording(app) {
  /** Start an auth recording job (fire-and-forget; 409 when one is already pending/running). */
  app.post('/api/v2/systems/:id/auth-recording', asyncHandler(async (req, res) => {
    const { accountId } = req.body || {};
    const result = await authRecording.startAuthRecording(+req.params.id, { accountId });
    res.status(201).json(result);
  }));

  /** Get the latest auth recording job status plus login/logout trajectory summaries. */
  app.get('/api/v2/systems/:id/auth-recording', asyncHandler(async (req, res) => {
    const result = await authRecording.getAuthRecordingStatus(+req.params.id);
    res.json(result);
  }));
}
