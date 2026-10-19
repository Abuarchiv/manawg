type JsonBodyResult =
	| { ok: true; body: unknown }
	| { ok: false; reason: 'invalid_json' | 'payload_too_large' };

export async function readJsonBody(req: Request, maxBytes: number): Promise<JsonBodyResult> {
	const declaredLength = req.headers.get('content-length');
	if (declaredLength && Number(declaredLength) > maxBytes) {
		return { ok: false, reason: 'payload_too_large' };
	}

	if (!req.body) return { ok: false, reason: 'invalid_json' };
	const reader = req.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			totalBytes += value.byteLength;
			if (totalBytes > maxBytes) {
				await reader.cancel();
				return { ok: false, reason: 'payload_too_large' };
			}
			chunks.push(value);
		}
	} catch {
		return { ok: false, reason: 'invalid_json' };
	}

	const bytes = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	let body: unknown;
	try {
		body = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return { ok: false, reason: 'invalid_json' };
	}
	// Postgres text columns cannot hold U+0000; it would surface as a 500 deep in a transaction.
	if (containsNul(body)) return { ok: false, reason: 'invalid_json' };
	return { ok: true, body };
}

function containsNul(value: unknown): boolean {
	if (typeof value === 'string') return value.includes('\u0000');
	if (Array.isArray(value)) return value.some(containsNul);
	if (value && typeof value === 'object') return Object.values(value).some(containsNul);
	return false;
}

/** Default cap for ordinary JSON mutations; the platform limit (4.5 MB) is far above any legitimate body. */
export const DEFAULT_JSON_BODY_BYTES = 128 * 1024;

/**
 * Drop-in for `req.json()` that refuses oversized bodies. Throws on oversize
 * or malformed JSON, so existing try/catch blocks returning 'invalid_json'
 * keep their response shape.
 */
export async function readJsonLimited(
	req: Request,
	maxBytes: number = DEFAULT_JSON_BODY_BYTES,
): Promise<unknown> {
	const result = await readJsonBody(req, maxBytes);
	if (!result.ok) throw new Error(result.reason);
	return result.body;
}
