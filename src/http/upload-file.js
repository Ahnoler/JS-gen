/**
 * Multer memory upload for generic KB source documents (.docx/.doc/.md/.txt/.pdf).
 * Mirrors upload-xlsx.js (memoryStorage + UTF-8 filename repair + 4xx filter),
 * field name `file`.
 */
import multer from 'multer';
import { decodeUploadFilename } from './decode-upload-filename.js';

/** Document extensions accepted by this uploader. */
export const DOC_EXTS = ['.docx', '.doc', '.md', '.txt', '.pdf'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  // Browsers send UTF-8 Content-Disposition filenames; busboy defaults to latin1.
  defParamCharset: 'utf8',
  fileFilter(_req, file, cb) {
    file.originalname = decodeUploadFilename(file.originalname);
    const name = String(file.originalname || '').toLowerCase();
    const ok = DOC_EXTS.some((ext) => name.endsWith(ext))
      || String(file.mimetype || '').toLowerCase() === 'application/octet-stream';
    if (!ok) {
      return cb(Object.assign(new Error(`请上传文档文件（${DOC_EXTS.join('/')}）`), { code: 'VALIDATION' }));
    }
    cb(null, true);
  },
});

/** Express middleware: multipart field `file`. */
export const uploadFileSingle = upload.single('file');

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
