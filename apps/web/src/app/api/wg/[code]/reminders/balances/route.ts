import { db, wgMembers } from '@/lib/db';
import { computeBalances, computeOldestDebtAgeDays } from '@/lib/wg/debts';
import { loadOpenExpenses } from '@/lib/wg/open-expenses';
import { requireWgMember } from '@/lib/wg/require-wg-member';
import { withWgRoute } from '@/lib/wg/with-wg-route';
import { inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';

interface BalanceDto {
	debtor_id: string;
	debtor_name: string;
	amount_cents: number;
	oldest_age_days: number;
}

export const GET = withWgRoute(
	'reminders/balances GET',
	async (req, { code }) => {
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;

		const openExpenses = await loadOpenExpenses(wgId);
		const allBalances = computeBalances(openExpenses);
		const myCredits = allBalances.filter((p) => p.creditorId === auth.member.memberId);

		if (myCredits.length === 0) return NextResponse.json({ balances: [] });

		const debtorIds = Array.from(new Set(myCredits.map((p) => p.debtorId)));
		const debtorRows = await db
			.select({ id: wgMembers.id, name: wgMembers.name })
			.from(wgMembers)
			.where(inArray(wgMembers.id, debtorIds));
		const nameById = new Map(debtorRows.map((row) => [row.id, row.name]));

		const balances: BalanceDto[] = myCredits.map((pair) => ({
			debtor_id: pair.debtorId,
			debtor_name: nameById.get(pair.debtorId) ?? 'Unbekannt',
			amount_cents: pair.amountCents,
			oldest_age_days: computeOldestDebtAgeDays(pair.debtorId, auth.member.memberId, openExpenses),
		}));
		balances.sort((a, b) => b.amount_cents - a.amount_cents);

		return NextResponse.json({ balances });
	},
	{
		fixture: () => {
			return NextResponse.json(
				{ balances: [] },
				{ headers: { 'Cache-Control': 'private, no-store' } },
			);
		},
	},
);
