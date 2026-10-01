import { readJsonBody } from '@/core/http/read-json';

/**
 * Size-capped JSON body reader for the two import routes.
 *
 * Import payloads are whole CSV exports, so they get their own ceiling rather
 * than the platform default, and the check happens twice: once on the
 * Content-Length header to reject early, once on streamed bytes because the
 * header is client-supplied and can lie.
 *
 * Both `imports/preview` and `imports/commit` carried a byte-identical copy of
 * this, cap included.
 */

export const MAX_CSV_BYTES = 5 * 1024 * 1024;
// Der Commit schreibt zeilenweise in einer Transaktion; mehr Zeilen sprengen das Funktions-Zeitlimit.
export const MAX_IMPORT_ROWS = 2000;
export const MAX_OCR_BYTES = 1 * 1024 * 1024;
const MAX_JSON_OVERHEAD_BYTES = 16 * 1024;
const MAX_IMPORT_BODY_BYTES = MAX_CSV_BYTES + MAX_JSON_OVERHEAD_BYTES;

type ImportBodyResult =
	| { ok: true; value: unknown }
	| { ok: false; error: 'invalid_json' | 'payload_too_large' };

export async function readImportJsonBody(req: Request): Promise<ImportBodyResult> {
	const result = await readJsonBody(req, MAX_IMPORT_BODY_BYTES);
	return result.ok ? { ok: true, value: result.body } : { ok: false, error: result.reason };
}
