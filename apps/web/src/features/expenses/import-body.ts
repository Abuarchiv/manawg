import type { NextRequest } from 'next/server';

/**
 * Size-capped JSON body reader for the two import routes.
 *
 * Import payloads are whole CSV exports, so they get their own ceiling rather
 * than the platform default, and the check happens twice: once on the
 * Content-Length header to reject early, once on the decoded text because the
 * header is client-supplied and can lie.
 *
 * Both `imports/preview` and `imports/commit` carried a byte-identical copy of
 * this, cap included.
 */

export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_OCR_BYTES = 1 * 1024 * 1024;
const MAX_JSON_OVERHEAD_BYTES = 16 * 1024;
const MAX_IMPORT_BODY_BYTES = MAX_CSV_BYTES + MAX_JSON_OVERHEAD_BYTES;

type ImportBodyResult =
	| { ok: true; value: unknown }
	| { ok: false; error: 'invalid_json' | 'payload_too_large' };

export async function readImportJsonBody(req: NextRequest): Promise<ImportBodyResult> {
	const contentLength = req.headers.get('content-length');
	if (contentLength && Number(contentLength) > MAX_IMPORT_BODY_BYTES) {
		return { ok: false, error: 'payload_too_large' };
	}

	let text: string;
	try {
		text = await req.text();
	} catch {
		return { ok: false, error: 'invalid_json' };
	}
	if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_BODY_BYTES) {
		return { ok: false, error: 'payload_too_large' };
	}

	try {
		return { ok: true, value: JSON.parse(text) };
	} catch {
		return { ok: false, error: 'invalid_json' };
	}
}
