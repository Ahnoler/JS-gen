/**
 * Multer memory upload that accepts only OOXML .xlsx (ExcelJS-compatible).
 * Intentionally separate from system-mgmt (which still accepts .xls extension).
 */
import multer from 'multer';

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
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

export function multerHttpStatus(err) {
  if (err instanceof multer.MulterError) return 400;
  if (err?.code === 'VALIDATION') return 400;
  return null;
}
