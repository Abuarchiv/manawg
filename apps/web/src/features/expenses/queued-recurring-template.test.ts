import assert from 'node:assert/strict';
import test from 'node:test';
import type { OfflineAction } from '@/core/offline/offline-queue';

const { findQueuedRecurringTemplate } = await import('./queued-recurring-template');

const dueAt = Date.parse('2026-12-01T11:00:00.000Z');
const action = (payload: Record<string, unknown> = {}, over: Partial<OfflineAction> = {}) =>
	({
		id: 'recurring:CODE:1',
		type: 'recurring.create',
		wgId: 'wg-1',
		shareCode: 'CODE',
		memberId: 'anna',
		createdAt: '2026-11-01T10:00:00.000Z',
		payload: {
			description: 'Internet',
			amountCents: 1001,
			paidByMemberId: 'anna',
			intervalMonths: 1,
			nextDueAt: new Date(dueAt).toISOString(),
			splits: [
				{ debtorMemberId: 'ben', amountCents: 500 },
				{ debtorMemberId: 'anna', amountCents: 501 },
			],
			...payload,
		},
		...over,
	}) as OfflineAction;

const input = {
	wgId: 'wg-1',
	shareCode: 'CODE',
	memberId: 'anna',
	description: 'Internet',
	amountCents: 1001,
	paidByMemberId: 'anna',
	intervalMonths: 1,
	splits: [
		{ debtorMemberId: 'anna', amountCents: 500 },
		{ debtorMemberId: 'ben', amountCents: 501 },
	],
	splitMode: 'equal' as 'equal' | 'manual',
	queuedNextDueAt: null,
};
const find = (queue: OfflineAction[], over: Partial<typeof input> = {}) =>
	findQueuedRecurringTemplate({ ...input, ...over, queue } as never);

test('an equal split with the leftover cent on another member is the same template', () => {
	const queued = action();
	assert.equal(find([queued]), queued);
	assert.equal(find([queued], { queuedNextDueAt: dueAt } as never), queued);
});

test('a manual split must match share for share', () => {
	assert.equal(find([action()], { splitMode: 'manual' }), undefined);
	const exact = action({
		splits: [
			{ debtorMemberId: 'ben', amountCents: 501 },
			{ debtorMemberId: 'anna', amountCents: 500 },
		],
	});
	assert.equal(find([exact], { splitMode: 'manual' }), exact);
});

test('equal splits differ only by one cent and must cover the same members and sum', () => {
	const skewed = action({
		amountCents: 1001,
		splits: [
			{ debtorMemberId: 'ben', amountCents: 499 },
			{ debtorMemberId: 'anna', amountCents: 502 },
		],
	});
	assert.equal(find([skewed]), undefined);
	const short = action({
		splits: [
			{ debtorMemberId: 'ben', amountCents: 500 },
			{ debtorMemberId: 'anna', amountCents: 500 },
		],
	});
	assert.equal(find([short]), undefined);
	const otherMember = action({
		splits: [
			{ debtorMemberId: 'cem', amountCents: 500 },
			{ debtorMemberId: 'anna', amountCents: 501 },
		],
	});
	assert.equal(find([otherMember]), undefined);
	const single = action({ splits: [{ debtorMemberId: 'ben', amountCents: 1001 }] });
	assert.equal(find([single], { splits: [{ debtorMemberId: 'ben', amountCents: 1001 }] }), single);
});

test('with three members two cents apart the queued split is a different one', () => {
	const three = (a: number, b: number, c: number) => [
		{ debtorMemberId: 'anna', amountCents: a },
		{ debtorMemberId: 'ben', amountCents: b },
		{ debtorMemberId: 'cem', amountCents: c },
	];
	assert.equal(
		find([action({ splits: three(334, 334, 333) })], { splits: three(333, 334, 334) }) !==
			undefined,
		true,
	);
	assert.equal(
		find([action({ splits: three(333, 333, 335) })], { splits: three(333, 334, 334) }),
		undefined,
	);
});

test('another type, WG, member or field never counts as the same template', () => {
	const differing: OfflineAction[] = [
		action({}, { type: 'expense.create' }),
		action({}, { wgId: 'wg-2' }),
		action({}, { shareCode: 'OTHER' }),
		action({}, { memberId: 'ben' }),
		action({ description: 'Strom' }),
		action({ amountCents: 1002 }),
		action({ paidByMemberId: 'ben' }),
		action({ intervalMonths: 3 }),
	];
	for (const queued of differing) assert.equal(find([queued]), undefined, JSON.stringify(queued));
	assert.equal(find([action()], { queuedNextDueAt: dueAt + 1 } as never), undefined);
});

test('a queued payload of the wrong shape is ignored', () => {
	const broken = [
		{ description: 1 },
		{ amountCents: '1001' },
		{ paidByMemberId: null },
		{ intervalMonths: '1' },
		{ nextDueAt: 0 },
		{ splits: 'none' },
		{ splits: [null, { debtorMemberId: 'anna', amountCents: 1001 }] },
		{ splits: ['anna'] },
		{
			splits: [
				{ debtorMemberId: 1, amountCents: 500 },
				{ debtorMemberId: 'anna', amountCents: 501 },
			],
		},
		{ splits: [{ debtorMemberId: 'anna', amountCents: '1001' }] },
		{ splits: [{ amountCents: 1001 }] },
		{ splits: [{ debtorMemberId: 'anna' }] },
	];
	for (const payload of broken)
		assert.equal(find([action(payload)]), undefined, JSON.stringify(payload));
});
