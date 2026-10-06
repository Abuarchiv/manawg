import { db, wgMembers } from '@/core/db';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { computeBalances, computeOldestDebtAges } from '@/features/expenses/debts';
import { loadCompletedExpensePayments } from '@/features/expenses/expense-payments';
import { loadOpenExpenses } from '@/features/expenses/open-expenses';
import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';

interface BalanceDto {
	debtor_id: string;
	debtor_name: string;
	amount_cents: number;
	currency: string;
	oldest_age_days: number;
}

export const GET = withWgRoute('reminders/balances GET', async (req, { code }) => {
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;

	const [openExpenses, payments] = await Promise.all([
		loadOpenExpenses(wgId),
		loadCompletedExpensePayments(wgId),
	]);
	const allBalances = computeBalances(openExpenses, payments);
	const myCredits = allBalances.filter((p) => p.creditorId === auth.member.memberId);

	if (myCredits.length === 0) return NextResponse.json({ balances: [] });

	const debtorIds = Array.from(new Set(myCredits.map((p) => p.debtorId)));
	const debtorRows = await db
		.select({ id: wgMembers.id, name: wgMembers.name })
		.from(wgMembers)
		.where(and(eq(wgMembers.wgId, wgId), inArray(wgMembers.id, debtorIds)));
	const nameById = new Map(debtorRows.map((row) => [row.id, row.name]));

	const oldestAges = computeOldestDebtAges(
		myCredits.map((pair) => ({
			debtorId: pair.debtorId,
			creditorId: auth.member.memberId,
			currency: pair.currency,
		})),
		openExpenses,
	);
	const balances: BalanceDto[] = myCredits.map((pair, i) => ({
		debtor_id: pair.debtorId,
		debtor_name: nameById.get(pair.debtorId) ?? 'Unbekannt',
		amount_cents: pair.amountCents,
		currency: pair.currency,
		oldest_age_days: oldestAges[i] ?? 0,
	}));
	balances.sort((a, b) => a.currency.localeCompare(b.currency) || b.amount_cents - a.amount_cents);

	return NextResponse.json({ balances });
});
