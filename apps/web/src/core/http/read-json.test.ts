import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_JSON_BODY_BYTES, readJsonLimited } from './read-json';

const post = (body: string, headers: Record<string, string> = {}) =>
	new Request('http://x.test/', { method: 'POST', body, headers });

test('readJsonLimited parses small bodies', async () => {
	assert.deepEqual(await readJsonLimited(post('{"a":1}')), { a: 1 });
});

test('readJsonLimited rejects oversized bodies, declared or streamed', async () => {
	const big = JSON.stringify({ pad: 'x'.repeat(DEFAULT_JSON_BODY_BYTES) });
	await assert.rejects(readJsonLimited(post(big)), /payload_too_large/);
	await assert.rejects(
		readJsonLimited(post('{}', { 'content-length': String(big.length) })),
		/payload_too_large/,
	);
});

test('readJsonLimited rejects malformed or missing bodies', async () => {
	await assert.rejects(readJsonLimited(post('{nope')), /invalid_json/);
	await assert.rejects(readJsonLimited(new Request('http://x.test/')), /invalid_json/);
});

test('readJsonLimited rejects NUL bytes in any string (Postgres cannot store them)', async () => {
	await assert.rejects(readJsonLimited(post('{"name":"a\\u0000b"}')), /invalid_json/);
	await assert.rejects(readJsonLimited(post('{"splits":[{"note":"\\u0000"}]}')), /invalid_json/);
	assert.deepEqual(await readJsonLimited(post('{"name":"a\\\\u0000"}')), { name: 'a\\u0000' });
});

test('readJsonLimited survives a deeply nested body', async () => {
	const depth = 60_000;
	const nested = `${'['.repeat(depth)}"ok"${']'.repeat(depth)}`;
	const body = await readJsonLimited(post(nested));
	assert.ok(Array.isArray(body));
});
