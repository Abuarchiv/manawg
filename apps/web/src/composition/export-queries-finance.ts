import {
	db,
	expensePayments,
	expenseSplits,
	expenses,
	recurringExpenses,
	wgMembers,
} from '@/core/db';
import { type SQL, and, asc, desc, eq, inArray } from 'drizzle-orm';
import { formatExpenseSplitsForExport, parseRecurringSplitsForExport } from './export';
import type { ExportPage } from './export-queries';

/** Expense ids per split query; well below Postgres' 65,535 bind-param cap. */
const SPLIT_ID_CHUNK_SIZE = 10_000;

interface ExportSplitRow {
	expenseId: string;
	debtorMemberId: string;
	amountCents: number;
	settledAt: Date | null;
}

/** Group every split belonging to the given expenses by expense id. */
export async function loadSplitsByExpense(
	expenseIds: string[],
): Promise<Map<string, ExportSplitRow[]>> {
	const splitsByExpense = new Map<string, ExportSplitRow[]>();
	if (expenseIds.length === 0) return splitsByExpense;

	// Postgres caps a statement at 65,535 bind parameters, so a large (or
	// unlimited) page of expense ids is read in chunks.
	for (let start = 0; start < expenseIds.length; start += SPLIT_ID_CHUNK_SIZE) {
		const splitRows = await db
			.select({
				expenseId: expenseSplits.expenseId,
				debtorMemberId: expenseSplits.debtorMemberId,
				amountCents: expenseSplits.amountCents,
				settledAt: expenseSplits.settledAt,
			})
			.from(expenseSplits)
			.where(
				inArray(expenseSplits.expenseId, expenseIds.slice(start, start + SPLIT_ID_CHUNK_SIZE)),
			);

		for (const split of splitRows) {
			const splits = splitsByExpense.get(split.expenseId) ?? [];
			splits.push(split);
			splitsByExpense.set(split.expenseId, splits);
		}
	}
	return splitsByExpense;
}
/** Only completed payments are part of the ledger the export documents. */
export function completedPaymentsOf(wgId: string): SQL | undefined {
	return and(eq(expensePayments.wgId, wgId), eq(expensePayments.status, 'completed'));
}

export async function fetchMemberRows(wgId: string) {
	// Always the FULL roster: members are join-capped (small) and double as
	// the name directory for every other section — paging is only applied to
	// the potentially unbounded sections below.
	return db
		.select({ id: wgMembers.id, name: wgMembers.name, createdAt: wgMembers.createdAt })
		.from(wgMembers)
		.where(eq(wgMembers.wgId, wgId))
		.orderBy(asc(wgMembers.createdAt), asc(wgMembers.id));
}
export type MemberRows = Awaited<ReturnType<typeof fetchMemberRows>>;

export function toMemberById(memberRows: MemberRows): Map<string, string> {
	return new Map(memberRows.map((member) => [member.id, member.name]));
}
export function mapMemberRows(memberRows: MemberRows) {
	return memberRows.map((member) => ({
		id: member.id,
		name: member.name,
		createdAt: member.createdAt.toISOString(),
	}));
}

export async function fetchExpenseRows(wgId: string, page: ExportPage) {
	return db
		.select({
			id: expenses.id,
			description: expenses.description,
			amountCents: expenses.amountCents,
			currency: expenses.currency,
			paidByMemberId: expenses.paidByMemberId,
			imageUrl: expenses.imageUrl,
			occurredAt: expenses.occurredAt,
		})
		.from(expenses)
		.where(eq(expenses.wgId, wgId))
		.orderBy(desc(expenses.occurredAt), desc(expenses.id))
		.limit(page.limit)
		.offset(page.offset);
}
export function mapExpenseRows(
	expenseRows: Awaited<ReturnType<typeof fetchExpenseRows>>,
	memberById: Map<string, string>,
	splitsByExpense: Map<string, ExportSplitRow[]>,
) {
	return expenseRows.map((expense) => ({
		id: expense.id,
		description: expense.description,
		amountCents: expense.amountCents,
		currency: expense.currency,
		paidBy: memberById.get(expense.paidByMemberId) ?? '',
		paidByMemberId: expense.paidByMemberId,
		imageUrl: expense.imageUrl ?? '',
		occurredAt: expense.occurredAt.toISOString(),
		splits: formatExpenseSplitsForExport(splitsByExpense.get(expense.id) ?? [], memberById),
	}));
}

export async function fetchExpensePaymentRows(wgId: string, page: ExportPage) {
	return db
		.select({
			id: expensePayments.id,
			fromMemberId: expensePayments.fromMemberId,
			toMemberId: expensePayments.toMemberId,
			amountCents: expensePayments.amountCents,
			currency: expensePayments.currency,
			completedAt: expensePayments.completedAt,
		})
		.from(expensePayments)
		.where(completedPaymentsOf(wgId))
		.orderBy(desc(expensePayments.completedAt), desc(expensePayments.id))
		.limit(page.limit)
		.offset(page.offset);
}
export function mapExpensePaymentRows(
	paymentRows: Awaited<ReturnType<typeof fetchExpensePaymentRows>>,
) {
	return paymentRows.map((payment) => ({
		id: payment.id,
		fromMemberId: payment.fromMemberId,
		toMemberId: payment.toMemberId,
		amountCents: payment.amountCents,
		currency: payment.currency,
		completedAt: payment.completedAt?.toISOString() ?? null,
	}));
}

export async function fetchRecurringRows(wgId: string, page: ExportPage) {
	return db
		.select({
			id: recurringExpenses.id,
			description: recurringExpenses.description,
			amountCents: recurringExpenses.amountCents,
			paidByMemberId: recurringExpenses.paidByMemberId,
			intervalMonths: recurringExpenses.intervalMonths,
			nextDueAt: recurringExpenses.nextDueAt,
			lastCreatedAt: recurringExpenses.lastCreatedAt,
			createdAt: recurringExpenses.createdAt,
			splitsJson: recurringExpenses.splitsJson,
		})
		.from(recurringExpenses)
		.where(eq(recurringExpenses.wgId, wgId))
		.orderBy(desc(recurringExpenses.nextDueAt), desc(recurringExpenses.id))
		.limit(page.limit)
		.offset(page.offset);
}
export function mapRecurringRows(
	recurringRows: Awaited<ReturnType<typeof fetchRecurringRows>>,
	memberById: Map<string, string>,
) {
	return recurringRows.map((item) => ({
		id: item.id,
		description: item.description,
		amountCents: item.amountCents,
		currency: 'EUR',
		paidBy: memberById.get(item.paidByMemberId) ?? '',
		intervalMonths: item.intervalMonths,
		nextDueAt: item.nextDueAt.toISOString(),
		lastCreatedAt: item.lastCreatedAt?.toISOString() ?? '',
		createdAt: item.createdAt.toISOString(),
		splits: parseRecurringSplitsForExport(item.splitsJson, memberById),
	}));
}
