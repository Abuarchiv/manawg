import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	CALLER_ID,
	EXPENSE_ID,
	PAYER_ID,
	type Predicate,
	WG_ID,
	errorOf,
	installWgRouteMocks,
	jsonRequest,
	matches,
	routeContext,
	tables,
	thenableQuery,
} from './support/expense-route-fakes.ts';

// Expense [id] and split-settle routes against fake databases [suite "expense integrity regressions"]: authorization is rechecked under the payment lock, expenses
// are scoped to the WG, and a PATCH keeps splits consistent with concurrent amount changes.

const env = installWgRouteMocks();
const { DELETE, PATCH } = await import('../src/app/api/wg/[code]/expenses/[id]/route.ts');
const { POST: settle } = await import(
	'../src/app/api/wg/[code]/expenses/[id]/splits/[splitId]/settle/route.ts'
);
const { expenseSplits, expenses, wgChatMessages } = tables;

test('expense DELETE rechecks authorization and blocks an active capture under the payment lock', async () => {
	let locked = false;
	let callerIsDebtor = true;
	let removeDebtorAtLock = true;
	let capturing = false;
	let deleted = 0;
	let lockedReads = 0;
	let captureChecks = 0;
	const expenseRow = { paidByMemberId: PAYER_ID, description: 'Einkauf', amountCents: 1200 };

	const makeSelect = (insideTransaction: boolean) => {
		let table: unknown;
		const query = {
			from(nextTable: unknown) {
				table = nextTable;
				return query;
			},
			where() {
				if (insideTransaction) {
					if (!locked) throw new Error('transaction read escaped payment lock');
					lockedReads += 1;
				}
				return query;
			},
			limit: async () => {
				if (table === expenses) return [expenseRow];
				if (table === expenseSplits) {
					return callerIsDebtor ? [{ debtorMemberId: CALLER_ID }] : [];
				}
				return [];
			},
		};
		return query;
	};

	const tx = {
		select: () => makeSelect(true),
		delete: () => ({
			where() {
				return {
					returning: async () => {
						deleted += 1;
						return [{ id: EXPENSE_ID }];
					},
				};
			},
		}),
	};
	env.db = { select: () => makeSelect(false) } as never;
	env.payments = {
		withExpensePaymentLock: async (
			_wgId: string,
			operation: (value: typeof tx) => Promise<unknown>,
		) => {
			locked = true;
			if (removeDebtorAtLock) callerIsDebtor = false;
			try {
				return await operation(tx);
			} finally {
				locked = false;
			}
		},
		hasCapturingExpensePayment: async () => {
			captureChecks += 1;
			return capturing;
		},
	} as never;

	const response = await DELETE(jsonRequest('DELETE'), routeContext({ id: EXPENSE_ID }));

	assert.equal(response.status, 403);
	assert.equal(await errorOf(response), 'not_owner');
	assert.equal(lockedReads, 2);
	assert.equal(deleted, 0);

	removeDebtorAtLock = false;
	callerIsDebtor = true;
	capturing = true;
	const captureResponse = await DELETE(jsonRequest('DELETE'), routeContext({ id: EXPENSE_ID }));
	assert.equal(captureResponse.status, 409);
	assert.equal(await errorOf(captureResponse), 'paypal_payment_pending');
	assert.equal(captureChecks, 1);
	assert.equal(deleted, 0);
});

test('expense DELETE refuses an expense with a settled share of someone else', async () => {
	let deleted = 0;
	const tx = {
		select: () => ({
			from: (table: unknown) => ({
				where: () => ({
					limit: async () =>
						table === expenses
							? [{ paidByMemberId: CALLER_ID, description: 'Einkauf' }]
							: [{ id: 'split-1' }],
				}),
			}),
		}),
		delete: () => ({
			where: () => ({
				returning: async () => {
					deleted += 1;
					return [{ id: EXPENSE_ID }];
				},
			}),
		}),
	};
	env.payments = {
		withExpensePaymentLock: async (
			_wgId: string,
			operation: (value: typeof tx) => Promise<unknown>,
		) => operation(tx),
		hasCapturingExpensePayment: async () => false,
	} as never;

	const response = await DELETE(jsonRequest('DELETE'), routeContext({ id: EXPENSE_ID }));
	assert.equal(response.status, 409);
	assert.equal(await errorOf(response), 'expense_has_settled_shares');
	assert.equal(deleted, 0);
});

