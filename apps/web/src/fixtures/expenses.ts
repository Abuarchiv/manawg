import type { E2EWgFixture } from './data';

const MONTH_ENTRIES = [
	{ description: 'Wocheneinkauf', category: 'groceries', amountCents: 8640, day: 3 },
	{ description: 'Internet', category: 'housing', amountCents: 3290, day: 5 },
	{ description: 'Spülmittel und Schwämme', category: 'household', amountCents: 1240, day: 9 },
	{ description: 'Kinoabend', category: 'leisure', amountCents: 3600, day: 14 },
	{ description: 'Monatsticket', category: 'transport', amountCents: 4900, day: 17 },
	{ description: 'Geschenk für Mina', category: 'other', amountCents: 2500, day: 21 },
] as const;

/** Expenses of the previous month, newest first like the expenses API, so the monthly statement (default month) has content. */
export function buildE2EExpenses(fixture: E2EWgFixture) {
	const now = new Date();
	const memberIds = fixture.members.map((member) => member.id);
	return MONTH_ENTRIES.map((entry, index) => {
		const occurredAt = new Date(
			Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, entry.day, 12),
		).toISOString();
		const id = `00000000-0000-4000-8000-00000000e${String(index).padStart(3, '0')}`;
		const payer = memberIds[index % memberIds.length] ?? '';
		const half = Math.floor(entry.amountCents / memberIds.length);
		return {
			id,
			wgId: fixture.id,
			paidByMemberId: payer,
			amountCents: entry.amountCents,
			currency: 'EUR',
			description: entry.description,
			category: entry.category,
			imageUrl: null,
			occurredAt,
			createdAt: occurredAt,
			updatedAt: occurredAt,
			splits: memberIds.map((debtorMemberId, splitIndex) => ({
				id: `${id}-s${splitIndex}`,
				expenseId: id,
				debtorMemberId,
				amountCents: splitIndex === 0 ? entry.amountCents - half * (memberIds.length - 1) : half,
				settledAt: debtorMemberId === payer ? occurredAt : null,
			})),
		};
	}).reverse();
}
