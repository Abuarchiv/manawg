import assert from 'node:assert/strict';
import test from 'node:test';
import { getOfflineActionRisk, type OfflineAction } from './offline-queue';

const NOW = Date.parse('2026-11-05T12:00:00.000Z');
const HOUR = 3_600_000;

function action(createdAgoMs: number, extra: Partial<OfflineAction> = {}): OfflineAction {
	return {
		id: 'shopping:CODE:1:milch',
		type: 'shopping.create',
		shareCode: 'CODE',
		memberId: 'member-a',
		createdAt: new Date(NOW - createdAgoMs).toISOString(),
		payload: { name: 'Milch' },
		...extra,
	};
}

test('a fresh action without an error carries no risk hint', () => {
	assert.equal(getOfflineActionRisk(action(HOUR), NOW), null);
});

test('an action older than six hours carries a risk hint', () => {
	assert.notEqual(getOfflineActionRisk(action(6 * HOUR), NOW), null);
});

test('a fresh action that failed without a connection carries no risk hint', () => {
	assert.equal(
		getOfflineActionRisk(
			action(HOUR, { noConnection: true, lastErrorMessage: { key: 'offline.state.serverCheck' } }),
			NOW,
		),
		null,
	);
});

test('a fresh action with a server message carries a risk hint', () => {
	assert.notEqual(
		getOfflineActionRisk(
			action(HOUR, { lastErrorMessage: { key: 'offline.state.serverCheck' } }),
			NOW,
		),
		null,
	);
});

test('an action stamped in the future says the time is off', () => {
	assert.deepEqual(getOfflineActionRisk(action(-HOUR), NOW)?.title, {
		key: 'offline.risk.timeFuture.title',
	});
});
