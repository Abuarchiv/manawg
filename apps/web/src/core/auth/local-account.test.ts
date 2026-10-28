import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { getKnownWgs } from './local-account';

function stubStorage(value: unknown) {
	const store = new Map([['manawg_known_wgs', JSON.stringify(value)]]);
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: { localStorage: { getItem: (key: string) => store.get(key) ?? null } },
	});
}

afterEach(() => {
	Reflect.deleteProperty(globalThis, 'window');
});

test('remembered WGs keep valid entries and drop malformed ones', () => {
	stubStorage([
		{ code: 'ABCD2345', name: 'Flat', lastVisitedAt: 5, authUserId: 'u1', extra: 'dropped' },
		{ code: 'ABCD2346', name: 'Legacy', lastVisitedAt: 4 },
		{ code: 'ABCD2347', name: '', lastVisitedAt: 3 },
		{ code: 'ABCD2348', name: 'Bad time', lastVisitedAt: 'x' },
		{ code: 'ABCD2349', name: 'Bad owner', lastVisitedAt: 2, authUserId: '' },
		'nope',
		null,
	]);
	const known = getKnownWgs();
	assert.deepEqual(
		known.map((wg) => wg.name),
		['Flat', 'Legacy'],
	);
	assert.deepEqual(Object.keys(known[0] ?? {}).sort(), [
		'authUserId',
		'code',
		'lastVisitedAt',
		'name',
	]);
});
