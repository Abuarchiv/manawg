import {
	announcementComments,
	announcements,
	auditEvents,
	chores,
	db,
	expensePayments,
	expenses,
	memberAbsences,
	recurringExpenses,
	shoppingItems,
	wgChatMessages,
	wgEvents,
	wgMembers,
} from '@/core/db';
import { type SQL, count, eq } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { ExportRow, ExportSectionCounts, ExportSectionKey } from './export';
import {
	completedPaymentsOf,
	fetchExpensePaymentRows,
	fetchExpenseRows,
	fetchMemberRows,
	fetchRecurringRows,
	loadSplitsByExpense,
	mapExpensePaymentRows,
	mapExpenseRows,
	mapMemberRows,
	mapRecurringRows,
} from './export-queries-finance';
import {
	fetchAbsenceRows,
	fetchAnnouncementCommentRows,
	fetchAnnouncementRows,
	fetchAuditRows,
	fetchChatMessageRows,
	fetchChoreRows,
	fetchEventRows,
	fetchShoppingRows,
	mapAbsenceRows,
	mapAnnouncementCommentRows,
	mapAnnouncementRows,
	mapAuditRows,
	mapChatMessageRows,
	mapChoreRows,
	mapEventRows,
	mapShoppingRows,
} from './export-queries-household';

export {
	type MemberRows,
	fetchMemberRows,
	mapMemberRows,
	toMemberById,
} from './export-queries-finance';

/** Per-section paging. The sentinel means "no cap" for plain full dumps. */
export interface ExportPage {
	limit: number;
	offset: number;
}

export const NO_EXPORT_LIMIT = Number.MAX_SAFE_INTEGER;

/** Resolves member id -> name; rejects when the roster could not be read. */
export type MemberDirectory = () => Promise<Map<string, string>>;

/**
 * Sections that join member names. The JSON dump reads the roster once up
 * front, and a failed roster read must fail exactly these sections.
 */
export const MEMBER_NAME_SECTIONS: Exclude<ExportSectionKey, 'members'>[] = [
	'expenses',
	'recurringExpenses',
	'chores',
	'absences',
	'announcements',
	'announcementComments',
	'events',
	'chatMessages',
	'auditEvents',
];

/**
 * One fetch + map per section, shared by the single-section CSV download and
 * the full JSON dump. Name-joining sections read their rows in parallel with
 * `memberDirectory`, so a failed roster fails each of them.
 */
export function buildSectionLoaders(
	wgId: string,
	page: ExportPage,
	memberDirectory: MemberDirectory,
): Record<ExportSectionKey, () => Promise<ExportRow[]>> {
	function withNames<R>(
		fetchRows: () => Promise<R>,
		mapRows: (rows: R, memberById: Map<string, string>) => ExportRow[],
	): () => Promise<ExportRow[]> {
		return async () => {
			const [memberById, rows] = await Promise.all([memberDirectory(), fetchRows()]);
			return mapRows(rows, memberById);
		};
	}

	return {
		members: async () => mapMemberRows(await fetchMemberRows(wgId)),
		expenses: async () => {
			const [memberById, expenseRows] = await Promise.all([
				memberDirectory(),
				fetchExpenseRows(wgId, page),
			]);
			const splitsByExpense = await loadSplitsByExpense(expenseRows.map((expense) => expense.id));
			return mapExpenseRows(expenseRows, memberById, splitsByExpense);
		},
		expensePayments: async () => mapExpensePaymentRows(await fetchExpensePaymentRows(wgId, page)),
		recurringExpenses: withNames(() => fetchRecurringRows(wgId, page), mapRecurringRows),
		shoppingItems: async () => mapShoppingRows(await fetchShoppingRows(wgId, page)),
		chores: withNames(() => fetchChoreRows(wgId, page), mapChoreRows),
		absences: withNames(() => fetchAbsenceRows(wgId, page), mapAbsenceRows),
		announcements: withNames(() => fetchAnnouncementRows(wgId, page), mapAnnouncementRows),
		announcementComments: withNames(
			() => fetchAnnouncementCommentRows(wgId, page),
			mapAnnouncementCommentRows,
		),
		events: withNames(() => fetchEventRows(wgId, page), mapEventRows),
		chatMessages: withNames(() => fetchChatMessageRows(wgId, page), mapChatMessageRows),
		auditEvents: withNames(() => fetchAuditRows(wgId, page), mapAuditRows),
	};
}

async function countRows(table: PgTable, where: SQL | undefined): Promise<number> {
	const [row] = await db.select({ value: count() }).from(table).where(where);
	return row?.value ?? 0;
}

/**
 * Row count per section with the same filters as the dump, for the settings
 * summary. Counting instead of downloading keeps the summary cheap for WGs with
 * a long chat history.
 */
export async function countExportSections(wgId: string): Promise<ExportSectionCounts> {
	const [
		members,
		expenseCount,
		expensePaymentCount,
		recurringExpenseCount,
		shoppingItemCount,
		choreCount,
		absenceCount,
		announcementCount,
		announcementCommentCount,
		eventCount,
		chatMessageCount,
		auditEventCount,
	] = await Promise.all([
		countRows(wgMembers, eq(wgMembers.wgId, wgId)),
		countRows(expenses, eq(expenses.wgId, wgId)),
		countRows(expensePayments, completedPaymentsOf(wgId)),
		countRows(recurringExpenses, eq(recurringExpenses.wgId, wgId)),
		countRows(shoppingItems, eq(shoppingItems.wgId, wgId)),
		countRows(chores, eq(chores.wgId, wgId)),
		countRows(memberAbsences, eq(memberAbsences.wgId, wgId)),
		countRows(announcements, eq(announcements.wgId, wgId)),
		db
			.select({ value: count() })
			.from(announcementComments)
			.innerJoin(announcements, eq(announcementComments.announcementId, announcements.id))
			.where(eq(announcements.wgId, wgId))
			.then(([row]) => row?.value ?? 0),
		countRows(wgEvents, eq(wgEvents.wgId, wgId)),
		countRows(wgChatMessages, eq(wgChatMessages.wgId, wgId)),
		countRows(auditEvents, eq(auditEvents.wgId, wgId)),
	]);
	return {
		members,
		expenses: expenseCount,
		expensePayments: expensePaymentCount,
		recurringExpenses: recurringExpenseCount,
		shoppingItems: shoppingItemCount,
		chores: choreCount,
		absences: absenceCount,
		announcements: announcementCount,
		announcementComments: announcementCommentCount,
		events: eventCount,
		chatMessages: chatMessageCount,
		auditEvents: auditEventCount,
	};
}
