import assert from 'node:assert/strict';
import test from 'node:test';

const { postOccurrenceChange } = await import('../src/features/events/occurrence-api.ts');

test('an occurrence change without an idempotency key sends nothing', async (t) => {
	const calls: unknown[] = [];
	t.mock.method(globalThis, 'fetch', async (...args: unknown[]) => {
		calls.push(args);
		return Response.json({});
	});
	t.mock.method(globalThis.crypto, 'randomUUID', () => {
		throw new Error('unavailable');
	});
	const res = await postOccurrenceChange('/api/events', 'member-1', 'event-1', '2026-10-27', null);
	assert.deepEqual(res, { ok: false, status: 0, error: 'idempotency_key_unavailable' });
	assert.equal(calls.length, 0);
});
