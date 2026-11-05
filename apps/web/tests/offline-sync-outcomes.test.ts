import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
	type Action,
	createAction,
	deferred,
	makeQueueModule,
	restoreGlobals,
	setQueue,
} from './support/offline-harness.ts';

afterEach(restoreGlobals);

const me = { force: true, memberId: 'member-a' };
const ok = { ok: true, status: 200, data: {} };
const recurringExpense = (payload: Action = {}) =>
	createAction({
		type: 'expense.create',
		payload: {
			description: 'Miete',
			amountCents: 100,
			paidByMemberId: 'member-a',
			splits: [{ debtorMemberId: 'member-a', amountCents: 100 }],
			imageUrl: null,
			recurringExpenseId: 'recurring-1',
			expectedRecurringNextDueAt: '2026-10-01T00:00:00.000Z',
			...payload,
		},
	});

test('an answer that the work is already done counts as synced and clears the entry', async () => {
	const cases: Array<[Action, { status: number; error: string }]> = [
		[
			createAction({
				type: 'recurring.advance',
				payload: {
					recurringExpenseId: 'r1',
					expectedRecurringNextDueAt: '2026-10-01T00:00:00.000Z',
				},
			}),
			{ status: 409, error: 'recurring_expense_already_advanced' },
		],
		[
			createAction({ type: 'chore.complete', payload: { choreId: 'c1' } }),
			{ status: 409, error: 'chore_already_completed' },
		],
		[
			createAction({
				id: 'shopping:TEST1234:1:brot',
				type: 'shopping.create',
				payload: { name: 'Brot' },
			}),
			{ status: 409, error: 'shopping_item_duplicate' },
		],
	];
	for (const [action, answer] of cases) {
		const { module, storage } = await makeQueueModule({
			apiFetch: async () => ({ ok: false, ...answer }),
		});
		await setQueue(module, [action]);
		assert.equal(await module.syncOfflineActions('TEST1234', me), 1, action.type);
		assert.deepEqual(JSON.parse(storage.getItem('manawg:offline-actions') ?? '[]'), []);
	}
});

test('a booked fixed cost advances its template, unless the create already did', async () => {
	const methods: string[] = [];
	const { module } = await makeQueueModule({
		apiFetch: async (_path, init) => {
			methods.push(init.method);
			return init.method === 'PATCH' ? ok : { ok: true, status: 201, data: { expense: {} } };
		},
	});
	await setQueue(module, [recurringExpense()]);
	await module.syncOfflineActions('TEST1234', me);
	assert.deepEqual(methods, ['POST', 'PATCH']);

	const created: string[] = [];
	const second = await makeQueueModule({
		apiFetch: async (_path, init) => {
			created.push(init.method);
			return { ok: true, status: 201, data: { expense: {}, recurringExpense: {} } };
		},
	});
	await setQueue(second.module, [recurringExpense()]);
	await second.module.syncOfflineActions('TEST1234', me);
	assert.deepEqual(created, ['POST']);
});

test('a failed template advance is queued once more, an already advanced one is not', async () => {
	const advance = async (answer: () => Promise<unknown>) => {
		const { module, storage } = await makeQueueModule({
			apiFetch: async (_path, init) => (init.method === 'PATCH' ? answer() : ok),
		});
		await setQueue(module, [recurringExpense()]);
		await module.syncOfflineActions('TEST1234', me);
		const queue: Action[] = JSON.parse(storage.getItem('manawg:offline-actions') ?? '[]');
		return queue.map((action) => action.id);
	};
	assert.deepEqual(
		await advance(async () => ({
			ok: false,
			status: 409,
			error: 'recurring_expense_already_advanced',
		})),
		[],
	);
	assert.deepEqual(await advance(async () => ({ ok: false, status: 503, error: 'unavailable' })), [
		'recurring-advance:TEST1234:recurring-1',
	]);
	assert.deepEqual(
		await advance(async () => {
			throw new Error('offline');
		}),
		['recurring-advance:TEST1234:recurring-1'],
	);
});

test('an aborted sync sends nothing and leaves the queue untouched', async () => {
	let calls = 0;
	const { module } = await makeQueueModule({
		apiFetch: async () => {
			calls += 1;
			return ok;
		},
	});
	await setQueue(module, [createAction()]);
	const controller = new AbortController();
	controller.abort();
	assert.equal(
		await module.syncOfflineActions('TEST1234', { ...me, signal: controller.signal }),
		0,
	);
	assert.equal(calls, 0);
	assert.equal(module.readOfflineQueue().length, 1);
});

