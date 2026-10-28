import 'server-only';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { loadConfirmedEmails } from '@/core/auth/auth-user-emails';
import { db, expensePayments, expenseSplits, expenses, wgMembers, wgs } from '@/core/db';
import { MS_PER_DAY } from '@/core/utils/time';
import type { ExpensePaymentInput } from '../expense-payment-input';
import type { StatementExpense } from '../monthly-statement';
import {
	planStatementMails,
	type StatementPlan,
	type StatementWgMember,
} from '../statement-recipients';

const WG_CHUNK = 25;

export interface WgStatementPlan {
	wg: { id: string; name: string; shareCode: string };
	plan: StatementPlan;
}

/** The month padded by a day on both sides, so Berlin-local month edges are never cut off. */
function monthWindow(monthKey: string): { from: Date; to: Date } {
	const [year = 0, month = 1] = monthKey.split('-').map(Number);
	return {
		from: new Date(Date.UTC(year, month - 1, 1) - MS_PER_DAY),
		to: new Date(Date.UTC(year, month, 1) + MS_PER_DAY),
	};
}

/** Expenses up to the end of the window: older open shares take payments first. */
async function loadWgExpenses(
	wgIds: string[],
	window: { from: Date; to: Date },
): Promise<Map<string, StatementExpense[]>> {
	const inWindow = and(inArray(expenses.wgId, wgIds), lt(expenses.occurredAt, window.to));
	const rows = await db.select().from(expenses).where(inWindow).orderBy(asc(expenses.occurredAt));
	const splits = await db
		.select({
			expenseId: expenseSplits.expenseId,
			debtorMemberId: expenseSplits.debtorMemberId,
			amountCents: expenseSplits.amountCents,
			settledAt: expenseSplits.settledAt,
		})
		.from(expenseSplits)
		.innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
		.where(inWindow);
	const splitsByExpense = new Map<string, StatementExpense['splits']>();
	for (const split of splits) {
		const list = splitsByExpense.get(split.expenseId) ?? [];
		list.push({
			debtorMemberId: split.debtorMemberId,
			amountCents: split.amountCents,
			settledAt: split.settledAt?.toISOString() ?? null,
		});
		splitsByExpense.set(split.expenseId, list);
	}
	const byWg = new Map<string, StatementExpense[]>();
	for (const row of rows) {
		const list = byWg.get(row.wgId) ?? [];
		list.push({
			id: row.id,
			paidByMemberId: row.paidByMemberId,
			amountCents: row.amountCents,
			currency: row.currency,
			description: row.description,
			occurredAt: row.occurredAt.toISOString(),
			splits: splitsByExpense.get(row.id) ?? [],
		});
		byWg.set(row.wgId, list);
	}
	return byWg;
}

/** All completed payments per WG; `buildMonthlyStatement` spends them on open shares oldest first. */
async function loadWgPayments(wgIds: string[]): Promise<Map<string, ExpensePaymentInput[]>> {
	const rows = await db
		.select({
			wgId: expensePayments.wgId,
			fromMemberId: expensePayments.fromMemberId,
			toMemberId: expensePayments.toMemberId,
			amountCents: expensePayments.amountCents,
			currency: expensePayments.currency,
			completedAt: expensePayments.completedAt,
		})
		.from(expensePayments)
		.where(and(inArray(expensePayments.wgId, wgIds), eq(expensePayments.status, 'completed')));
	const byWg = new Map<string, ExpensePaymentInput[]>();
	for (const { wgId, completedAt, ...payment } of rows) {
		const list = byWg.get(wgId) ?? [];
		list.push({ ...payment, completedAt: completedAt?.toISOString() ?? null });
		byWg.set(wgId, list);
	}
	return byWg;
}

/**
 * Statement plans for every WG that booked an expense in the month. Earlier
 * expenses are read too, because payments settle the oldest open shares first; only active members who kept the preference on
 * are looked up in Auth.
 */
export async function loadStatementPlans(monthKey: string): Promise<WgStatementPlan[]> {
	const window = monthWindow(monthKey);
	const active = await db
		.selectDistinct({ wgId: expenses.wgId })
		.from(expenses)
		.where(and(gte(expenses.occurredAt, window.from), lt(expenses.occurredAt, window.to)));
	const wgIds = active.map((row) => row.wgId);

	const result: WgStatementPlan[] = [];
	for (let start = 0; start < wgIds.length; start += WG_CHUNK) {
		const chunk = wgIds.slice(start, start + WG_CHUNK);
		const [wgRows, memberRows, expensesByWg, paymentsByWg] = await Promise.all([
			db
				.select({ id: wgs.id, name: wgs.name, shareCode: wgs.shareCode })
				.from(wgs)
				.where(inArray(wgs.id, chunk)),
			db.select().from(wgMembers).where(inArray(wgMembers.wgId, chunk)),
			loadWgExpenses(chunk, window),
			loadWgPayments(chunk),
		]);
		const wantsMail = memberRows.filter(
			(member) => member.deactivatedAt === null && member.notifyStatementEmail && member.authUserId,
		);
		const { emails, unresolved } = await loadConfirmedEmails(
			wantsMail.flatMap((member) => (member.authUserId ? [member.authUserId] : [])),
		);
		if (unresolved.size > 0) {
			console.warn(
				`[statement-mail] ${unresolved.size} Auth lookups failed; members left for a later run`,
			);
		}
		for (const wg of wgRows) {
			const members: StatementWgMember[] = memberRows
				.filter((member) => member.wgId === wg.id)
				.map((member) => ({
					id: member.id,
					name: member.name,
					active: member.deactivatedAt === null,
					notify: member.notifyStatementEmail,
					email: (member.authUserId && emails.get(member.authUserId)) || null,
					lookupFailed: member.authUserId !== null && unresolved.has(member.authUserId),
				}));
			result.push({
				wg,
				plan: planStatementMails(
					members,
					expensesByWg.get(wg.id) ?? [],
					monthKey,
					paymentsByWg.get(wg.id) ?? [],
				),
			});
		}
	}
	return result;
}