test('expense DELETE withdraws its chat notice in the same transaction', async () => {
	const updated: Array<{ table: unknown; values: Record<string, unknown> }> = [];
	const tx = {
		select: () => ({
			from: (table: unknown) => ({
				where: () => ({
					limit: async () =>
						table === expenses
							? [{ paidByMemberId: CALLER_ID, description: 'Einkauf', amountCents: 1200 }]
							: [],
				}),
			}),
		}),
		delete: () => ({ where: () => ({ returning: async () => [{ id: EXPENSE_ID }] }) }),
		update: (table: unknown) => ({
			set: (values: Record<string, unknown>) => ({
				where: async () => {
					updated.push({ table, values });
				},
			}),
		}),
	};
	env.payments = {
		withExpensePaymentLock: async (
			_wgId: string,
			operation: (value: typeof tx) => Promise<unknown>,
		) => operation(tx),
		hasCapturingExpensePayment: async () => false,
	} as never;

	const response = await DELETE(jsonRequest('DELETE'), routeContext({ id: EXPENSE_ID }));

	assert.equal(response.status, 200);
	assert.equal(updated.length, 1);
	assert.equal(updated[0]?.table, wgChatMessages);
	assert.ok(updated[0]?.values.deletedAt instanceof Date);
	assert.equal(updated[0]?.values.systemPayload, null);
});

test('split settle authenticates before lookup and scopes expenses to the WG', async () => {
	const foreignExpense = {
		id: EXPENSE_ID,
		wgId: '3c149bad-33c6-4a32-bb6d-196a65d1e741',
		description: 'Private Ausgabe',
		paidByMemberId: PAYER_ID,
	};
	let authorized = false;
	let lookups = 0;
	env.db = {
		select: () => {
			lookups += 1;
			let condition: Predicate;
			return {
				from: () => ({
					where: (nextCondition: Predicate) => {
						condition = nextCondition;
						return {
							limit: async () => (matches(foreignExpense, condition) ? [foreignExpense] : []),
						};
					},
				}),
			};
		},
	} as never;
	env.requireWgMember = async () =>
		authorized
			? { ok: true, wg: { id: WG_ID }, member: { memberId: CALLER_ID } }
			: { ok: false, response: Response.json({ error: 'unauthorized' }, { status: 401 }) };
	const request = () => jsonRequest('POST', { settled: true });
	for (const id of [EXPENSE_ID, PAYER_ID]) {
		const response = await settle(request(), routeContext({ id, splitId: CALLER_ID }));
		assert.equal(response.status, 401);
	}
	assert.equal(lookups, 0);
	authorized = true;
	const response = await settle(request(), routeContext({ id: EXPENSE_ID, splitId: CALLER_ID }));
	assert.equal(response.status, 404);
	assert.equal(await errorOf(response), 'expense_not_found');
	assert.equal(lookups, 1);
});

