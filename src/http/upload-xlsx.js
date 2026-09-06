/**
 * Multer memory upload that accepts only OOXML .xlsx (ExcelJS-compatible).
 * Intentionally separate from system-mgmt (which still accepts .xls extension).
 */
import multer from 'multer';
import { decodeUploadFilename } from './decode-upload-filename.js';

/** OOXML spreadsheet MIME type accepted by this uploader. */
export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  // Browsers send UTF-8 Content-Disposition filenames; busboy defaults to latin1.
  defParamCharset: 'utf8',
  fileFilter(_req, file, cb) {
    file.originalname = decodeUploadFilename(file.originalname);
    const name = String(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    const ok = name.endsWith('.xlsx')
      || mime === XLSX_MIME
      || mime.includes('spreadsheetml')
      || mime === 'application/octet-stream';
    if (!ok || name.endsWith('.xls')) {
      return cb(Object.assign(new Error('请上传 Excel 文件（.xlsx）'), { code: 'VALIDATION' }));
    }
    cb(null, true);
  },
});

/** Express middleware: multipart field `file`. */
export const uploadXlsxSingle = upload.single('file');

/**
 * Map a multer error to the HTTP status to send (400 for MulterError / validation, else null).
 * @param {Error} err err
 * @returns {number|null} result
 */
export function multerHttpStatus(err) {
  if (err instanceof multer.MulterError) return 400;
  if (err?.code === 'VALIDATION') return 400;
  return null;
}
