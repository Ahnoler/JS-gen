/**
 * Batch Excel import + auto-recording routes.
 * Registered BEFORE /api/v2/trajectories/:id so "batch" is not captured as id.
 */
import { USE_EXECUTOR } from '../../../config/config.js';
import { uploadXlsxSingle, multerHttpStatus, XLSX_MIME } from '../../http/upload-xlsx.js';
import * as batchService from '../../services/trajectory-batch-service.js';
import { BATCH_JOB_TERMINAL } from '../../models/constants.js';

function sendErr(res, err, fallback = 500) {
  const status = err.statusCode || fallback;
  const body = { error: err.message };
  if (err.rejected) body.rejected = err.rejected;
  if (err.holders) body.holders = err.holders;
  res.status(status).json(body);
}

function sendExcel(res, buffer, filename) {
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', Buffer.byteLength(buffer));
  res.send(buffer);
}

export default function registerTrajectoryBatch(app) {
  /** Template download (binary, no JSON envelope). */
  app.get('/api/v2/trajectories/batch/template', async (_req, res) => {
    try {
      const buf = await batchService.buildTemplateBuffer();
      sendExcel(res, buf, 'trajectory-batch-template.xlsx');
    } catch (err) {
      sendErr(res, err);
    }
  });

  /**
   * One-shot import: parse Excel → persist job → background analyze/record.
   * multipart: file, functionId, systemAccountId, model?
   * header: Idempotency-Key
   */
  app.post('/api/v2/trajectories/batch/import', (req, res) => {
    uploadXlsxSingle(req, res, async (err) => {
      if (err) {
        const status = multerHttpStatus(err) || 400;
        return res.status(status).json({ error: err.message });
      }
      try {
        if (!USE_EXECUTOR) {
          return res.status(503).json({ error: 'Batch import requires USE_EXECUTOR=true' });
        }
        if (!req.file?.buffer) {
          return res.status(400).json({ error: 'file is required' });
        }
        const idempotencyKey = req.get('Idempotency-Key')
          || req.get('idempotency-key')
          || req.body?.idempotencyKey;
        const result = await batchService.importBatchFromExcel({
          fileBuffer: req.file.buffer,
          originalFilename: req.file.originalname || '',
          functionId: req.body?.functionId,
          systemAccountId: req.body?.systemAccountId ?? req.body?.accountId,
          model: req.body?.model || '',
          idempotencyKey,
        });
        const httpStatus = result._httpStatus || 202;
        delete result._httpStatus;
        delete result._idempotentReplay;
        res.status(httpStatus).json(result);
      } catch (e) {
        sendErr(res, e, e.statusCode || 500);
      }
    });
  });

  /** Poll job status (paginated items). */
  app.get('/api/v2/trajectories/batch/:batchId', async (req, res) => {
    try {
      const page = +req.query.page || 1;
      const pageSize = Math.min(200, +req.query.pageSize || 50);
      const view = await batchService.getBatchJobView(req.params.batchId, { page, pageSize });
      const httpStatus = BATCH_JOB_TERMINAL.includes(view.status) ? 200 : 202;
      res.status(httpStatus).json(view);
    } catch (err) {
      sendErr(res, err);
    }
  });

  /** Cancel batch — race-safe; does not downgrade recorded trajectories. */
  app.post('/api/v2/trajectories/batch/:batchId/cancel', async (req, res) => {
    try {
      const view = await batchService.cancelBatch(req.params.batchId);
      res.json(view);
    } catch (err) {
      sendErr(res, err);
    }
  });
}
