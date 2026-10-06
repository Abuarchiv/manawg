import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { DEFAULT_JSON_BODY_BYTES } from '../src/core/http/read-json.ts';

const { parseBody } = await import('../src/core/http/parse-body.ts');

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
	new Request('http://x.test/', { method: 'POST', body, headers });

const schema = z.object({ title: z.string().min(1), days: z.number().int().positive() });

async function failure(result: { ok: true } | { ok: false; response: Response }) {
	if (result.ok) throw new Error('expected parseBody to fail');
	return { status: result.response.status, body: await result.response.json() };
}

test('parseBody returns the validated data', async () => {
	const result = await parseBody(post('{"title":"Bad","days":3,"extra":true}'), schema);
	assert.deepEqual(result, { ok: true, data: { title: 'Bad', days: 3 } });
});

test('parseBody answers invalid_json for malformed or missing bodies', async () => {
	assert.deepEqual(await failure(await parseBody(post('{nope'), schema)), {
		status: 400,
		body: { error: 'invalid_json' },
	});
	assert.deepEqual(await failure(await parseBody(new Request('http://x.test/'), schema)), {
		status: 400,
		body: { error: 'invalid_json' },
	});
});

test('parseBody answers 413 for oversized bodies and honours maxBytes', async () => {
	const big = JSON.stringify({ title: 'x'.repeat(DEFAULT_JSON_BODY_BYTES), days: 1 });
	const expected = {
		status: 413,
		body: { error: 'payload_too_large', code: 'payload_too_large' },
	};
	assert.deepEqual(await failure(await parseBody(post(big), schema)), expected);
	assert.deepEqual(
		await failure(await parseBody(post('{"title":"ok","days":1}'), schema, { maxBytes: 8 })),
		expected,
	);
});

test('parseBody maps the first failing field in fieldErrors order', async () => {
	const fieldErrors = { title: 'title_invalid', days: 'interval_invalid' };
	assert.deepEqual(
		await failure(await parseBody(post('{"title":"","days":0}'), schema, { fieldErrors })),
		{ status: 400, body: { error: 'title_invalid' } },
	);
	assert.deepEqual(
		await failure(await parseBody(post('{"title":"ok","days":0}'), schema, { fieldErrors })),
		{ status: 400, body: { error: 'interval_invalid' } },
	);
});

test('parseBody falls back to invalid_body or the configured code', async () => {
	assert.deepEqual(await failure(await parseBody(post('[]'), schema)), {
		status: 400,
		body: { error: 'invalid_body' },
	});
	assert.deepEqual(
		await failure(
			await parseBody(post('{"title":"","days":1}'), schema, {
				fieldErrors: { days: 'interval_invalid' },
				invalid: 'wg_update_invalid',
			}),
		),
		{ status: 400, body: { error: 'wg_update_invalid' } },
	);
});
