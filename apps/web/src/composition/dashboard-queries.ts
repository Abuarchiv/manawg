import {
	announcementReactions,
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
	wgMembers,
} from '@/core/db';
import { feedAuditCondition } from '@/core/db/feed-audit-filter';
import { captureException } from '@/core/infra/observability';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';

import { CHAT_AUDIT_EVENT_TYPES } from './activity-audit';

export const ACTIVITY_LIMIT = 6;

// Reads that drive household counts must succeed; falling back to an empty
// list would report a false zero. Optional activity sections may still degrade.
// Financial reads must all succeed or balances would be fabricated.
function withFallback<T>(label: string, query: Promise<T>, fallback: () => T): Promise<T> {
	return query.catch((err: unknown) => {
		captureException(err, { action: 'loadDashboardData', query: label });
		return fallback();
	});
}

/**
 * The dashboard is polled every 30 s per member, so the expense history is never read whole:
 * balances come from SQL totals, the spend widgets from the last `spendSince` days and the
 * activity preview from the newest rows.
 */
export async function loadPrimaryRows(wgId: string, spendSince: Date) {
	const [
		memberRows,
		recentExpenses,
		openDebts,
		paymentRows,
		openShopping,
		recentShopping,
		choreRows,
		announcementRows,
		payerTotals,
		spendRows,
	] = await Promise.all([
		db
			.select({ id: wgMembers.id, name: wgMembers.name, color: wgMembers.color })
			.from(wgMembers)
			.where(eq(wgMembers.wgId, wgId)),
		db
			.select({
				id: expenses.id,
				paidByMemberId: expenses.paidByMemberId,
				amountCents: expenses.amountCents,
				currency: expenses.currency,
				description: expenses.description,
				occurredAt: expenses.occurredAt,
			})
			.from(expenses)
			.where(eq(expenses.wgId, wgId))
			.orderBy(desc(expenses.occurredAt))
			.limit(ACTIVITY_LIMIT),
		// Open debt per (payer, debtor, currency); the payer's own share stays in for gross "owed".
		db
			.select({
				paidByMemberId: expenses.paidByMemberId,
				debtorMemberId: expenseSplits.debtorMemberId,
				currency: expenses.currency,
				totalCents: sql<number>`sum(${expenseSplits.amountCents})::int`,
			})
			.from(expenseSplits)
			.innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
			.where(and(eq(expenses.wgId, wgId), isNull(expenseSplits.settledAt)))
			.groupBy(expenses.paidByMemberId, expenseSplits.debtorMemberId, expenses.currency),
		db
			.select({
				fromMemberId: expensePayments.fromMemberId,
				toMemberId: expensePayments.toMemberId,
				amountCents: expensePayments.amountCents,
				currency: expensePayments.currency,
			})
			.from(expensePayments)
			.where(and(eq(expensePayments.wgId, wgId), eq(expensePayments.status, 'completed'))),
		// Bought items accumulate forever; the dashboard only needs the open list
		// (count and top entries) plus the latest few for the activity preview.
		db
			.select({ name: shoppingItems.name, quantity: shoppingItems.quantity })
			.from(shoppingItems)
			.where(and(eq(shoppingItems.wgId, wgId), isNull(shoppingItems.boughtAt)))
			.orderBy(desc(shoppingItems.createdAt)),
		db
			.select({
				id: shoppingItems.id,
				name: shoppingItems.name,
				addedByMemberId: shoppingItems.addedByMemberId,
				boughtByMemberId: shoppingItems.boughtByMemberId,
				createdAt: shoppingItems.createdAt,
				boughtAt: shoppingItems.boughtAt,
			})
			.from(shoppingItems)
			.where(eq(shoppingItems.wgId, wgId))
			// Same instant the feed uses, so a long-open item bought just now is not cut off.
			.orderBy(desc(sql`coalesce(${shoppingItems.boughtAt}, ${shoppingItems.createdAt})`))
			.limit(ACTIVITY_LIMIT),
		db
			.select({
				id: chores.id,
				title: chores.title,
				nextDueAt: chores.nextDueAt,
				assignedMemberId: chores.assignedMemberId,
			})
			.from(chores)
			.where(eq(chores.wgId, wgId)),
		withFallback(
			'announcements',
			db
				.select({
					id: announcements.id,
					content: announcements.content,
					authorMemberId: announcements.authorMemberId,
					createdAt: announcements.createdAt,
				})
				.from(announcements)
				.where(and(eq(announcements.wgId, wgId), eq(announcements.source, 'manual')))
				.orderBy(desc(announcements.createdAt))
				.limit(ACTIVITY_LIMIT),
			() => [],
		),
		// Everything ever paid, per payer and currency: gross "paid" and the all-time total.
		db
			.select({
				paidByMemberId: expenses.paidByMemberId,
				currency: expenses.currency,
				totalCents: sql<number>`sum(${expenses.amountCents})::int`,
			})
			.from(expenses)
			.where(eq(expenses.wgId, wgId))
			.groupBy(expenses.paidByMemberId, expenses.currency),
		db
			.select({
				amountCents: expenses.amountCents,
				currency: expenses.currency,
				occurredAt: expenses.occurredAt,
			})
			.from(expenses)
			.where(and(eq(expenses.wgId, wgId), gte(expenses.occurredAt, spendSince))),
	]);
	return {
		memberRows,
		recentExpenses,
		openDebts,
		paymentRows,
		openShopping,
		recentShopping,
		choreRows,
		announcementRows,
		payerTotals,
		spendRows,
	};
}

