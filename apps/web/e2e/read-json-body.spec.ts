import { expect, test } from '@playwright/test';
import { readJsonBody } from '../src/core/http/read-json';

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
