export type JsonBodyResult =
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
	try {
		return { ok: true, body: JSON.parse(new TextDecoder().decode(bytes)) };
	} catch {
		return { ok: false, reason: 'invalid_json' };
	}
}
