/**
 * Batch Excel import + auto-recording routes.
 * Registered BEFORE /api/v2/trajectories/:id so "batch" is not captured as id.
 */
import { uploadXlsxSingle, multerHttpStatus, XLSX_MIME } from '../../http/upload-xlsx.js';
import { decodeUploadFilename } from '../../http/decode-upload-filename.js';
import { BATCH_TEMPLATE_FILENAME } from '../../services/trajectory/trajectory-batch-excel.js';
import * as batchService from '../../services/trajectory/trajectory-batch-service.js';
import { BATCH_JOB_TERMINAL } from '../../models/constants.js';
import { sendErr, asyncHandler } from './trajectory-shared.js';

function sendExcel(res, buffer, filename) {
  const encoded = encodeURIComponent(filename);
  res.setHeader('Content-Type', XLSX_MIME);
  // ASCII fallback + RFC 5987 so Chinese names survive browser download
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="batch-import-template.xlsx"; filename*=UTF-8''${encoded}`,
  );
  res.setHeader('Content-Length', Buffer.byteLength(buffer));
  res.send(buffer);
}

export default function registerTrajectoryBatch(app) {
  /** Template download (binary, no JSON envelope). */
  app.get('/api/v2/trajectories/batch/template', asyncHandler(async (_req, res) => {
    const buf = await batchService.buildTemplateBuffer();
    sendExcel(res, buf, BATCH_TEMPLATE_FILENAME);
  }));

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
        if (!req.file?.buffer?.length) {
          return res.status(400).json({ error: '请上传 Excel 文件' });
        }
        const idempotencyKey = req.get('Idempotency-Key')
          || req.get('idempotency-key')
          || req.body?.idempotencyKey;
        const result = await batchService.importBatchFromExcel({
          fileBuffer: req.file.buffer,
          originalFilename: decodeUploadFilename(req.file.originalname || ''),
          functionId: req.body?.functionId,
          systemAccountId: req.body?.systemAccountId ?? req.body?.accountId,
          model: req.body?.model || '',
          idempotencyKey,
          mode: req.body?.mode,
          name: req.body?.name,
          paasUserId: req.paasUserId ?? null,
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
  app.get('/api/v2/trajectories/batch/:batchId', asyncHandler(async (req, res) => {
    const page = +req.query.page || 1;
    const pageSize = Math.min(200, +req.query.pageSize || 50);
    const view = await batchService.getBatchJobView(req.params.batchId, {
      page,
      pageSize,
      paasUserId: req.paasUserId ?? null,
    });
    const httpStatus = BATCH_JOB_TERMINAL.includes(view.status) ? 200 : 202;
    res.status(httpStatus).json(view);
  }));

  /** Cancel batch — race-safe; does not downgrade recorded trajectories. */
  app.post('/api/v2/trajectories/batch/:batchId/cancel', asyncHandler(async (req, res) => {
    const view = await batchService.cancelBatch(req.params.batchId);
    res.json(view);
  }));
}
