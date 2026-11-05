import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
	type Action,
	createAction,
	makeQueueModule,
	restoreGlobals,
	setQueue,
} from './support/offline-harness.ts';

afterEach(restoreGlobals);

interface StoreApi {
	countOfflineActions(shareCode?: string, options?: { memberId?: string }): number;
	subscribeOfflineQueueChanges(listener: () => void, target?: EventTarget): () => void;
}

test('the queue counter counts per WG and per member', async () => {
	const { module } = await makeQueueModule();
	await setQueue(module, [
		createAction({ id: 'a' }),
		createAction({ id: 'b', memberId: 'member-b' }),
		createAction({ id: 'c', shareCode: 'OTHER123' }),
	]);
	const store = module as unknown as StoreApi;
	assert.equal(store.countOfflineActions(), 3);
	assert.equal(store.countOfflineActions('TEST1234'), 2);
	assert.equal(store.countOfflineActions('TEST1234', { memberId: 'member-a' }), 1);
	assert.equal(store.countOfflineActions(undefined, { memberId: 'member-b' }), 1);
	assert.equal(store.countOfflineActions('NONE0000'), 0);
});

test('queue listeners hear this tab and other tabs, but not other storage keys', async () => {
	const { module, storage } = await makeQueueModule();
	const store = module as unknown as StoreApi;
	const target = new EventTarget();
	let calls = 0;
	const unsubscribe = store.subscribeOfflineQueueChanges(() => {
		calls += 1;
	}, target);
	const storageEvent = (key: string | null, storageArea: unknown) =>
		Object.assign(new Event('storage'), { key, storageArea });
	target.dispatchEvent(new Event('manawg:offline-queue'));
	target.dispatchEvent(storageEvent('manawg:offline-actions', storage));
	target.dispatchEvent(storageEvent(null, storage));
	assert.equal(calls, 3);
	target.dispatchEvent(storageEvent('manawg:theme', storage));
	target.dispatchEvent(storageEvent('manawg:offline-actions', {}));
	assert.equal(calls, 3);
	unsubscribe();
	target.dispatchEvent(new Event('manawg:offline-queue'));
	target.dispatchEvent(storageEvent('manawg:offline-actions', storage));
	assert.equal(calls, 3);
});

test('a queued edit that replaces another frees the photo it no longer uses', async () => {
	const removed: string[] = [];
	const { module } = await makeQueueModule({
		queue: {
			withQueuedExpenseUpdate: (actions: Action[], action: Action) => [
				...actions.filter((entry) => entry.id !== action.id),
				action,
			],
		},
		images: {
			removePendingImage: async (token: string) => {
				removed.push(token);
			},
		},
	});
	const edit = (imageUrl: string) =>
		createAction({
			id: 'expense-update:TEST1234:1:e1',
			type: 'expense.update',
			payload: {
				expenseId: 'e1',
				expectedUpdatedAt: '2026-11-01T00:00:00.000Z',
				description: 'Milk',
				amountCents: 300,
				paidByMemberId: 'member-a',
				splits: [{ debtorMemberId: 'member-a', amountCents: 300 }],
				imageUrl,
			},
		});
	assert.equal(await module.enqueueOfflineAction(edit('manawg-pending-image:first')), 1);
	assert.equal(await module.enqueueOfflineAction(edit('manawg-pending-image:first')), 1);
	assert.deepEqual(removed, []);
	assert.equal(await module.enqueueOfflineAction(edit('manawg-pending-image:second')), 1);
	assert.deepEqual(removed, ['manawg-pending-image:first']);
});
