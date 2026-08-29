// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	OFFLINE_QUEUE_KEY,
	SYNCED_IDS_KEY,
	countOfflineActions,
	enqueueOfflineAction,
	writeOfflineQueue as persistOfflineQueue,
	readOfflineQueue,
	syncOfflineActions,
} from './offline-client';

const TEST_WG_ID = 'wg-test';
const TEST_MEMBER_TOKEN = 'test-member-token';
const TEST_IDEMPOTENCY_KEY = '5c1f6d70-30d4-4f91-8a45-674aafd4b351';
const writeOfflineQueue = (actions: Parameters<typeof persistOfflineQueue>[0]) =>
	persistOfflineQueue(
		actions.map((action) => ({
			...action,
			idempotencyKey: action.idempotencyKey ?? TEST_IDEMPOTENCY_KEY,
			wgId: action.wgId ?? TEST_WG_ID,
		})),
	);

const apiFetchMock = vi.fn();
const offlineImageMock = vi.hoisted(() => ({
	uploadPendingImageToken: vi.fn(),
}));
const identityMock = vi.hoisted(() => ({ getIdentity: vi.fn() }));

vi.mock('@/core/infra/api-client', () => ({
	apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

vi.mock('@/core/offline/offline-images', () => ({
	isPendingImageToken: (value: string | null | undefined) =>
		Boolean(value?.startsWith('manawg-pending-image:')),
	uploadPendingImageToken: offlineImageMock.uploadPendingImageToken,
}));

vi.mock('@/shared/lib/identity', () => ({
	getIdentity: (...args: unknown[]) => identityMock.getIdentity(...args),
}));

describe('offline client queue helpers', () => {
	beforeEach(() => {
		window.localStorage.removeItem(OFFLINE_QUEUE_KEY);
		window.localStorage.removeItem(SYNCED_IDS_KEY);
		apiFetchMock.mockReset();
		offlineImageMock.uploadPendingImageToken.mockReset();
		identityMock.getIdentity.mockReset();
		identityMock.getIdentity.mockReturnValue({
			memberId: 'm1',
			memberToken: TEST_MEMBER_TOKEN,
		});
	});

	it('resolves the stored token for mutations and pending-image signing', async () => {
		identityMock.getIdentity.mockReturnValue({ memberId: 'm1', memberToken: 'signed-token' });
		offlineImageMock.uploadPendingImageToken.mockResolvedValue('https://cdn.test/image.jpg');
		apiFetchMock.mockImplementation(() => {
			expect(readOfflineQueue()[0]?.idempotencyKey).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
			);
			return Promise.resolve({ ok: true, data: {} });
		});
		persistOfflineQueue([
			{
				id: 'announcement:ABC12345:test',
				idempotencyKey: 'invalid-legacy-key',
				type: 'announcement.create',
				wgId: 'wg-1',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: { content: 'Hallo', kind: 'info', imageUrl: 'manawg-pending-image:img1' },
			},
		]);

		await expect(syncOfflineActions('ABC12345', { force: true })).resolves.toBe(1);
		expect(offlineImageMock.uploadPendingImageToken).toHaveBeenCalledWith(
			'manawg-pending-image:img1',
			'm1',
			'signed-token',
		);
		expect(apiFetchMock).toHaveBeenCalledWith(
			'/api/wg/ABC12345/announcements',
			expect.objectContaining({
				memberId: 'm1',
				memberToken: 'signed-token',
				headers: {
					'Idempotency-Key': expect.stringMatching(
						/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
					),
				},
			}),
		);
	});

	it('does not send an action when a valid idempotency key cannot be persisted', async () => {
		const randomUuid = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
			throw new Error('unavailable');
		});
		try {
			persistOfflineQueue([
				{
					id: 'shopping:ABC12345:invalid-key',
					idempotencyKey: 'invalid-legacy-key',
					type: 'shopping.create',
					wgId: TEST_WG_ID,
					shareCode: 'ABC12345',
					memberId: 'm1',
					createdAt: '2026-05-18T12:00:00.000Z',
					payload: { name: 'Milch', quantity: null },
				},
			]);

			await expect(syncOfflineActions('ABC12345', { force: true })).resolves.toBe(0);
			expect(apiFetchMock).not.toHaveBeenCalled();
			expect(readOfflineQueue()[0]).toMatchObject({
				idempotencyKey: 'invalid-legacy-key',
				lastError:
					'Idempotenz-Schlüssel konnte nicht erzeugt werden. Die Aktion bleibt gespeichert und wird nicht gesendet.',
			});
		} finally {
			randomUuid.mockRestore();
		}
	});

	it('keeps legacy tokenless actions queued with an explicit re-auth error', async () => {
		persistOfflineQueue([
			{
				id: 'shopping:ABC12345:legacy',
				type: 'shopping.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: { name: 'Milch', quantity: null },
			},
		]);

		await expect(syncOfflineActions('ABC12345', { force: true })).resolves.toBe(0);
		expect(apiFetchMock).not.toHaveBeenCalled();
		expect(readOfflineQueue()[0]?.lastError).toContain('Erneute Anmeldung erforderlich');
	});

	it('counts queued actions globally and per WG', () => {
		writeOfflineQueue([
			{
				id: 'shopping:ABC12345:test',
				type: 'shopping.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: { name: 'Milch', quantity: null },
			},
			{
				id: 'shopping:XYZ98765:test',
				type: 'shopping.create',
				shareCode: 'XYZ98765',
				memberId: 'm2',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: { name: 'Kaffee', quantity: null },
			},
		]);

		expect(countOfflineActions()).toBe(2);
		expect(countOfflineActions('ABC12345')).toBe(1);
		expect(countOfflineActions('ABC12345', { memberId: 'm1' })).toBe(1);
		expect(countOfflineActions('ABC12345', { memberId: 'm2' })).toBe(0);
		expect(countOfflineActions('NOQUEUE1')).toBe(0);
	});

	it('does not throw when queue storage is blocked', () => {
		const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
		try {
			Object.defineProperty(window, 'localStorage', {
				configurable: true,
				get() {
					throw new Error('blocked');
				},
			});

			expect(readOfflineQueue()).toEqual([]);
			expect(countOfflineActions()).toBe(0);
			expect(
				writeOfflineQueue([
					{
						id: 'shopping:ABC12345:test',
						type: 'shopping.create',
						shareCode: 'ABC12345',
						memberId: 'm1',
						createdAt: '2026-05-18T12:00:00.000Z',
						payload: { name: 'Milch', quantity: null },
					},
				]),
			).toBe(false);
		} finally {
			if (original) Object.defineProperty(window, 'localStorage', original);
		}
	});

	it('reports failed enqueue attempts when browser storage is blocked', () => {
		const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
		try {
			Object.defineProperty(window, 'localStorage', {
				configurable: true,
				get() {
					throw new Error('blocked');
				},
			});

			const count = enqueueOfflineAction({
				id: 'shopping:ABC12345:test',
				type: 'shopping.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: { name: 'Milch', quantity: null },
			});

			expect(count).toBe(0);
		} finally {
			if (original) Object.defineProperty(window, 'localStorage', original);
		}
	});

	it('ignores malformed stored actions before UI or sync code reads them', () => {
		window.localStorage.setItem(
			OFFLINE_QUEUE_KEY,
			JSON.stringify([
				null,
				{ id: 'broken', type: 'unknown', shareCode: 'ABC12345', memberId: 'm1', payload: {} },
				{
					id: 'expense:ABC12345:broken',
					type: 'expense.create',
					shareCode: 'ABC12345',
					memberId: 'm1',
					createdAt: '2026-05-18T12:00:00.000Z',
					payload: { description: 'Miete', amountCents: '95000', splits: [] },
				},
				{
					id: 'recurring-advance:ABC12345:unsafe',
					type: 'recurring.advance',
					shareCode: 'ABC12345',
					memberId: 'm1',
					createdAt: '2026-05-18T12:00:00.000Z',
					payload: { recurringExpenseId: 'unsafe-recurring' },
				},
				{
					id: 'shopping:ABC12345:test',
					type: 'shopping.create',
					shareCode: 'ABC12345',
					memberId: 'm1',
					createdAt: '2026-05-18T12:00:00.000Z',
					payload: { name: 'Milch', bought: true },
				},
			]),
		);

		expect(countOfflineActions()).toBe(1);
		expect(countOfflineActions('ABC12345')).toBe(1);
	});

	it('keeps all supported queued action payloads when they are complete', () => {
		window.localStorage.setItem(
			OFFLINE_QUEUE_KEY,
			JSON.stringify([
				{
					id: 'shopping-update:ABC12345:test',
					type: 'shopping.update',
					shareCode: 'ABC12345',
					memberId: 'm1',
					createdAt: '2026-05-18T12:00:00.000Z',
					payload: { itemId: 'item-1', name: 'Milch', bought: true },
				},
				{
					id: 'announcement:ABC12345:test',
					type: 'announcement.create',
					shareCode: 'ABC12345',
					memberId: 'm1',
					createdAt: '2026-05-18T12:00:00.000Z',
					payload: { content: 'Paket im Flur', kind: 'info', imageUrl: null },
				},
				{
					id: 'absence:ABC12345:test',
					type: 'absence.create',
					shareCode: 'ABC12345',
					memberId: 'm1',
					createdAt: '2026-05-18T12:00:00.000Z',
					payload: {
						memberId: 'm1',
						startDate: '2026-05-20T00:00:00.000Z',
						endDate: '2026-05-21T00:00:00.000Z',
						reason: null,
					},
				},
				{
					id: 'chore-create:ABC12345:test',
					type: 'chore.create',
					shareCode: 'ABC12345',
					memberId: 'm1',
					createdAt: '2026-05-18T12:00:00.000Z',
					payload: { title: 'Bad', intervalDays: 7, assignedMemberId: null },
				},
				{
					id: 'chore:ABC12345:test',
					type: 'chore.complete',
					shareCode: 'ABC12345',
					memberId: 'm1',
					createdAt: '2026-05-18T12:00:00.000Z',
					payload: { choreId: 'chore-1' },
				},
				{
					id: 'expense:ABC12345:test',
					type: 'expense.create',
					shareCode: 'ABC12345',
					memberId: 'm1',
					createdAt: '2026-05-18T12:00:00.000Z',
					payload: {
						description: 'Miete',
						amountCents: 95000,
						paidByMemberId: 'm1',
						splits: [{ debtorMemberId: 'm1', amountCents: 95000 }],
						imageUrl: null,
					},
				},
				{
					id: 'recurring:ABC12345:test',
					type: 'recurring.create',
					shareCode: 'ABC12345',
					memberId: 'm1',
					createdAt: '2026-05-18T12:00:00.000Z',
					payload: {
						description: 'Internet',
						amountCents: 3290,
						paidByMemberId: 'm1',
						intervalMonths: 1,
						nextDueAt: '2026-06-01T00:00:00.000Z',
						splits: [{ debtorMemberId: 'm1', amountCents: 3290 }],
					},
				},
			]),
		);

		expect(countOfflineActions('ABC12345')).toBe(7);
	});

	it('syncs queued shopping status updates with PATCH', async () => {
		apiFetchMock.mockResolvedValue({ ok: true, data: {} });
		writeOfflineQueue([
			{
				id: 'shopping-update:ABC12345:test',
				type: 'shopping.update',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: { itemId: 'item-1', name: 'Milch', bought: true },
			},
		]);

		const synced = await syncOfflineActions('ABC12345', { force: true });

		expect(synced).toBe(1);
		expect(apiFetchMock).toHaveBeenCalledWith('/api/wg/ABC12345/shopping/item-1', {
			method: 'PATCH',
			memberId: 'm1',
			memberToken: TEST_MEMBER_TOKEN,
			body: JSON.stringify({ bought: true }),
		});
		expect(readOfflineQueue()).toEqual([]);
	});

	it('BUG-581: syncs only the active local member when a WG queue contains multiple identities', async () => {
		apiFetchMock.mockResolvedValue({ ok: true, data: {} });
		identityMock.getIdentity.mockReturnValue({
			memberId: 'member-ben',
			memberToken: TEST_MEMBER_TOKEN,
		});
		writeOfflineQueue([
			{
				id: 'shopping:ABC12345:ava',
				type: 'shopping.create',
				shareCode: 'ABC12345',
				memberId: 'member-ava',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: { name: 'Milch', quantity: null },
			},
			{
				id: 'shopping:ABC12345:ben',
				type: 'shopping.create',
				shareCode: 'ABC12345',
				memberId: 'member-ben',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: { name: 'Kaffee', quantity: null },
			},
		]);

		const synced = await syncOfflineActions('ABC12345', {
			force: true,
			memberId: 'member-ben',
		});

		expect(synced).toBe(1);
		expect(apiFetchMock).toHaveBeenCalledTimes(1);
		expect(apiFetchMock).toHaveBeenCalledWith('/api/wg/ABC12345/shopping', {
			method: 'POST',
			memberId: 'member-ben',
			memberToken: TEST_MEMBER_TOKEN,
			headers: { 'Idempotency-Key': TEST_IDEMPOTENCY_KEY },
			body: JSON.stringify({ name: 'Kaffee', quantity: null, addedByMemberId: 'member-ben' }),
		});
		expect(readOfflineQueue()).toEqual([
			expect.objectContaining({
				id: 'shopping:ABC12345:ava',
				memberId: 'member-ava',
			}),
		]);
	});

	it('advances a recurring template after syncing its queued expense', async () => {
		apiFetchMock.mockResolvedValue({ ok: true, data: {} });
		writeOfflineQueue([
			{
				id: 'expense:ABC/123?x=1:recurring',
				type: 'expense.create',
				shareCode: 'ABC/123?x=1',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: {
					description: 'Internet',
					amountCents: 3290,
					paidByMemberId: 'm1',
					splits: [{ debtorMemberId: 'm1', amountCents: 3290 }],
					imageUrl: null,
					recurringExpenseId: 'recurring-1',
					expectedRecurringNextDueAt: '2026-05-20T00:00:00.000Z',
				},
			},
		]);

		const synced = await syncOfflineActions('ABC/123?x=1', { force: true });

		expect(synced).toBe(1);
		expect(apiFetchMock).toHaveBeenNthCalledWith(1, '/api/wg/ABC%2F123%3Fx%3D1/expenses', {
			method: 'POST',
			memberId: 'm1',
			memberToken: TEST_MEMBER_TOKEN,
			headers: { 'Idempotency-Key': TEST_IDEMPOTENCY_KEY },
			body: JSON.stringify({
				description: 'Internet',
				amountCents: 3290,
				paidByMemberId: 'm1',
				splits: [{ debtorMemberId: 'm1', amountCents: 3290 }],
			}),
		});
		expect(apiFetchMock).toHaveBeenNthCalledWith(
			2,
			'/api/wg/ABC%2F123%3Fx%3D1/recurring-expenses',
			{
				method: 'PATCH',
				memberId: 'm1',
				memberToken: TEST_MEMBER_TOKEN,
				body: JSON.stringify({
					id: 'recurring-1',
					expectedNextDueAt: '2026-05-20T00:00:00.000Z',
				}),
			},
		);
		expect(readOfflineQueue()).toEqual([]);
	});

	it('keeps only the recurring advance retry when a queued recurring expense was created', async () => {
		apiFetchMock
			.mockResolvedValueOnce({ ok: true, data: {} })
			.mockRejectedValueOnce(new Error('network down'));
		writeOfflineQueue([
			{
				id: 'expense:ABC12345:recurring',
				type: 'expense.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: {
					description: 'Internet',
					amountCents: 3290,
					paidByMemberId: 'm1',
					splits: [{ debtorMemberId: 'm1', amountCents: 3290 }],
					imageUrl: null,
					recurringExpenseId: 'recurring-1',
					expectedRecurringNextDueAt: '2026-05-20T00:00:00.000Z',
				},
			},
		]);

		const synced = await syncOfflineActions('ABC12345', { force: true });
		const queue = readOfflineQueue();

		expect(synced).toBe(1);
		expect(queue).toHaveLength(1);
		expect(queue[0]).toMatchObject({
			id: 'recurring-advance:ABC12345:recurring-1',
			type: 'recurring.advance',
			shareCode: 'ABC12345',
			memberId: 'm1',
			payload: {
				recurringExpenseId: 'recurring-1',
				expectedRecurringNextDueAt: '2026-05-20T00:00:00.000Z',
			},
			attempts: 1,
			lastError:
				'Fixkosten-Vorlage nicht weitergeschoben: Die Ausgabe wurde erstellt. Die Vorlage bleibt zur Nachholung in der Warteschlange.',
		});
	});

	it('does not keep a recurring advance retry when the template was already advanced', async () => {
		apiFetchMock.mockResolvedValueOnce({ ok: true, data: {} }).mockResolvedValueOnce({
			ok: false,
			status: 409,
			error: 'recurring_expense_already_advanced',
		});
		writeOfflineQueue([
			{
				id: 'expense:ABC12345:recurring',
				type: 'expense.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: {
					description: 'Internet',
					amountCents: 3290,
					paidByMemberId: 'm1',
					splits: [{ debtorMemberId: 'm1', amountCents: 3290 }],
					imageUrl: null,
					recurringExpenseId: 'recurring-1',
					expectedRecurringNextDueAt: '2026-05-20T00:00:00.000Z',
				},
			},
		]);

		const synced = await syncOfflineActions('ABC12345', { force: true });

		expect(synced).toBe(1);
		expect(readOfflineQueue()).toEqual([]);
	});

	it('resolves standalone recurring advance retries when the template was already advanced', async () => {
		apiFetchMock.mockResolvedValue({
			ok: false,
			status: 409,
			error: 'recurring_expense_already_advanced',
		});
		writeOfflineQueue([
			{
				id: 'recurring-advance:ABC12345:recurring-1',
				type: 'recurring.advance',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: {
					recurringExpenseId: 'recurring-1',
					expectedRecurringNextDueAt: '2026-05-20T00:00:00.000Z',
				},
			},
		]);

		const synced = await syncOfflineActions('ABC12345', { force: true });

		expect(synced).toBe(1);
		expect(apiFetchMock).toHaveBeenCalledWith('/api/wg/ABC12345/recurring-expenses', {
			method: 'PATCH',
			memberId: 'm1',
			memberToken: TEST_MEMBER_TOKEN,
			body: JSON.stringify({
				id: 'recurring-1',
				expectedNextDueAt: '2026-05-20T00:00:00.000Z',
			}),
		});
		expect(readOfflineQueue()).toEqual([]);
	});

	it('resolves chore completions when the chore was already completed', async () => {
		apiFetchMock.mockResolvedValue({
			ok: false,
			status: 409,
			error: 'chore_already_completed',
		});
		writeOfflineQueue([
			{
				id: 'chore-complete:ABC12345:c1',
				type: 'chore.complete',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: { choreId: 'c1' },
			},
		]);

		const synced = await syncOfflineActions('ABC12345', { force: true });

		expect(synced).toBe(1);
		expect(readOfflineQueue()).toEqual([]);
	});

	it('reuses an in-flight sync for the same WG and mode', async () => {
		let resolveApi: (value: { ok: true; data: Record<string, never> }) => void = () => undefined;
		apiFetchMock.mockReturnValue(
			new Promise((resolve) => {
				resolveApi = resolve;
			}),
		);
		writeOfflineQueue([
			{
				id: 'shopping:ABC12345:test',
				type: 'shopping.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: { name: 'Milch', quantity: null },
			},
		]);

		const first = syncOfflineActions('ABC12345', { force: true });
		const second = syncOfflineActions('ABC12345', { force: true });
		await vi.waitFor(() => {
			expect(apiFetchMock).toHaveBeenCalledTimes(1);
		});

		resolveApi({ ok: true, data: {} });

		await expect(Promise.all([first, second])).resolves.toEqual([1, 1]);
		expect(readOfflineQueue()).toEqual([]);
	});

	it('serializes overlapping global and scoped syncs without sending the same action twice', async () => {
		const pendingResponses: Array<(value: { ok: true; data: Record<string, never> }) => void> = [];
		apiFetchMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					pendingResponses.push(resolve);
				}),
		);
		identityMock.getIdentity.mockImplementation((wgId: string) => ({
			memberId: wgId === 'wg-2' ? 'm2' : 'm1',
			memberToken: TEST_MEMBER_TOKEN,
		}));
		writeOfflineQueue([
			{
				id: 'shopping:ABC12345:first',
				type: 'shopping.create',
				wgId: TEST_WG_ID,
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: { name: 'Milch', quantity: null },
			},
			{
				id: 'shopping:XYZ98765:second',
				type: 'shopping.create',
				wgId: 'wg-2',
				shareCode: 'XYZ98765',
				memberId: 'm2',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: { name: 'Kaffee', quantity: null },
			},
		]);

		const scoped = syncOfflineActions('ABC12345', { force: true });
		const global = syncOfflineActions(undefined, { force: true });
		await vi.waitFor(() => {
			expect(apiFetchMock).toHaveBeenCalledTimes(1);
		});

		pendingResponses.shift()?.({ ok: true, data: {} });
		await vi.waitFor(() => {
			expect(apiFetchMock).toHaveBeenCalledTimes(2);
		});
		pendingResponses.shift()?.({ ok: true, data: {} });

		await expect(Promise.all([scoped, global])).resolves.toEqual([1, 1]);
		expect(apiFetchMock).toHaveBeenNthCalledWith(1, '/api/wg/ABC12345/shopping', {
			method: 'POST',
			memberId: 'm1',
			memberToken: TEST_MEMBER_TOKEN,
			headers: { 'Idempotency-Key': TEST_IDEMPOTENCY_KEY },
			body: JSON.stringify({ name: 'Milch', quantity: null, addedByMemberId: 'm1' }),
		});
		expect(apiFetchMock).toHaveBeenNthCalledWith(2, '/api/wg/XYZ98765/shopping', {
			method: 'POST',
			memberId: 'm2',
			memberToken: TEST_MEMBER_TOKEN,
			headers: { 'Idempotency-Key': TEST_IDEMPOTENCY_KEY },
			body: JSON.stringify({ name: 'Kaffee', quantity: null, addedByMemberId: 'm2' }),
		});
		expect(readOfflineQueue()).toEqual([]);
	});

	it('starts a new sync after the previous in-flight sync has settled', async () => {
		apiFetchMock.mockResolvedValue({ ok: true, data: {} });
		writeOfflineQueue([
			{
				id: 'shopping:ABC12345:first',
				type: 'shopping.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: { name: 'Milch', quantity: null },
			},
		]);
		await syncOfflineActions('ABC12345', { force: true });
		writeOfflineQueue([
			{
				id: 'shopping:ABC12345:second',
				type: 'shopping.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: { name: 'Kaffee', quantity: null },
			},
		]);

		await syncOfflineActions('ABC12345', { force: true });

		expect(apiFetchMock).toHaveBeenCalledTimes(2);
		expect(readOfflineQueue()).toEqual([]);
	});

	it('announces successful syncs so banners can show feedback', async () => {
		apiFetchMock.mockResolvedValue({ ok: true, data: {} });
		const listener = vi.fn();
		window.addEventListener('manawg:offline-synced', listener);
		writeOfflineQueue([
			{
				id: 'shopping:ABC12345:test',
				type: 'shopping.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: { name: 'Milch', quantity: null },
			},
		]);

		await syncOfflineActions('ABC12345', { force: true });

		expect(listener).toHaveBeenCalledWith(
			expect.objectContaining({
				detail: {
					synced: 1,
					syncedByShareCode: {
						ABC12345: 1,
					},
				},
			}),
		);
		window.removeEventListener('manawg:offline-synced', listener);
	});

	it('does not send queued actions when the queue cannot be persisted before sync', async () => {
		apiFetchMock.mockResolvedValue({ ok: true, data: {} });
		const listener = vi.fn();
		window.addEventListener('manawg:offline-synced', listener);
		writeOfflineQueue([
			{
				id: 'shopping:ABC12345:test',
				type: 'shopping.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: { name: 'Milch', quantity: null },
			},
		]);
		const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('quota exceeded');
		});

		try {
			const synced = await syncOfflineActions('ABC12345', { force: true });

			expect(synced).toBe(0);
			expect(apiFetchMock).not.toHaveBeenCalled();
			expect(listener).not.toHaveBeenCalled();
		} finally {
			setItemSpy.mockRestore();
			window.removeEventListener('manawg:offline-synced', listener);
		}
	});

	it('RED BUG-005/248: does not resend an action after the final queue save fails post-success', async () => {
		apiFetchMock.mockResolvedValue({ ok: true, data: {} });
		writeOfflineQueue([
			{
				id: 'shopping:ABC12345:test',
				type: 'shopping.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: { name: 'Milch', quantity: null },
			},
		]);
		let setItemCalls = 0;
		const originalSetItem = Storage.prototype.setItem;
		const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
			this: Storage,
			key,
			value,
		) {
			setItemCalls += 1;
			if (setItemCalls === 2) throw new Error('quota exceeded after api success');
			return Reflect.apply(originalSetItem, this, [key, value]);
		});

		try {
			const firstSynced = await syncOfflineActions('ABC12345', { force: true });
			setItemSpy.mockRestore();
			const secondSynced = await syncOfflineActions('ABC12345', { force: true });

			expect(firstSynced).toBe(1);
			expect(secondSynced).toBe(0);
			expect(apiFetchMock).toHaveBeenCalledTimes(1);
		} finally {
			setItemSpy.mockRestore();
		}
	});

	it('keeps queued image actions actionable when their local pending image is missing', async () => {
		offlineImageMock.uploadPendingImageToken.mockRejectedValue(new Error('pending-image-missing'));
		writeOfflineQueue([
			{
				id: 'announcement:ABC12345:test',
				type: 'announcement.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: {
					content: 'Foto vom Zähler',
					kind: 'info',
					imageUrl: 'manawg-pending-image:lost-photo',
				},
			},
		]);

		const synced = await syncOfflineActions('ABC12345', { force: true });
		const queue = readOfflineQueue();

		expect(synced).toBe(0);
		expect(apiFetchMock).not.toHaveBeenCalled();
		expect(queue).toHaveLength(1);
		expect(queue[0]?.payload).toMatchObject({
			content: 'Foto vom Zähler',
			kind: 'info',
			imageUrl: null,
		});
		expect(queue[0]?.lastError).toBe(
			'Bild fehlt: Der lokale Anhang ist auf diesem Gerät nicht mehr verfügbar. Die Aktion bleibt ohne Anhang sendbar; wähle das Bild bei Bedarf erneut aus.',
		);
	});

	it('keeps pending image signature auth failures actionable with a membership hint', async () => {
		offlineImageMock.uploadPendingImageToken.mockRejectedValue(
			new Error('sign-failed:401:not_a_member'),
		);
		writeOfflineQueue([
			{
				id: 'announcement:ABC12345:test',
				type: 'announcement.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: {
					content: 'Foto vom Zähler',
					kind: 'info',
					imageUrl: 'manawg-pending-image:auth-failed',
				},
			},
		]);

		const synced = await syncOfflineActions('ABC12345', { force: true });
		const queue = readOfflineQueue();

		expect(synced).toBe(0);
		expect(apiFetchMock).not.toHaveBeenCalled();
		expect(queue).toHaveLength(1);
		expect(queue[0]?.payload.imageUrl).toBe('manawg-pending-image:auth-failed');
		expect(queue[0]?.lastError).toBe(
			'Mitglied nicht mehr gültig: Öffne die WG erneut oder tritt mit einem aktuellen Einladungslink bei, bevor du diese Aktion sendest.',
		);
	});

	it('keeps pending image signature server failures distinguishable from offline network loss', async () => {
		offlineImageMock.uploadPendingImageToken.mockRejectedValue(
			new Error('sign-failed:503:db_error'),
		);
		writeOfflineQueue([
			{
				id: 'announcement:ABC12345:test',
				type: 'announcement.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: {
					content: 'Foto vom Zähler',
					kind: 'info',
					imageUrl: 'manawg-pending-image:server-failed',
				},
			},
		]);

		const synced = await syncOfflineActions('ABC12345', { force: true });
		const queue = readOfflineQueue();

		expect(synced).toBe(0);
		expect(apiFetchMock).not.toHaveBeenCalled();
		expect(queue).toHaveLength(1);
		expect(queue[0]?.payload.imageUrl).toBe('manawg-pending-image:server-failed');
		expect(queue[0]?.lastError).toBe(
			'Server gerade nicht bereit: Die Aktion bleibt in der Warteschlange. Versuche es gleich erneut.',
		);
	});

	it('RED BUG-255/335: keeps pending image upload failures distinguishable from offline network loss', async () => {
		offlineImageMock.uploadPendingImageToken.mockRejectedValue(new Error('upload-failed:503'));
		writeOfflineQueue([
			{
				id: 'announcement:ABC12345:test',
				type: 'announcement.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: {
					content: 'Foto vom Zähler',
					kind: 'info',
					imageUrl: 'manawg-pending-image:upload-failed',
				},
			},
		]);

		const synced = await syncOfflineActions('ABC12345', { force: true });
		const queue = readOfflineQueue();

		expect(synced).toBe(0);
		expect(apiFetchMock).not.toHaveBeenCalled();
		expect(queue).toHaveLength(1);
		expect(queue[0]?.payload.imageUrl).toBe('manawg-pending-image:upload-failed');
		expect(queue[0]?.lastError).toBe(
			'Server gerade nicht bereit: Die Aktion bleibt in der Warteschlange. Versuche es gleich erneut.',
		);
	});

	it('keeps stale-member sync failures actionable with a clear recovery hint', async () => {
		apiFetchMock.mockResolvedValue({ ok: false, status: 401, error: 'not_a_member' });
		writeOfflineQueue([
			{
				id: 'shopping:ABC12345:test',
				type: 'shopping.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: { name: 'Milch', quantity: null },
			},
		]);

		const synced = await syncOfflineActions('ABC12345', { force: true });
		const queue = readOfflineQueue();

		expect(synced).toBe(0);
		expect(queue).toHaveLength(1);
		expect(queue[0]?.attempts).toBe(1);
		expect(queue[0]?.lastError).toBe(
			'Mitglied nicht mehr gültig: Öffne die WG erneut oder tritt mit einem aktuellen Einladungslink bei, bevor du diese Aktion sendest.',
		);
	});

	it('keeps missing participant sync failures actionable with a clear edit hint', async () => {
		apiFetchMock.mockResolvedValue({ ok: false, status: 400, error: 'member_not_in_wg' });
		writeOfflineQueue([
			{
				id: 'expense:ABC12345:test',
				type: 'expense.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: {
					description: 'Miete',
					amountCents: 50000,
					paidByMemberId: 'm2',
					splits: [{ debtorMemberId: 'm2', amountCents: 50000 }],
					imageUrl: null,
				},
			},
		]);

		const synced = await syncOfflineActions('ABC12345', { force: true });
		const queue = readOfflineQueue();

		expect(synced).toBe(0);
		expect(queue).toHaveLength(1);
		expect(queue[0]?.lastError).toBe(
			'Mitglied in Aktion prüfen: Ein beteiligtes Mitglied ist nicht mehr in der WG. Bearbeite Zuweisung oder Aufteilung vor dem erneuten Senden.',
		);
	});

	it('keeps amount validation sync failures actionable with a clear edit hint', async () => {
		apiFetchMock.mockResolvedValue({ ok: false, status: 400, error: 'splits_sum_mismatch' });
		writeOfflineQueue([
			{
				id: 'expense:ABC12345:test',
				type: 'expense.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: {
					description: 'Miete',
					amountCents: 50000,
					paidByMemberId: 'm1',
					splits: [{ debtorMemberId: 'm1', amountCents: 40000 }],
					imageUrl: null,
				},
			},
		]);

		const synced = await syncOfflineActions('ABC12345', { force: true });
		const queue = readOfflineQueue();

		expect(synced).toBe(0);
		expect(queue).toHaveLength(1);
		expect(queue[0]?.lastError).toBe(
			'Aufteilung prüfen: Bearbeite Betrag und Aufteilung, bevor du diese Aktion erneut sendest.',
		);
	});

	it('keeps split shape validation sync failures actionable with a clear edit hint', async () => {
		apiFetchMock.mockResolvedValue({ ok: false, status: 400, error: 'splits_invalid' });
		writeOfflineQueue([
			{
				id: 'expense:ABC12345:test',
				type: 'expense.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: {
					description: 'Miete',
					amountCents: 50000,
					paidByMemberId: 'm1',
					splits: [{ debtorMemberId: 'm1', amountCents: 50000 }],
					imageUrl: null,
				},
			},
		]);

		const synced = await syncOfflineActions('ABC12345', { force: true });
		const queue = readOfflineQueue();

		expect(synced).toBe(0);
		expect(queue).toHaveLength(1);
		expect(queue[0]?.lastError).toBe(
			'Aufteilung prüfen: Bearbeite Betrag und Aufteilung, bevor du diese Aktion erneut sendest.',
		);
	});

	it('keeps absence date range sync failures actionable with a clear edit hint', async () => {
		apiFetchMock.mockResolvedValue({ ok: false, status: 400, error: 'date_range_invalid' });
		writeOfflineQueue([
			{
				id: 'absence:ABC12345:test',
				type: 'absence.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: {
					memberId: 'm1',
					startDate: '2026-05-22T00:00:00.000Z',
					endDate: '2026-05-20T00:00:00.000Z',
					reason: null,
				},
			},
		]);

		const synced = await syncOfflineActions('ABC12345', { force: true });
		const queue = readOfflineQueue();

		expect(synced).toBe(0);
		expect(queue).toHaveLength(1);
		expect(queue[0]?.lastError).toBe(
			'Datum prüfen: Bearbeite Datum oder Zeitraum, bevor du diese Aktion erneut sendest.',
		);
	});

	it('keeps field validation sync failures actionable with a clear edit hint', async () => {
		apiFetchMock.mockResolvedValue({ ok: false, status: 400, error: 'name_invalid' });
		writeOfflineQueue([
			{
				id: 'shopping:ABC12345:test',
				type: 'shopping.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: { name: '', quantity: null },
			},
		]);

		const synced = await syncOfflineActions('ABC12345', { force: true });
		const queue = readOfflineQueue();

		expect(synced).toBe(0);
		expect(queue).toHaveLength(1);
		expect(queue[0]?.lastError).toBe(
			'Eintrag prüfen: Bearbeite die markierten Felder, bevor du diese Aktion erneut sendest.',
		);
	});

	it('keeps shopping status validation sync failures actionable with a clear edit hint', async () => {
		apiFetchMock.mockResolvedValue({ ok: false, status: 400, error: 'bought_invalid' });
		writeOfflineQueue([
			{
				id: 'shopping-update:ABC12345:test',
				type: 'shopping.update',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: { itemId: 'item-1', name: 'Milch', bought: true },
			},
		]);

		const synced = await syncOfflineActions('ABC12345', { force: true });
		const queue = readOfflineQueue();

		expect(synced).toBe(0);
		expect(queue).toHaveLength(1);
		expect(queue[0]?.lastError).toBe(
			'Status prüfen: Prüfe den Einkaufsstatus, bevor du diese Aktion erneut sendest.',
		);
	});

	it('keeps chore interval sync failures actionable with a clear edit hint', async () => {
		apiFetchMock.mockResolvedValue({ ok: false, status: 400, error: 'interval_invalid' });
		writeOfflineQueue([
			{
				id: 'chore-create:ABC12345:test',
				type: 'chore.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T12:00:00.000Z',
				payload: { title: 'Bad putzen', intervalDays: 0, assignedMemberId: null },
			},
		]);

		const synced = await syncOfflineActions('ABC12345', { force: true });
		const queue = readOfflineQueue();

		expect(synced).toBe(0);
		expect(queue).toHaveLength(1);
		expect(queue[0]?.lastError).toBe(
			'Intervall prüfen: Bearbeite das Intervall, bevor du diese Aktion erneut sendest.',
		);
	});
});
