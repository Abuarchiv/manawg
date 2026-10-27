import assert from 'node:assert/strict';
import test from 'node:test';

const { postOccurrenceChange } = await import('../src/features/events/occurrence-api.ts');
const { keyUnavailableMessage } = await import('../src/core/offline/offline-copy.ts');

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

test('keyUnavailableMessage names the subject and the verb', () => {
	assert.equal(
		keyUnavailableMessage('WG-Beitritt', 'gesendet'),
		'WG-Beitritt konnte nicht sicher gesendet werden. Versuche es erneut.',
	);
	assert.equal(
		keyUnavailableMessage('Kalender-Feed', 'widerrufen'),
		'Kalender-Feed konnte nicht sicher widerrufen werden. Versuche es erneut.',
	);
});
