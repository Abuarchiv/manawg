import { expect, test } from '@playwright/test';
import { readJsonBody } from '../src/core/http/read-json';
import { MAX_CSV_BYTES, readImportJsonBody } from '../src/features/expenses/import-body';

test('bounded JSON reader rejects oversized bodies before parsing', async () => {
	const valid = await readJsonBody(
		new Request('https://example.invalid', { method: 'POST', body: JSON.stringify({ ok: true }) }),
		128,
	);
	const oversized = await readJsonBody(
		new Request('https://example.invalid', { method: 'POST', body: 'x'.repeat(129) }),
		128,
	);
	const malformed = await readJsonBody(
		new Request('https://example.invalid', { method: 'POST', body: '{' }),
		128,
	);

	expect(valid).toEqual({ ok: true, body: { ok: true } });
	expect(oversized).toEqual({ ok: false, reason: 'payload_too_large' });
	expect(malformed).toEqual({ ok: false, reason: 'invalid_json' });
});

test('import body rejects an oversized stream without a Content-Length header', async () => {
	let reads = 0;
	let cancelled = false;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			reads += 1;
			controller.enqueue(new Uint8Array(64 * 1024));
		},
		cancel() {
			cancelled = true;
		},
	});
	const request = new Request('https://example.invalid', {
		method: 'POST',
		body,
		duplex: 'half',
	} as RequestInit & { duplex: 'half' });

	expect(request.headers.has('content-length')).toBe(false);
	expect(await readImportJsonBody(request)).toEqual({ ok: false, error: 'payload_too_large' });
	expect(cancelled).toBe(true);
	expect(reads).toBeLessThan(Math.ceil((MAX_CSV_BYTES + 16 * 1024) / (64 * 1024)) + 3);
});