test('a request that fails because the sync was aborted counts no attempt', async () => {
	const controller = new AbortController();
	const { module } = await makeQueueModule({
		apiFetch: async () => {
			controller.abort();
			throw new Error('aborted');
		},
	});
	await setQueue(module, [createAction()]);
	await module.syncOfflineActions('TEST1234', { ...me, signal: controller.signal });
	const [entry] = module.readOfflineQueue();
	assert.equal(entry.attempts, undefined);
	assert.equal(entry.lastError, undefined);
});

test('a second sync of the same scope joins the running one', async () => {
	const gate = deferred<unknown>();
	let calls = 0;
	const { module } = await makeQueueModule({
		apiFetch: async () => {
			calls += 1;
			return gate.promise;
		},
	});
	await setQueue(module, [createAction()]);
	const first = module.syncOfflineActions('TEST1234', me);
	const second = module.syncOfflineActions('TEST1234', me);
	await new Promise((resolve) => setTimeout(resolve, 0));
	gate.resolve(ok);
	assert.deepEqual(await Promise.all([first, second]), [1, 1]);
	assert.equal(calls, 1);
});

test('an action queued without a key gets one before it is sent', async () => {
	const keys: unknown[] = [];
	const { module } = await makeQueueModule({
		apiFetch: async (_path, init) => {
			keys.push(init.headers['Idempotency-Key']);
			return ok;
		},
	});
	await setQueue(module, [createAction({ idempotencyKey: undefined })]);
	assert.equal(await module.syncOfflineActions('TEST1234', me), 1);
	assert.deepEqual(keys, ['00000000-0000-4000-8000-000000000001']);
});

test('the synced event counts the flushed actions per WG', async () => {
	const { module, window } = await makeQueueModule({ apiFetch: async () => ok });
	await setQueue(module, [createAction(), createAction({ id: 'b', shareCode: 'OTHER123' })]);
	await module.syncOfflineActions(undefined as never, me);
	const event = window.dispatched.find((entry) => entry.type === 'manawg:offline-synced');
	assert.deepEqual(event?.detail, { synced: 2, syncedByShareCode: { TEST1234: 1, OTHER123: 1 } });
	const { getSyncedCountForWg } = (await import('../src/core/offline/offline-sync.ts')) as {
		getSyncedCountForWg: (event: Event, shareCode: string) => number;
	};
	const asEvent = (detail: unknown) => new CustomEvent('manawg:offline-synced', { detail });
	assert.equal(getSyncedCountForWg(asEvent(event?.detail), 'OTHER123'), 1);
	assert.equal(getSyncedCountForWg(asEvent(event?.detail), 'NONE0000'), 0);
	assert.equal(getSyncedCountForWg(asEvent({ synced: 3 }), 'NONE0000'), 3);
	assert.equal(getSyncedCountForWg(new Event('x'), 'TEST1234'), 0);
});

test('a forced sync started during an automatic one still sends what is backing off', async () => {
	let calls = 0;
	const { module } = await makeQueueModule({
		apiFetch: async () => {
			calls += 1;
			return ok;
		},
		queue: { shouldRetryOfflineAction: () => false },
	});
	await setQueue(module, [createAction()]);
	const auto = module.syncOfflineActions('TEST1234', { memberId: 'member-a' });
	const forced = module.syncOfflineActions('TEST1234', me);
	assert.deepEqual(await Promise.all([auto, forced]), [0, 1]);
	assert.equal(calls, 1);
});

test('an entry edited while its request was aborted is held for review, not resent', async () => {
	const entered = deferred();
	const response = deferred<unknown>();
	let calls = 0;
	const { module } = await makeQueueModule({
		apiFetch: async () => {
			calls += 1;
			entered.resolve();
			return response.promise;
		},
	});
	await setQueue(module, [createAction()]);
	const controller = new AbortController();
	const syncing = module.syncOfflineActions('TEST1234', { ...me, signal: controller.signal });
	await entered.promise;
	await setQueue(module, [
		createAction({ payload: { content: 'edited', kind: 'info', imageUrl: null } }),
	]);
	controller.abort();
	response.resolve(ok);
	await syncing;
	assert.equal(module.readOfflineQueue()[0].payload.content, 'edited');
	assert.equal(module.needsManualOfflineResolution(module.readOfflineQueue()[0]), true);
	await module.syncOfflineActions('TEST1234', me);
	assert.equal(calls, 1);
});
