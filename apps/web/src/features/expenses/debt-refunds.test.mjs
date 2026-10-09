import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));

function loadTypeScript(relativePath, overrides = {}) {
	const source = transpileModule(readFileSync(path.join(process.cwd(), relativePath), 'utf8'), {
		compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
	}).outputText;
	const loaded = { exports: {} };
	new Function('require', 'module', 'exports', source)(
		(name) => (Object.hasOwn(overrides, name) ? overrides[name] : requireFromWeb(name)),
		loaded,
		loaded.exports,
	);
	return loaded.exports;
}

const { computeBalances } = loadTypeScript('src/features/expenses/debts.ts', {
	'@/core/utils/time': { MS_PER_DAY: 86_400_000 },
	'@/core/utils/money': { normalizeCurrency: (value) => value?.trim().toUpperCase() || 'EUR' },
});
const { buildSettlementSummary, computeDirectDebts, computeNetBalances, simplifyDebts } =
	loadTypeScript('src/features/expenses/debt-reduction.ts', {
		'@/core/utils/money': { normalizeCurrency: (value) => value?.trim().toUpperCase() || 'EUR' },
	});

const members = [
	{ id: 'A', name: 'A', color: null },
	{ id: 'B', name: 'B', color: null },
];

function expense(paidByMemberId, debtorMemberId, amountCents, currency = 'EUR') {
	return {
		paidByMemberId,
		currency,
		occurredAt: '2026-09-27T00:00:00.000Z',
		splits: [{ debtorMemberId, amountCents, settledAt: null }],
	};
}

function payment(fromMemberId, toMemberId, amountCents, currency = 'EUR') {
	return { fromMemberId, toMemberId, amountCents, currency };
}

function directRows(debts) {
	return debts.map(({ fromId, toId, cents, currency }) => ({ fromId, toId, cents, currency }));
}

function pairRows(debts) {
	return debts.map(({ debtorId, creditorId, amountCents, currency }) => ({
		fromId: debtorId,
		toId: creditorId,
		cents: amountCents,
		currency,
	}));
}

function canonicalDebts(expenses, payments) {
	return directRows(simplifyDebts(computeNetBalances(expenses, members, payments)));
}

test('reducing an expense keeps its overpayment as debt in the reverse direction', () => {
	const expenses = [expense('A', 'B', 500)];
	const payments = [payment('B', 'A', 1000)];
	const expected = [{ fromId: 'A', toId: 'B', cents: 500, currency: 'EUR' }];

	assert.deepEqual(pairRows(computeBalances(expenses, payments)), expected);
	assert.deepEqual(directRows(computeDirectDebts(expenses, members, payments)), expected);
	assert.deepEqual(canonicalDebts(expenses, payments), expected);
});

test('deleting an expense keeps the full payment as reverse debt', () => {
	const payments = [payment('B', 'A', 1000)];
	const expected = [{ fromId: 'A', toId: 'B', cents: 1000, currency: 'EUR' }];

	assert.deepEqual(pairRows(computeBalances([], payments)), expected);
	assert.deepEqual(directRows(computeDirectDebts([], members, payments)), expected);
	assert.deepEqual(canonicalDebts([], payments), expected);
});

test('reverse residuals combine with existing debt without crossing currencies', () => {
	const expenses = [expense('A', 'B', 500), expense('B', 'A', 300)];
	const payments = [payment('B', 'A', 1000), payment('B', 'A', 1000, 'USD')];
	const expected = [
		{ fromId: 'A', toId: 'B', cents: 800, currency: 'EUR' },
		{ fromId: 'A', toId: 'B', cents: 1000, currency: 'USD' },
	];

	assert.deepEqual(pairRows(computeBalances(expenses, payments)), expected);
	assert.deepEqual(directRows(computeDirectDebts(expenses, members, payments)), expected);
	assert.deepEqual(canonicalDebts(expenses, payments), expected);
});

