import { describe, expect, it } from 'vitest';
import {
	buildEqualSplits,
	distributeCentsEqually,
	rotateDebtors,
	validateSplits,
} from './split-math';

describe('distributeCentsEqually — Hamilton / largest-remainder', () => {
	it('splits exactly when amount is divisible by n', () => {
		expect(distributeCentsEqually(900, ['a', 'b', 'c'])).toEqual([300, 300, 300]);
	});

	it('gives the remainder cent to the first debtor for 10€/3 (the classic case)', () => {
		// 1000 cents / 3 = 333 base + 1 leftover → [334, 333, 333]
		const shares = distributeCentsEqually(1000, ['a', 'b', 'c']);
		expect(shares).toEqual([334, 333, 333]);
		expect(shares.reduce((s, x) => s + x, 0)).toBe(1000);
	});

	it('preserves the single cent for 1c / 2 (never silently loses debt)', () => {
		// 1 cent split 2 ways must NOT round both to zero
		const shares = distributeCentsEqually(1, ['a', 'b']);
		expect(shares).toEqual([1, 0]);
		expect(shares.reduce((s, x) => s + x, 0)).toBe(1);
	});

	it('keeps max - min <= 1 cent for every plausible total', () => {
		for (let amount = 0; amount < 200; amount++) {
			for (let n = 1; n <= 7; n++) {
				const ids = Array.from({ length: n }, (_, i) => `m${i}`);
				const shares = distributeCentsEqually(amount, ids);
				const max = Math.max(...shares);
				const min = Math.min(...shares);
				expect(max - min, `amount=${amount} n=${n}`).toBeLessThanOrEqual(1);
				expect(
					shares.reduce((s, x) => s + x, 0),
					`amount=${amount} n=${n}`,
				).toBe(amount);
			}
		}
	});

	it('rejects non-integer / negative / fractional amounts', () => {
		expect(() => distributeCentsEqually(1.5, ['a'])).toThrow();
		expect(() => distributeCentsEqually(-1, ['a'])).toThrow();
		expect(() => distributeCentsEqually(Number.NaN, ['a'])).toThrow();
		expect(() => distributeCentsEqually(Number.POSITIVE_INFINITY, ['a'])).toThrow();
	});

	it('rejects empty debtor list', () => {
		expect(() => distributeCentsEqually(100, [])).toThrow();
	});
});

describe('buildEqualSplits', () => {
	it('pairs each debtor with their share in order', () => {
		expect(buildEqualSplits(1000, ['alice', 'ben', 'cora'])).toEqual([
			{ debtorMemberId: 'alice', amountCents: 334 },
			{ debtorMemberId: 'ben', amountCents: 333 },
			{ debtorMemberId: 'cora', amountCents: 333 },
		]);
	});

	it('rotates the "+1 cent" recipient when rotationOffset is non-zero', () => {
		// Same 1000/3 split, but rotationOffset=1 shifts the starting debtor —
		// now Ben pays the extra cent instead of Alice.
		expect(buildEqualSplits(1000, ['alice', 'ben', 'cora'], 1)).toEqual([
			{ debtorMemberId: 'ben', amountCents: 334 },
			{ debtorMemberId: 'cora', amountCents: 333 },
			{ debtorMemberId: 'alice', amountCents: 333 },
		]);
		expect(buildEqualSplits(1000, ['alice', 'ben', 'cora'], 2)).toEqual([
			{ debtorMemberId: 'cora', amountCents: 334 },
			{ debtorMemberId: 'alice', amountCents: 333 },
			{ debtorMemberId: 'ben', amountCents: 333 },
		]);
	});

	it('every debtor eats the +1 cent equally often across 3*n expenses', () => {
		// Over 9 expenses of 1000/3, each debtor should land on the "+1 cent"
		// slot exactly 3 times when callers pass expense index as rotation.
		const debtors = ['alice', 'ben', 'cora'];
		const remainderCount = new Map<string, number>();
		for (let i = 0; i < 9; i++) {
			const splits = buildEqualSplits(1000, debtors, i);
			const remainderSplit = splits.find((s) => s.amountCents === 334);
			if (!remainderSplit) throw new Error('expected remainder split with 334 cents');
			const winner = remainderSplit.debtorMemberId;
			remainderCount.set(winner, (remainderCount.get(winner) ?? 0) + 1);
		}
		expect(remainderCount.get('alice')).toBe(3);
		expect(remainderCount.get('ben')).toBe(3);
		expect(remainderCount.get('cora')).toBe(3);
	});
});

