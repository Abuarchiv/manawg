/**
 * Loads the dashboard payload. Reads that drive balances and household counts must succeed: an
 * empty fallback would report a false zero or fabricate balances. Optional activity sections
 * degrade to empty through `withFallback`.
 */
import {
	ACTIVITY_LIMIT,
	type AbsentMember,
	type ActivityItem,
	type ChoreDue,
	type LatestAnnouncement,
	buildAbsentMembers,
	buildDashboardActivity,
	buildDueChores,
	getLatestManualAnnouncement,
} from '@/composition/dashboard-activity';
import {
	type CurrencyTotals,
	type DaySpend,
	type MemberBalance,
	addCurrencyTotal,
	computeMemberBalances,
	singleCurrencyTotal,
	summarizeDashboardSpend,
} from '@/composition/dashboard-summary';
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
import { captureException } from '@/core/infra/observability';
import { getDueRecurringExpenses } from '@/features/expenses/recurring-expenses';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import type { WgHealth } from './dashboard-health';
import { getWgHealth } from './dashboard-insights';

interface DashboardSetup {
	choreCount: number;
	hasExpense: boolean;
	hasShoppingItem: boolean;
	hasAnnouncement: boolean;
	notificationsEnabled: boolean;
}

export interface DashboardData {
	balances: MemberBalance[];
	spendByDay: DaySpend[];
	totalSpendByCurrency: CurrencyTotals;
	weekSpendByCurrency: CurrencyTotals;
	monthSpendByCurrency: CurrencyTotals;
	/** Legacy scalar fields are null when more than one currency is present. */
	totalSpendCents: number | null;
	weekSpendCents: number | null;
	monthSpendCents: number | null;
	openShoppingCount: number;
	openShoppingTop: string[];
	dueChores: ChoreDue[];
	activity: ActivityItem[];
	latestAnnouncement: LatestAnnouncement | null;
	myOpenAnnouncements: Array<{ id: string; kind: string; content: string; createdAt: string }>;
	wgHealth: WgHealth;
	dueRecurringExpenses: Array<{
		id: string;
		description: string;
		amountCents: number;
		currency: string;
		nextDueAt: string;
	}>;
	absentMembers: AbsentMember[];
	setup: DashboardSetup;
}

function withFallback<T>(label: string, query: Promise<T>, fallback: () => T): Promise<T> {
	return query.catch((err: unknown) => {
		captureException(err, { action: 'loadDashboardData', query: label });
		return fallback();
	});
}

/** Members, money, shopping, chores and manual announcements of a WG. */
async function loadDashboardCoreRows(wgId: string) {
	const [
		memberRows,
		expenseRows,
		splitRows,
		paymentRows,
		openShopping,
		recentShopping,
		choreRows,
		announcementRows,
		openAnnouncementCountRows,
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
			.orderBy(desc(expenses.occurredAt)),
		db
			.select({
				expenseId: expenseSplits.expenseId,
				debtorMemberId: expenseSplits.debtorMemberId,
				amountCents: expenseSplits.amountCents,
				settledAt: expenseSplits.settledAt,
			})
			.from(expenseSplits)
			.innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
			.where(eq(expenses.wgId, wgId)),
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
				createdAt: shoppingItems.createdAt,
				boughtAt: shoppingItems.boughtAt,
			})
			.from(shoppingItems)
			.where(eq(shoppingItems.wgId, wgId))
			.orderBy(desc(shoppingItems.createdAt))
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
		withFallback(
			'openAnnouncementCount',
			db
				.select({ value: count() })
				.from(announcements)
				.where(
					and(
						eq(announcements.wgId, wgId),
						eq(announcements.source, 'manual'),
						eq(announcements.status, 'open'),
					),
				),
			() => [],
		),
	]);
	return {
		memberRows,
		expenseRows,
		splitRows,
		paymentRows,
		openShopping,
		recentShopping,
		choreRows,
		announcementRows,
		openAnnouncementCountRows,
	};
}

/** Per-member announcements, absences, Abos, audit trail and the member's push opt-in. */
async function loadDashboardSecondaryRows(wgId: string, currentMemberId?: string | null) {
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
					.where(eq(auditEvents.wgId, wgId))
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
	return { myOpenAnnouncements, absenceRows, recurringRows, auditRows, currentMemberNotification };
}

export async function loadDashboardData(
	wgId: string,
	currentMemberId?: string | null,
	shareCode = '',
): Promise<DashboardData> {
	const now = new Date();
	const {
		memberRows,
		expenseRows,
		splitRows,
		paymentRows,
		openShopping,
		recentShopping,
		choreRows,
		announcementRows,
		openAnnouncementCountRows,
	} = await loadDashboardCoreRows(wgId);
	const { myOpenAnnouncements, absenceRows, recurringRows, auditRows, currentMemberNotification } =
		await loadDashboardSecondaryRows(wgId, currentMemberId);

	const memberById = new Map(memberRows.map((m) => [m.id, m]));
	const balances = computeMemberBalances(memberRows, expenseRows, splitRows, paymentRows);
	const dueChores = buildDueChores(choreRows, memberById, now);
	const dueRecurringExpenses = getDueRecurringExpenses(
		recurringRows
			.filter((item) => item.pausedAt === null)
			.map((item) => ({
				id: item.id,
				description: item.description,
				amountCents: item.amountCents,
				currency: 'EUR',
				nextDueAt: item.nextDueAt.toISOString(),
			})),
		now.getTime(),
	);
	const { absentMemberIds, absentMembers } = buildAbsentMembers(
		absenceRows,
		memberById,
		currentMemberId,
		now.getTime(),
	);
	const openDebtByCurrency: CurrencyTotals = {};
	for (const balance of balances) {
		if (balance.balanceCents < 0) {
			addCurrencyTotal(openDebtByCurrency, balance.currency, -balance.balanceCents);
		}
	}
	const currentMember = currentMemberId ? (memberById.get(currentMemberId) ?? null) : null;

	return {
		balances: [...balances].sort((a, b) => Math.abs(b.balanceCents) - Math.abs(a.balanceCents)),
		...summarizeDashboardSpend(expenseRows, now),
		openShoppingCount: openShopping.length,
		openShoppingTop: openShopping
			.slice(0, 3)
			.map((s) => (s.quantity ? `${s.name} (${s.quantity})` : s.name)),
		dueChores,
		activity: buildDashboardActivity({
			shareCode,
			memberById,
			expenseRows,
			recentShopping,
			announcementRows,
			absenceRows,
			recurringRows,
			auditRows,
		}),
		latestAnnouncement: getLatestManualAnnouncement(announcementRows, memberById),
		myOpenAnnouncements: myOpenAnnouncements.map((item) => ({
			...item,
			createdAt: item.createdAt.toISOString(),
		})),
		wgHealth: getWgHealth({
			shareCode,
			openShoppingCount: openShopping.length,
			overdueChoreCount: dueChores.filter((item) => item.overdue).length,
			openDebtCents: singleCurrencyTotal(openDebtByCurrency) ?? 0,
			openDebtByCurrency,
			openAnnouncementCount: openAnnouncementCountRows[0]?.value ?? 0,
			absentMemberCount: absentMemberIds.length,
			dueRecurringCount: dueRecurringExpenses.length,
		}),
		dueRecurringExpenses,
		absentMembers,
		setup: {
			choreCount: choreRows.length,
			hasExpense: expenseRows.length > 0,
			hasShoppingItem: recentShopping.length > 0,
			hasAnnouncement: announcementRows.length > 0,
			notificationsEnabled: Boolean(currentMember && currentMemberNotification?.pushOptIn),
		},
	};
}
