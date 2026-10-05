import {
	announcementComments,
	announcements,
	auditEvents,
	chores,
	db,
	expensePayments,
	expenseSplits,
	expenses,
	memberAbsences,
	recurringExpenses,
	shoppingItems,
	wgChatMessages,
	wgEvents,
	wgMembers,
} from '@/core/db';
import { type SQL, and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
	type ExportRow,
	type ExportSectionCounts,
	type ExportSectionKey,
	formatExpenseSplitsForExport,
	parseRecurringSplitsForExport,
} from './export';

/** Per-section paging. The sentinel means "no cap" for plain full dumps. */
export interface ExportPage {
	limit: number;
	offset: number;
}

export const NO_EXPORT_LIMIT = Number.MAX_SAFE_INTEGER;
/** Expense ids per split query; well below Postgres' 65,535 bind-param cap. */
const SPLIT_ID_CHUNK_SIZE = 10_000;

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

interface ExportSplitRow {
	expenseId: string;
	debtorMemberId: string;
	amountCents: number;
	settledAt: Date | null;
}

/** Group every split belonging to the given expenses by expense id. */
async function loadSplitsByExpense(expenseIds: string[]): Promise<Map<string, ExportSplitRow[]>> {
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
function completedPaymentsOf(wgId: string): SQL | undefined {
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

async function fetchExpenseRows(wgId: string, page: ExportPage) {
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
function mapExpenseRows(
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

async function fetchExpensePaymentRows(wgId: string, page: ExportPage) {
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
function mapExpensePaymentRows(paymentRows: Awaited<ReturnType<typeof fetchExpensePaymentRows>>) {
	return paymentRows.map((payment) => ({
		id: payment.id,
		fromMemberId: payment.fromMemberId,
		toMemberId: payment.toMemberId,
		amountCents: payment.amountCents,
		currency: payment.currency,
		completedAt: payment.completedAt?.toISOString() ?? null,
	}));
}

async function fetchRecurringRows(wgId: string, page: ExportPage) {
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
function mapRecurringRows(
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

async function fetchShoppingRows(wgId: string, page: ExportPage) {
	return db
		.select({
			id: shoppingItems.id,
			name: shoppingItems.name,
			quantity: shoppingItems.quantity,
			boughtAt: shoppingItems.boughtAt,
			createdAt: shoppingItems.createdAt,
		})
		.from(shoppingItems)
		.where(eq(shoppingItems.wgId, wgId))
		.orderBy(desc(shoppingItems.createdAt), desc(shoppingItems.id))
		.limit(page.limit)
		.offset(page.offset);
}
function mapShoppingRows(shoppingRows: Awaited<ReturnType<typeof fetchShoppingRows>>) {
	return shoppingRows.map((item) => ({
		id: item.id,
		name: item.name,
		quantity: item.quantity ?? '',
		status: item.boughtAt ? 'erledigt' : 'offen',
		createdAt: item.createdAt.toISOString(),
	}));
}

async function fetchChoreRows(wgId: string, page: ExportPage) {
	return db
		.select({
			id: chores.id,
			title: chores.title,
			assignedMemberId: chores.assignedMemberId,
			nextDueAt: chores.nextDueAt,
			intervalDays: chores.intervalDays,
		})
		.from(chores)
		.where(eq(chores.wgId, wgId))
		.orderBy(desc(chores.nextDueAt), desc(chores.id))
		.limit(page.limit)
		.offset(page.offset);
}
function mapChoreRows(
	choreRows: Awaited<ReturnType<typeof fetchChoreRows>>,
	memberById: Map<string, string>,
) {
	return choreRows.map((chore) => ({
		id: chore.id,
		title: chore.title,
		assignedName: chore.assignedMemberId ? (memberById.get(chore.assignedMemberId) ?? '') : '',
		nextDueAt: chore.nextDueAt.toISOString(),
		intervalDays: chore.intervalDays,
	}));
}

async function fetchAbsenceRows(wgId: string, page: ExportPage) {
	return db
		.select({
			id: memberAbsences.id,
			memberId: memberAbsences.memberId,
			startDate: memberAbsences.startDate,
			endDate: memberAbsences.endDate,
			reason: memberAbsences.reason,
			createdAt: memberAbsences.createdAt,
		})
		.from(memberAbsences)
		.where(eq(memberAbsences.wgId, wgId))
		.orderBy(desc(memberAbsences.startDate), desc(memberAbsences.id))
		.limit(page.limit)
		.offset(page.offset);
}
function mapAbsenceRows(
	absenceRows: Awaited<ReturnType<typeof fetchAbsenceRows>>,
	memberById: Map<string, string>,
) {
	return absenceRows.map((absence) => ({
		id: absence.id,
		memberName: memberById.get(absence.memberId) ?? '',
		startDate: absence.startDate.toISOString(),
		endDate: absence.endDate.toISOString(),
		reason: absence.reason ?? '',
		createdAt: absence.createdAt.toISOString(),
	}));
}

async function fetchAnnouncementRows(wgId: string, page: ExportPage) {
	return db
		.select({
			id: announcements.id,
			content: announcements.content,
			kind: announcements.kind,
			status: announcements.status,
			authorMemberId: announcements.authorMemberId,
			imageUrl: announcements.imageUrl,
			createdAt: announcements.createdAt,
		})
		.from(announcements)
		.where(eq(announcements.wgId, wgId))
		.orderBy(desc(announcements.createdAt), desc(announcements.id))
		.limit(page.limit)
		.offset(page.offset);
}
function mapAnnouncementRows(
	announcementRows: Awaited<ReturnType<typeof fetchAnnouncementRows>>,
	memberById: Map<string, string>,
) {
	return announcementRows.map((item) => ({
		id: item.id,
		content: item.content,
		kind: item.kind,
		status: item.status,
		authorName: memberById.get(item.authorMemberId) ?? '',
		imageUrl: item.imageUrl ?? '',
		createdAt: item.createdAt.toISOString(),
	}));
}

async function fetchAnnouncementCommentRows(wgId: string, page: ExportPage) {
	// Comments carry no wg id of their own; the WG scope comes from their post.
	return db
		.select({
			id: announcementComments.id,
			announcementId: announcementComments.announcementId,
			memberId: announcementComments.memberId,
			content: announcementComments.content,
			createdAt: announcementComments.createdAt,
		})
		.from(announcementComments)
		.innerJoin(announcements, eq(announcementComments.announcementId, announcements.id))
		.where(eq(announcements.wgId, wgId))
		.orderBy(asc(announcementComments.createdAt), asc(announcementComments.id))
		.limit(page.limit)
		.offset(page.offset);
}
function mapAnnouncementCommentRows(
	commentRows: Awaited<ReturnType<typeof fetchAnnouncementCommentRows>>,
	memberById: Map<string, string>,
) {
	return commentRows.map((comment) => ({
		id: comment.id,
		announcementId: comment.announcementId,
		authorName: memberById.get(comment.memberId) ?? '',
		content: comment.content,
		createdAt: comment.createdAt.toISOString(),
	}));
}

async function fetchEventRows(wgId: string, page: ExportPage) {
	return db
		.select({
			id: wgEvents.id,
			title: wgEvents.title,
			description: wgEvents.description,
			startsAt: wgEvents.startsAt,
			endsAt: wgEvents.endsAt,
			allDay: wgEvents.allDay,
			location: wgEvents.location,
			recurrence: wgEvents.recurrence,
			createdByMemberId: wgEvents.createdByMemberId,
			createdAt: wgEvents.createdAt,
		})
		.from(wgEvents)
		.where(eq(wgEvents.wgId, wgId))
		.orderBy(asc(wgEvents.startsAt), asc(wgEvents.id))
		.limit(page.limit)
		.offset(page.offset);
}
function mapEventRows(
	eventRows: Awaited<ReturnType<typeof fetchEventRows>>,
	memberById: Map<string, string>,
) {
	return eventRows.map((event) => ({
		id: event.id,
		title: event.title,
		description: event.description ?? '',
		startsAt: event.startsAt.toISOString(),
		endsAt: event.endsAt?.toISOString() ?? '',
		allDay: event.allDay,
		location: event.location ?? '',
		recurrence: event.recurrence ?? '',
		createdByName: event.createdByMemberId ? (memberById.get(event.createdByMemberId) ?? '') : '',
		createdAt: event.createdAt.toISOString(),
	}));
}

async function fetchChatMessageRows(wgId: string, page: ExportPage) {
	return db
		.select({
			id: wgChatMessages.id,
			senderMemberId: wgChatMessages.senderMemberId,
			kind: wgChatMessages.kind,
			body: wgChatMessages.body,
			imageUrl: wgChatMessages.imageUrl,
			replyToMessageId: wgChatMessages.replyToMessageId,
			editedAt: wgChatMessages.editedAt,
			deletedAt: wgChatMessages.deletedAt,
			createdAt: wgChatMessages.createdAt,
		})
		.from(wgChatMessages)
		.where(eq(wgChatMessages.wgId, wgId))
		.orderBy(asc(wgChatMessages.createdAt), asc(wgChatMessages.id))
		.limit(page.limit)
		.offset(page.offset);
}
function mapChatMessageRows(
	messageRows: Awaited<ReturnType<typeof fetchChatMessageRows>>,
	memberById: Map<string, string>,
) {
	return messageRows.map((message) => {
		// Same rule as the chat read path (sanitizeChatMessageForRead): a
		// deleted message keeps its row but must never hand out its text or image.
		const deleted = message.deletedAt !== null;
		return {
			id: message.id,
			createdAt: message.createdAt.toISOString(),
			senderName: message.senderMemberId
				? (memberById.get(message.senderMemberId) ?? '')
				: 'System',
			kind: message.kind,
			body: deleted ? null : message.body,
			imageUrl: deleted ? '' : (message.imageUrl ?? ''),
			editedAt: message.editedAt?.toISOString() ?? null,
			deletedAt: message.deletedAt?.toISOString() ?? null,
			replyToMessageId: message.replyToMessageId,
		};
	});
}

async function fetchAuditRows(wgId: string, page: ExportPage) {
	return db
		.select({
			id: auditEvents.id,
			memberId: auditEvents.memberId,
			eventType: auditEvents.eventType,
			entityType: auditEvents.entityType,
			summary: auditEvents.summary,
			createdAt: auditEvents.createdAt,
		})
		.from(auditEvents)
		.where(eq(auditEvents.wgId, wgId))
		.orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
		.limit(page.limit)
		.offset(page.offset);
}
function mapAuditRows(
	auditRows: Awaited<ReturnType<typeof fetchAuditRows>>,
	memberById: Map<string, string>,
) {
	return auditRows.map((item) => ({
		id: item.id,
		eventType: item.eventType,
		entityType: item.entityType,
		memberName: item.memberId ? (memberById.get(item.memberId) ?? '') : 'System',
		summary: item.summary,
		createdAt: item.createdAt.toISOString(),
	}));
}

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
