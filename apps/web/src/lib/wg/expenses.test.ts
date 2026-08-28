import { beforeEach, describe, expect, it, vi } from 'vitest';

const whereMock = vi.fn();

vi.mock('@/lib/db', () => ({
	db: {
		select: () => ({
			from: () => ({
				where: (...args: unknown[]) => whereMock(...args),
			}),
		}),
	},
	wgMembers: { id: 'id', wgId: 'wgId' },
	expenses: {},
	expenseSplits: {},
	announcements: {},
}));

import { checkPaidByGuard, findExpenseMemberIds, resolveExpensePayer } from './expenses';

const CALLER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const OTHER_ID = 'bbbbbbbb-5ad7-4f5d-abed-8c3e99a76973';
const THIRD_ID = 'cccccccc-5ad7-4f5d-abed-8c3e99a76973';
const WG_ID = '989ac820-58b7-431f-9c65-28721264f333';

describe('resolveExpensePayer', () => {
	it('uses the body-provided payer when it is a valid UUID', () => {
		expect(resolveExpensePayer(OTHER_ID, CALLER_ID)).toBe(OTHER_ID);
	});

	it('falls back to the caller when the body value is missing', () => {
		expect(resolveExpensePayer(undefined, CALLER_ID)).toBe(CALLER_ID);
	});

	it('falls back to the caller when the body value is not a valid UUID shape', () => {
		expect(resolveExpensePayer('not-a-uuid', CALLER_ID)).toBe(CALLER_ID);
	});

	it('falls back to the caller when the body value is not a string', () => {
		expect(resolveExpensePayer(12345, CALLER_ID)).toBe(CALLER_ID);
	});
});

describe('checkPaidByGuard', () => {
	it('allows a self-paid expense regardless of debtors', () => {
		const result = checkPaidByGuard(CALLER_ID, CALLER_ID, [OTHER_ID]);
		expect(result).toEqual({ ok: true });
	});

	it('allows logging on behalf of someone else when the caller is also a debtor', () => {
		const result = checkPaidByGuard(OTHER_ID, CALLER_ID, [CALLER_ID, THIRD_ID]);
		expect(result).toEqual({ ok: true });
	});

	it('rejects fabricating a debt between two other members with the caller absent', () => {
		const result = checkPaidByGuard(OTHER_ID, CALLER_ID, [THIRD_ID]);
		expect(result).toEqual({ ok: false, reason: 'paid_by_must_include_caller' });
	});
});

describe('findExpenseMemberIds', () => {
	beforeEach(() => {
		whereMock.mockReset();
	});

	it('returns the subset of ids that exist as members of the WG', async () => {
		whereMock.mockResolvedValue([{ id: CALLER_ID }, { id: OTHER_ID }]);

		const result = await findExpenseMemberIds(WG_ID, [CALLER_ID, OTHER_ID, THIRD_ID]);

		expect(result).toEqual(new Set([CALLER_ID, OTHER_ID]));
	});

	it('returns an empty set when none of the ids belong to the WG', async () => {
		whereMock.mockResolvedValue([]);

		const result = await findExpenseMemberIds(WG_ID, [THIRD_ID]);

		expect(result.size).toBe(0);
	});
});