describe('rotateDebtors', () => {
	it('returns same order for offset=0', () => {
		expect(rotateDebtors(['a', 'b', 'c'], 0)).toEqual(['a', 'b', 'c']);
	});

	it('shifts left by offset positions', () => {
		expect(rotateDebtors(['a', 'b', 'c'], 1)).toEqual(['b', 'c', 'a']);
		expect(rotateDebtors(['a', 'b', 'c'], 2)).toEqual(['c', 'a', 'b']);
	});

	it('wraps around for offset >= length', () => {
		expect(rotateDebtors(['a', 'b', 'c'], 3)).toEqual(['a', 'b', 'c']);
		expect(rotateDebtors(['a', 'b', 'c'], 7)).toEqual(['b', 'c', 'a']);
	});

	it('normalizes negative offsets', () => {
		expect(rotateDebtors(['a', 'b', 'c'], -1)).toEqual(['c', 'a', 'b']);
	});

	it('handles empty input safely', () => {
		expect(rotateDebtors([], 5)).toEqual([]);
	});
});

describe('validateSplits', () => {
	it('accepts a clean split whose sum matches the total', () => {
		const result = validateSplits(1000, [
			{ debtorMemberId: 'a', amountCents: 334 },
			{ debtorMemberId: 'b', amountCents: 333 },
			{ debtorMemberId: 'c', amountCents: 333 },
		]);
		expect(result).toEqual({
			ok: true,
			splits: [
				{ debtorMemberId: 'a', amountCents: 334 },
				{ debtorMemberId: 'b', amountCents: 333 },
				{ debtorMemberId: 'c', amountCents: 333 },
			],
		});
	});

	it('rejects empty splits', () => {
		expect(validateSplits(100, [])).toEqual({ ok: false, reason: 'empty' });
	});

	it('rejects duplicate debtor ids (would create double-debt rows)', () => {
		expect(
			validateSplits(200, [
				{ debtorMemberId: 'a', amountCents: 100 },
				{ debtorMemberId: 'a', amountCents: 100 },
			]),
		).toEqual({ ok: false, reason: 'duplicate_debtor' });
	});

	it('rejects sum mismatch', () => {
		expect(
			validateSplits(1000, [
				{ debtorMemberId: 'a', amountCents: 500 },
				{ debtorMemberId: 'b', amountCents: 499 },
			]),
		).toEqual({ ok: false, reason: 'sum_mismatch' });
	});

	it('rejects non-integer / non-finite cents (defense in depth on top of zod)', () => {
		expect(
			validateSplits(100, [
				{ debtorMemberId: 'a', amountCents: 50.5 },
				{ debtorMemberId: 'b', amountCents: 49.5 },
			]),
		).toEqual({ ok: false, reason: 'invalid_amount' });
		expect(validateSplits(100, [{ debtorMemberId: 'a', amountCents: Number.NaN }])).toEqual({
			ok: false,
			reason: 'invalid_amount',
		});
		expect(validateSplits(100, [{ debtorMemberId: 'a', amountCents: -50 }])).toEqual({
			ok: false,
			reason: 'invalid_amount',
		});
	});

	it('accepts a 0-cent split (e.g. 1c / 2 → [1,0]) — does not silently drop the second debtor', () => {
		const result = validateSplits(1, [
			{ debtorMemberId: 'a', amountCents: 1 },
			{ debtorMemberId: 'b', amountCents: 0 },
		]);
		expect(result.ok).toBe(true);
	});
});
