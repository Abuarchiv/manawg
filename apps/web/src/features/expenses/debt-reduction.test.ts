import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSettlementSummary, computeNetBalances, simplifyDebts } from './debt-reduction';

function member(id: string) {
	return { id, name: id, color: null };
}

function expense(paidByMemberId: string, shares: Record<string, number>) {
	return {
		paidByMemberId,
		currency: 'EUR',
		splits: Object.entries(shares).map(([debtorMemberId, amountCents]) => ({
			debtorMemberId,
			amountCents,
			settledAt: null,
		})),
	};
}

test('two independent groups settle with one transfer per debtor, not a cross-group chain', () => {
	const summary = buildSettlementSummary(
		[expense('A', { A: 200, B: 200 }), expense('C', { C: 200, D: 200, E: 100 })],
		['A', 'B', 'C', 'D', 'E'].map(member),
	);
	assert.equal(summary.simplified.length, 3);
	assert.deepEqual(
		summary.simplified.map(({ fromId, toId, cents }) => `${fromId}>${toId}:${cents}`).sort(),
		['B>A:200', 'D>C:200', 'E>C:100'],
	);
});

// The most disjoint groups the non-zero balances split into, by exhaustive search.
function maxZeroSumGroups(values: number[]): number {
	const best = new Array<number>(1 << values.length).fill(0);
	for (let mask = 1; mask < best.length; mask++) {
		let sum = 0;
		for (let i = 0; i < values.length; i++) if (mask & (1 << i)) sum += values[i] ?? 0;
		for (let i = 0; i < values.length; i++) {
			if (!(mask & (1 << i))) continue;
			best[mask] = Math.max(best[mask] ?? 0, (best[mask ^ (1 << i)] ?? 0) + (sum === 0 ? 1 : 0));
		}
	}
	return best[best.length - 1] ?? 0;
}

test('random balances settle in the fewest possible transfers', () => {
	let seed = 20261031;
	const random = (max: number) => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed % max;
	};
	for (let run = 0; run < 2000; run++) {
		const size = 3 + random(6);
		const cents = Array.from({ length: size - 1 }, () => random(7) - 3);
		cents.push(0 - cents.reduce((sum, value) => sum + value, 0));
		const balances = cents.map((value, index) => ({
			memberId: `m${index}`,
			memberName: `m${index}`,
			color: null,
			cents: value,
			currency: 'EUR',
		}));
		const nonZero = cents.filter((value) => value !== 0);
		const transfers = simplifyDebts(balances);
		assert.equal(transfers.length, nonZero.length - maxZeroSumGroups(nonZero), cents.join(','));
		const left = new Map(balances.map((balance) => [balance.memberId, balance.cents]));
		for (const transfer of transfers) {
			assert.ok(transfer.cents > 0);
			left.set(transfer.fromId, (left.get(transfer.fromId) ?? 0) + transfer.cents);
			left.set(transfer.toId, (left.get(transfer.toId) ?? 0) - transfer.cents);
		}
		for (const value of left.values()) assert.equal(value, 0, cents.join(','));
	}
});

test('a flat without expenses lists every member as settled in EUR', () => {
	assert.deepEqual(
		computeNetBalances([], ['A', 'B'].map(member), []).map(({ memberId, cents, currency }) => [
			memberId,
			cents,
			currency,
		]),
		[
			['A', 0, 'EUR'],
			['B', 0, 'EUR'],
		],
	);
});

test('suggestions come in currency order, whatever order the balances arrive in', () => {
	const balance = (memberId: string, cents: number, currency: string) => ({
		memberId,
		memberName: memberId,
		color: null,
		cents,
		currency,
	});
	const debts = simplifyDebts([
		balance('A', 100, 'EUR'),
		balance('B', -100, 'EUR'),
		balance('A', 50, 'CHF'),
		balance('B', -50, 'CHF'),
	]);
	assert.deepEqual(
		debts.map((d) => d.currency),
		['CHF', 'EUR'],
	);
});

test('many open balances settle without the exact group search', { timeout: 5_000 }, () => {
	// 2^30 subsets would not even fit in memory; above 16 balances one greedy pass runs instead.
	const members = Array.from({ length: 31 }, (_, i) => member(`m${String(i).padStart(2, '0')}`));
	const shares = Object.fromEntries(members.slice(1).map((m, i) => [m.id, 100 + i]));
	const summary = buildSettlementSummary([expense('m00', shares)], members);
	assert.equal(summary.simplified.length, 30);
	assert.ok(summary.simplified.every((d) => d.toId === 'm00'));
});