test('direct summaries preserve gross positive debts in both directions', () => {
	const expenses = [expense('B', 'A', 300), expense('A', 'B', 200)];
	const direct = [
		{ fromId: 'A', toId: 'B', cents: 300, currency: 'EUR' },
		{ fromId: 'B', toId: 'A', cents: 200, currency: 'EUR' },
	];

	assert.deepEqual(directRows(computeDirectDebts(expenses, members)), direct);
	assert.equal(buildSettlementSummary(expenses, members).directCount, 2);
	assert.deepEqual(pairRows(computeBalances(expenses)), [
		{ fromId: 'A', toId: 'B', cents: 100, currency: 'EUR' },
	]);
});

test('direct and net summaries ignore payments from departed members', () => {
	const historicalPayment = [payment('departed', 'A', 1000)];

	assert.deepEqual(computeDirectDebts([], members, historicalPayment), []);
	assert.deepEqual(canonicalDebts([], historicalPayment), []);
});

test('a cash payment netted through a third member clears the chain instead of a reverse debt', () => {
	const expense = (paidBy, debtor, cents) => ({
		paidByMemberId: paidBy,
		currency: 'EUR',
		occurredAt: '2026-10-01T10:00:00.000Z',
		splits: [{ debtorMemberId: debtor, amountCents: cents, settledAt: null }],
	});
	const payments = [{ fromMemberId: 'A', toMemberId: 'C', amountCents: 1000, currency: 'EUR' }];
	assert.deepEqual(
		computeBalances([expense('B', 'A', 1000), expense('C', 'B', 1000)], payments),
		[],
	);
	const partial = computeBalances(
		[expense('B', 'A', 1000), expense('C', 'B', 1000)],
		[{ ...payments[0], amountCents: 400 }],
	);
	assert.deepEqual(
		partial.map((pair) => [pair.debtorId, pair.creditorId, pair.amountCents]).sort(),
		[
			['A', 'B', 600],
			['B', 'C', 600],
		],
	);
});

test('a netted payment also clears the chain when the payer is already owed a smaller amount', () => {
	const expense = (paidBy, debtor, cents) => ({
		paidByMemberId: paidBy,
		currency: 'EUR',
		occurredAt: '2026-10-01T10:00:00.000Z',
		splits: [{ debtorMemberId: debtor, amountCents: cents, settledAt: null }],
	});
	const balances = computeBalances(
		[expense('B', 'A', 2000), expense('C', 'B', 2000), expense('A', 'C', 500)],
		[{ fromMemberId: 'A', toMemberId: 'C', amountCents: 1500, currency: 'EUR' }],
	);
	assert.deepEqual(balances, []);
});

test('a payment that only reduces a direct debt still clears the circle it sits in', () => {
	const expense = (paidBy, debtor, cents) => ({
		paidByMemberId: paidBy,
		currency: 'EUR',
		occurredAt: '2026-10-01T10:00:00.000Z',
		splits: [{ debtorMemberId: debtor, amountCents: cents, settledAt: null }],
	});
	const balances = computeBalances(
		[expense('C', 'A', 100), expense('A', 'B', 100), expense('B', 'C', 200)],
		[{ fromMemberId: 'C', toMemberId: 'B', amountCents: 100, currency: 'EUR' }],
	);
	assert.deepEqual(balances, []);
});

test('equally short chains behind a payment resolve the same way in any row order', () => {
	// C pays A 1; A is owed through B→... and D→...: two chains of equal length close the circle.
	const rows = [
		expense('B', 'A', 100),
		expense('C', 'B', 100),
		expense('D', 'A', 100),
		expense('C', 'D', 100),
	];
	const payments = [payment('C', 'A', 100)];
	const forward = computeBalances(rows, payments);
	const backward = computeBalances([...rows].reverse(), payments);
	const key = (list) =>
		list
			.map((pair) => `${pair.debtorId}>${pair.creditorId}:${pair.amountCents}`)
			.sort()
			.join('|');
	assert.equal(key(forward), key(backward));
});