test('expense PATCH preserves split integrity with fractional timestamps and concurrent amount changes', async () => {
	const { wgMembers } = tables;
	const debtorId = 'f2e2a748-3888-44fc-8c3c-6badfcad5690';
	const departedId = '9f2f0a21-b135-4d08-b1bd-846b034e7e90';
	const initialUpdatedAt = new Date('2026-09-20T00:00:00.123Z');
	const concurrentUpdatedAt = new Date('2026-09-20T00:00:00.123Z');
	let mutateAtLock = true;
	let capturing = false;
	let currentExpense = {
		id: EXPENSE_ID,
		wgId: WG_ID,
		paidByMemberId: CALLER_ID,
		amountCents: 1200,
		updatedAt: initialUpdatedAt,
		updatedAtPrecise: '2026-09-20T00:00:00.123456Z',
		description: 'Einkauf',
		currency: 'EUR',
		imageUrl: null,
	};
	let currentSplits: Array<Record<string, unknown>> = [
		{ expenseId: EXPENSE_ID, debtorMemberId: debtorId, amountCents: 1200, settledAt: null },
	];
	const members = [
		{ id: debtorId, wgId: WG_ID, deactivatedAt: null },
		{ id: CALLER_ID, wgId: WG_ID, deactivatedAt: null },
		{ id: departedId, wgId: WG_ID, deactivatedAt: new Date('2026-09-01T00:00:00.000Z') },
	];
	const makeSelect = () => {
		let table: unknown;
		let condition: Predicate | undefined;
		const rows = () => {
			const allRows =
				table === expenses
					? [currentExpense]
					: table === expenseSplits
						? currentSplits
						: table === wgMembers
							? members
							: [];
			return allRows.filter((row) => !condition || matches(row, condition));
		};
		const query = {
			from(nextTable: unknown) {
				table = nextTable;
				return query;
			},
			where(nextCondition: Predicate) {
				condition = nextCondition;
				return query;
			},
			...thenableQuery(rows),
		};
		return query;
	};
	const tx = {
		select: makeSelect,
		update: () => ({
			set: (values: Record<string, unknown>) => ({
				where: (condition: Predicate) => ({
					returning: async () => {
						if (!matches(currentExpense, condition)) return [];
						const updatedAt =
							(values.updatedAt as Predicate).kind === 'nextVersion'
								? new Date(Math.max(Date.now(), currentExpense.updatedAt.getTime() + 1))
								: (values.updatedAt as Date);
						currentExpense = {
							...currentExpense,
							...values,
							updatedAt,
							updatedAtPrecise: updatedAt.toISOString(),
						};
						return [{ id: EXPENSE_ID }];
					},
				}),
			}),
		}),
		delete: (table: unknown) => ({
			where: (condition: Predicate) => {
				if (table === expenseSplits) {
					currentSplits = currentSplits.filter((split) => !matches(split, condition));
				}
				return Promise.resolve([]);
			},
		}),
		insert: (table: unknown) => ({
			values: (values: Array<Record<string, unknown>>) => ({
				returning: async () => {
					if (table === expenseSplits) currentSplits = values;
					return values.map(() => ({ expenseId: EXPENSE_ID }));
				},
			}),
		}),
	};
	env.db = { select: makeSelect } as never;
	env.payments = {
		hasCapturingExpensePayment: async () => capturing,
		withExpensePaymentLock: async (
			_wgId: string,
			operation: (value: typeof tx) => Promise<unknown>,
		) => {
			if (mutateAtLock) {
				currentExpense = {
					...currentExpense,
					amountCents: 2000,
					updatedAt: concurrentUpdatedAt,
					updatedAtPrecise: '2026-09-20T00:00:00.123789Z',
				};
				currentSplits = [
					{ expenseId: EXPENSE_ID, debtorMemberId: debtorId, amountCents: 2000, settledAt: null },
				];
			}
			return operation(tx);
		},
	} as never;
	const patch = (body: unknown) =>
		PATCH(jsonRequest('PATCH', body), routeContext({ id: EXPENSE_ID }));

	const response = await patch({
		expectedUpdatedAt: initialUpdatedAt.toISOString(),
		splits: [{ debtorMemberId: debtorId, amountCents: 1200 }],
	});

	assert.equal(response.status, 409);
	assert.equal(await errorOf(response), 'expense_changed');
	assert.equal(currentExpense.amountCents, 2000);
	assert.deepEqual(currentSplits, [
		{ expenseId: EXPENSE_ID, debtorMemberId: debtorId, amountCents: 2000, settledAt: null },
	]);

	mutateAtLock = false;
	const priorVersion = new Date('2100-01-01T00:00:00.000Z');
	currentExpense = {
		...currentExpense,
		updatedAt: priorVersion,
		updatedAtPrecise: priorVersion.toISOString(),
	};
	const ordinaryResponse = await patch({
		expectedUpdatedAt: currentExpense.updatedAt.toISOString(),
		splits: [{ debtorMemberId: debtorId, amountCents: 2000 }],
	});
	assert.equal(ordinaryResponse.status, 200);
	assert.ok(currentExpense.updatedAt.getTime() > priorVersion.getTime());
	const mismatchedResponse = await patch({
		splits: [{ debtorMemberId: debtorId, amountCents: 1900 }],
	});
	assert.equal(mismatchedResponse.status, 400);
	assert.equal(await errorOf(mismatchedResponse), 'splits_sum_mismatch');
	assert.equal(currentExpense.amountCents, 2000);
	assert.deepEqual(currentSplits, [
		{ expenseId: EXPENSE_ID, debtorMemberId: debtorId, amountCents: 2000, settledAt: null },
	]);

	const historicalSplits = [
		{
			expenseId: EXPENSE_ID,
			debtorMemberId: CALLER_ID,
			amountCents: 1000,
			settledAt: new Date('2026-09-10T00:00:00.000Z'),
		},
		{ expenseId: EXPENSE_ID, debtorMemberId: departedId, amountCents: 1000, settledAt: null },
	];
	currentSplits = historicalSplits;
	const unchangedHistoricalResponse = await patch({
		description: 'Historischer Einkauf',
		splits: [
			{ debtorMemberId: CALLER_ID, amountCents: 1000 },
			{ debtorMemberId: departedId, amountCents: 1000 },
		],
	});
	assert.equal(unchangedHistoricalResponse.status, 200);
	assert.deepEqual(currentSplits, historicalSplits);

	const removedHistoricalResponse = await patch({
		description: 'Versucht den historischen Anteil zu entfernen',
		splits: [{ debtorMemberId: CALLER_ID, amountCents: 2000 }],
	});
	assert.equal(removedHistoricalResponse.status, 400);
	assert.equal(await errorOf(removedHistoricalResponse), 'member_not_in_wg');
	assert.equal(currentExpense.description, 'Historischer Einkauf');
	assert.deepEqual(currentSplits, historicalSplits);

	currentSplits = [
		{ expenseId: EXPENSE_ID, debtorMemberId: CALLER_ID, amountCents: 2000, settledAt: null },
	];
	const newlyIntroducedResponse = await patch({
		description: 'Darf keinen neuen inaktiven Anteil anlegen',
		splits: [
			{ debtorMemberId: CALLER_ID, amountCents: 1000 },
			{ debtorMemberId: departedId, amountCents: 1000 },
		],
	});
	assert.equal(newlyIntroducedResponse.status, 400);
	assert.equal(await errorOf(newlyIntroducedResponse), 'member_not_in_wg');
	assert.equal(currentExpense.description, 'Historischer Einkauf');
	assert.deepEqual(currentSplits, [
		{ expenseId: EXPENSE_ID, debtorMemberId: CALLER_ID, amountCents: 2000, settledAt: null },
	]);

	const settledSplits = [
		{ expenseId: EXPENSE_ID, debtorMemberId: CALLER_ID, amountCents: 1000, settledAt: null },
		{
			expenseId: EXPENSE_ID,
			debtorMemberId: debtorId,
			amountCents: 1000,
			settledAt: new Date('2026-09-12T00:00:00.000Z'),
		},
	];
	currentSplits = settledSplits;
	const reopenedSettledResponse = await patch({
		amountCents: 2400,
		splits: [
			{ debtorMemberId: CALLER_ID, amountCents: 1200 },
			{ debtorMemberId: debtorId, amountCents: 1200 },
		],
	});
	assert.equal(reopenedSettledResponse.status, 409);
	assert.equal(await errorOf(reopenedSettledResponse), 'expense_has_settled_shares');
	assert.deepEqual(currentSplits, settledSplits);
	const keptSettledResponse = await patch({
		amountCents: 2400,
		splits: [
			{ debtorMemberId: CALLER_ID, amountCents: 1400 },
			{ debtorMemberId: debtorId, amountCents: 1000 },
		],
	});
	assert.equal(keptSettledResponse.status, 200);
	assert.deepEqual(
		currentSplits.find((split) => split.debtorMemberId === debtorId)?.settledAt,
		settledSplits[1]?.settledAt,
	);

	capturing = true;
	const blockedFinancialEdit = await patch({ currency: 'USD' });
	assert.equal(blockedFinancialEdit.status, 409);
	assert.equal(await errorOf(blockedFinancialEdit), 'paypal_payment_pending');
	assert.equal(currentExpense.currency, 'EUR');
	const cosmeticEdit = await patch({ description: 'Nur Text' });
	assert.equal(cosmeticEdit.status, 200);
	assert.equal(currentExpense.description, 'Nur Text');
});
