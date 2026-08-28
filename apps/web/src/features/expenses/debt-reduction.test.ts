import { describe, expect, it } from 'vitest';
import {
	buildSettlementSummary,
	computeDirectDebts,
	computeNetBalances,
	simplifyDebts,
} from './debt-reduction';

const members = [
	{ id: 'alice', name: 'Alice', color: '#f97316' },
	{ id: 'ben', name: 'Ben', color: '#0ea5e9' },
	{ id: 'cora', name: 'Cora', color: null },
];

describe('computeDirectDebts', () => {
	it('groups unsettled real splits by debtor and payer', () => {
		const debts = computeDirectDebts(
			[
				{
					paidByMemberId: 'alice',
					splits: [
						{ debtorMemberId: 'alice', amountCents: 500, settledAt: null },
						{ debtorMemberId: 'ben', amountCents: 500, settledAt: null },
					],
				},
				{
					paidByMemberId: 'alice',
					splits: [{ debtorMemberId: 'ben', amountCents: 250, settledAt: null }],
				},
			],
			members,
		);

		expect(debts).toEqual([
			{ fromId: 'ben', fromName: 'Ben', toId: 'alice', toName: 'Alice', cents: 750 },
		]);
	});

	it('ignores payer own shares and already settled splits', () => {
		const debts = computeDirectDebts(
			[
				{
					paidByMemberId: 'alice',
					splits: [
						{ debtorMemberId: 'alice', amountCents: 600, settledAt: null },
						{ debtorMemberId: 'ben', amountCents: 600, settledAt: '2026-05-18T10:00:00.000Z' },
						{ debtorMemberId: 'cora', amountCents: 600, settledAt: null },
					],
				},
			],
			members,
		);

		expect(debts).toEqual([
			{ fromId: 'cora', fromName: 'Cora', toId: 'alice', toName: 'Alice', cents: 600 },
		]);
	});

	it('ignores explicit zero-cent splits when counting direct debts', () => {
		const debts = computeDirectDebts(
			[
				{
					paidByMemberId: 'alice',
					splits: [
						{ debtorMemberId: 'ben', amountCents: 0, settledAt: null },
						{ debtorMemberId: 'cora', amountCents: 1, settledAt: null },
					],
				},
			],
			members,
		);

		expect(debts).toEqual([
			{ fromId: 'cora', fromName: 'Cora', toId: 'alice', toName: 'Alice', cents: 1 },
		]);
		expect(
			buildSettlementSummary(
				[
					{
						paidByMemberId: 'alice',
						splits: [{ debtorMemberId: 'ben', amountCents: 0, settledAt: null }],
					},
				],
				members,
			),
		).toMatchObject({
			directCount: 0,
			totalOpenCents: 0,
		});
	});

	it('keeps direct debts separate when simplified netting would invent a payment path', () => {
		const expenses = [
			{
				paidByMemberId: 'alice',
				splits: [{ debtorMemberId: 'ben', amountCents: 1000, settledAt: null }],
			},
			{
				paidByMemberId: 'ben',
				splits: [{ debtorMemberId: 'cora', amountCents: 1000, settledAt: null }],
			},
		];

		expect(computeDirectDebts(expenses, members)).toEqual([
			{ fromId: 'ben', fromName: 'Ben', toId: 'alice', toName: 'Alice', cents: 1000 },
			{ fromId: 'cora', fromName: 'Cora', toId: 'ben', toName: 'Ben', cents: 1000 },
		]);
		expect(simplifyDebts(computeNetBalances(expenses, members))).toEqual([
			{ fromId: 'cora', fromName: 'Cora', toId: 'alice', toName: 'Alice', cents: 1000 },
		]);
	});
});

describe('buildSettlementSummary', () => {
	it('compares direct debts with the minimal transfer plan', () => {
		const expenses = [
			{
				paidByMemberId: 'alice',
				splits: [{ debtorMemberId: 'ben', amountCents: 1000, settledAt: null }],
			},
			{
				paidByMemberId: 'ben',
				splits: [{ debtorMemberId: 'cora', amountCents: 1000, settledAt: null }],
			},
		];

		expect(buildSettlementSummary(expenses, members)).toEqual({
			directCount: 2,
			simplifiedCount: 1,
			savedTransfers: 1,
			totalOpenCents: 2000,
			simplified: [
				{ fromId: 'cora', fromName: 'Cora', toId: 'alice', toName: 'Alice', cents: 1000 },
			],
		});
	});
});
