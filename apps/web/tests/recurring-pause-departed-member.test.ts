// A recurring template whose participant has left can still be paused, but resuming it or changing
// its finances stays blocked while the split names an inactive member.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import * as schema from '../src/core/db/schema';
import { type Predicate, predicateOperators, rowMatches } from './support/drizzle-predicates';
import { mockModuleWithReal } from './support/module-mocks';
import { mockWgRouteInfrastructure } from './support/route-mocks';

const MEMBER_ID = '11111111-1111-4111-8111-111111111111';
const DEPARTED_ID = '22222222-2222-4222-8222-222222222222';
const TEMPLATE_ID = '33333333-3333-4333-8333-333333333333';

const memberRows = [
	{ id: MEMBER_ID, wgId: 'wg', deactivatedAt: null },
	{ id: DEPARTED_ID, wgId: 'wg', deactivatedAt: new Date('2026-09-01T00:00:00.000Z') },
];

/** The template and write counter of the request under test. */
let current = { template: {} as Record<string, unknown>, writes: 0 };

/** A thenable query chain that ignores every builder call and settles with `result`. */
function query(result: Promise<unknown>): unknown {
	const chain: unknown = new Proxy(
		{},
		{
			get: (_target, key) => {
				if (key === 'then') return result.then.bind(result);
				if (key === 'catch') return result.catch.bind(result);
				return () => chain;
			},
		},
	);
	return chain;
}

await mockWgRouteInfrastructure({
	requireWgMember: async () => ({
		ok: true,
		wg: { id: 'wg' },
		member: { memberId: MEMBER_ID, name: 'Anna' },
	}),
});
await mockModuleWithReal('@/core/db', {
	db: {
		select: () => ({
			from: (table: unknown) => ({
				where: (condition: Predicate) => {
					if (table === schema.recurringExpenses) return query(Promise.resolve([current.template]));
					// The member lookup answers with the rows its filter selects.
					return query(
						Promise.resolve(
							memberRows
								.filter((row) => rowMatches(schema.wgMembers, row, condition))
								.map(({ id }) => ({ id })),
						),
					);
				},
			}),
		}),
		update: () => ({
			set: (values: Record<string, unknown>) => ({
				where: () => ({
					returning: async () => {
						current.writes += 1;
						return [{ ...current.template, ...values }];
					},
				}),
			}),
		}),
	},
});
await mockModuleWithReal('@/core/guards/admin', { requireOwnerOrAdmin: async () => null });
await mockModuleWithReal('@/core/validators/currency', { currencySchema: z.string() });
await mockModuleWithReal('@/features/expenses/paid-by-guard', {
	checkPaidByGuard: () => ({ ok: true }),
});
await mockModuleWithReal('@/features/expenses/recurring-expenses', {
	parseRecurringSplits: JSON.parse,
	recurringSplitsMatchAmount: () => true,
	serializeRecurringExpense: (row: { splitsJson: string }) => ({
		...row,
		splits: JSON.parse(row.splitsJson),
	}),
});
await mockModuleWithReal('drizzle-orm', predicateOperators);

const { PATCH } = await import('../src/app/api/wg/[code]/recurring-expenses/[id]/route');
// withWgRoute is the identity here, so the handler receives the context the wrapper would build.
const handlerCtx = { code: 'code', id: TEMPLATE_ID } as never;

async function patchWithDepartedMember(body: Record<string, unknown>, paused = false) {
	current = {
		template: {
			id: TEMPLATE_ID,
			wgId: 'wg',
			createdByMemberId: MEMBER_ID,
			paidByMemberId: MEMBER_ID,
			description: 'Internet',
			amountCents: 1000,
			intervalMonths: 1,
			nextDueAt: new Date(),
			createdAt: new Date(),
			lastCreatedAt: null,
			pausedAt: paused ? new Date() : null,
			splitsJson: JSON.stringify([{ debtorMemberId: DEPARTED_ID, amountCents: 1000 }]),
		},
		writes: 0,
	};
	const response = await PATCH(
		new NextRequest('http://localhost', {
			method: 'PATCH',
			body: JSON.stringify(body),
		}),
		handlerCtx,
	);
	return { response, writes: current.writes };
}

describe('recurring template with a departed participant', () => {
	test('an existing subscription can be paused after a participant leaves', async () => {
		const { response, writes } = await patchWithDepartedMember({ paused: true });
		assert.equal(response.status, 200);
		assert.notEqual((await response.json()).recurringExpense.pausedAt, null);
		assert.equal(writes, 1);
	});

	test('inactive participants still block resuming and changing finances', async () => {
		for (const body of [{ paused: false }, { amountCents: 2000 }]) {
			const { response, writes } = await patchWithDepartedMember(body, true);
			assert.equal(response.status, 400);
			assert.deepEqual(await response.json(), { error: 'member_not_in_wg' });
			assert.equal(writes, 0);
		}
	});
});