export type PrimaryRows = Awaited<ReturnType<typeof loadPrimaryRows>>;

export async function loadSecondaryRows(wgId: string, currentMemberId: string | null | undefined) {
	const [myOpenAnnouncements, absenceRows, recurringRows, auditRows, currentMemberNotification] =
		await Promise.all([
			withFallback(
				'myOpenAnnouncements',
				currentMemberId
					? db
							.select({
								id: announcements.id,
								kind: announcements.kind,
								content: announcements.content,
								createdAt: announcements.createdAt,
							})
							.from(announcements)
							.innerJoin(
								announcementReactions,
								eq(announcementReactions.announcementId, announcements.id),
							)
							.where(
								and(
									eq(announcements.wgId, wgId),
									eq(announcements.status, 'open'),
									eq(announcementReactions.memberId, currentMemberId),
									eq(announcementReactions.reaction, 'take'),
								),
							)
							.orderBy(desc(announcements.createdAt))
					: Promise.resolve([]),
				() => [],
			),
			withFallback(
				'memberAbsences',
				db
					.select({
						id: memberAbsences.id,
						memberId: memberAbsences.memberId,
						startDate: memberAbsences.startDate,
						endDate: memberAbsences.endDate,
						createdAt: memberAbsences.createdAt,
					})
					.from(memberAbsences)
					.where(eq(memberAbsences.wgId, wgId)),
				() => [],
			),
			db
				.select({
					id: recurringExpenses.id,
					description: recurringExpenses.description,
					amountCents: recurringExpenses.amountCents,
					nextDueAt: recurringExpenses.nextDueAt,
					lastCreatedAt: recurringExpenses.lastCreatedAt,
					createdAt: recurringExpenses.createdAt,
					pausedAt: recurringExpenses.pausedAt,
				})
				.from(recurringExpenses)
				.where(eq(recurringExpenses.wgId, wgId)),
			withFallback(
				'auditEvents',
				db
					.select({
						id: auditEvents.id,
						memberId: auditEvents.memberId,
						eventType: auditEvents.eventType,
						entityType: auditEvents.entityType,
						entityId: auditEvents.entityId,
						metadataJson: auditEvents.metadataJson,
						summary: auditEvents.summary,
						createdAt: auditEvents.createdAt,
					})
					.from(auditEvents)
					// Chat audits carry no content worth a feed row and would crowd out real events.
					.where(feedAuditCondition(wgId, CHAT_AUDIT_EVENT_TYPES))
					.orderBy(desc(auditEvents.createdAt))
					.limit(ACTIVITY_LIMIT),
				() => [],
			),
			withFallback(
				'currentMemberPushOptIn',
				currentMemberId
					? db.query.wgMembers.findFirst({
							where: and(eq(wgMembers.id, currentMemberId), eq(wgMembers.wgId, wgId)),
							columns: { pushOptIn: true },
						})
					: Promise.resolve(null),
				() => null,
			),
		]);
	return {
		myOpenAnnouncements,
		absenceRows,
		recurringRows,
		auditRows,
		currentMemberNotification,
	};
}

export type SecondaryRows = Awaited<ReturnType<typeof loadSecondaryRows>>;
