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
import {
	berlinDayKey,
	nextBerlinDayStart,
	prevBerlinDayStart,
	startOfBerlinDay,
} from '@/core/utils/berlin-day';
import { getAbsentMemberIds } from '@/features/chores/absence';
import { getDueRecurringExpenses } from '@/features/expenses/recurring-expenses';
import { and, desc, eq } from 'drizzle-orm';
import { type ActivityKind, formatAuditActivityText } from './activity';
import { type WgHealth, getWgHealth } from './dashboard-insights';
import {
	getDashboardActivityHref,
	getDashboardAuditHref,
	getDashboardAuditKind,
} from './dashboard-links';

const SPARKLINE_DAYS = 14;
const ACTIVITY_LIMIT = 6;
const AUDIT_DEDUPE_WINDOW_MS = 60_000;

export interface MemberBalance {
	memberId: string;
	memberName: string;
	color: string | null;
	paidCents: number;
	owedCents: number;
	balanceCents: number;
}

export interface DaySpend {
	date: string;
	cents: number;
}

export interface ActivityItem {
	kind: 'expense' | 'shopping' | 'announcement' | 'chore' | 'recurring' | 'absence' | 'audit';
	timestamp: string;
	memberName: string;
	text: string;
	amountCents?: number;
	href?: string;
}

export interface ChoreDue {
	id: string;
	title: string;
	assignedMemberId: string | null;
	assignedMemberName: string | null;
	assignedColor: string | null;
	nextDueAt: string;
	overdue: boolean;
}

export interface DashboardSetup {
	choreCount: number;
	hasExpense: boolean;
	hasShoppingItem: boolean;
	hasAnnouncement: boolean;
	notificationsEnabled: boolean;
}

export interface DashboardData {
	balances: MemberBalance[];
	spendByDay: DaySpend[];
	totalSpendCents: number;
	weekSpendCents: number;
	monthSpendCents: number;
	openShoppingCount: number;
	openShoppingTop: string[];
	dueChores: ChoreDue[];
	activity: ActivityItem[];
	latestAnnouncement: {
		id?: string;
		content: string;
		authorName: string;
		createdAt: string;
	} | null;
	myOpenAnnouncements: Array<{ id: string; kind: string; content: string; createdAt: string }>;
	wgHealth: WgHealth;
	dueRecurringExpenses: Array<{
		id: string;
		description: string;
		amountCents: number;
		nextDueAt: string;
	}>;
	absentMembers: Array<{
		id: string;
		memberId: string;
		name: string;
		endDate: string;
		isCurrentMember: boolean;
	}>;
	setup: DashboardSetup;
}

export function getLatestManualAnnouncement(
	announcementRows: Array<{
		id?: string;
		content: string;
		authorMemberId: string;
		source: string | null;
		createdAt: Date;
	}>,
	memberById: Map<string, { name: string }>,
): DashboardData['latestAnnouncement'] {
	const latestManual = announcementRows.find((item) => item.source === 'manual');
	return latestManual
		? {
				...(latestManual.id ? { id: latestManual.id } : {}),
				content: latestManual.content,
				authorName: memberById.get(latestManual.authorMemberId)?.name ?? '—',
				createdAt: latestManual.createdAt.toISOString(),
			}
		: null;
}

export function countOpenManualAnnouncements(
	announcementRows: Array<{ source: string | null; status: string }>,
): number {
	return announcementRows.filter((item) => item.source === 'manual' && item.status === 'open')
		.length;
}

export function getCurrentAbsenceRowsByMember<
	TRow extends { memberId: string; startDate: Date; endDate: Date },
>(absenceRows: TRow[], nowMs: number): Map<string, TRow> {
	const currentRows = absenceRows
		.filter((item) => item.startDate.getTime() <= nowMs && item.endDate.getTime() >= nowMs)
		.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
	const currentByMember = new Map<string, TRow>();
	for (const item of currentRows) {
		if (!currentByMember.has(item.memberId)) currentByMember.set(item.memberId, item);
	}
	return currentByMember;
}

function berlinDaysAgoStart(todayStart: Date, daysAgo: number): Date {
	let day = todayStart;
	for (let i = 0; i < daysAgo; i++) day = prevBerlinDayStart(day);
	return day;
}

export function computeMemberBalances(
	members: Array<{ id: string; name: string; color: string | null }>,
	expenses: Array<{ paidByMemberId: string; amountCents: number }>,
	splits: Array<{ debtorMemberId: string; amountCents: number; settledAt: Date | null }>,
	payments: Array<{ fromMemberId: string; toMemberId: string; amountCents: number }> = [],
): MemberBalance[] {
	const balanceMap = new Map<string, MemberBalance>();
	for (const m of members) {
		balanceMap.set(m.id, {
			memberId: m.id,
			memberName: m.name,
			color: m.color,
			paidCents: 0,
			owedCents: 0,
			balanceCents: 0,
		});
	}
	// Ausgeschiedene Mitglieder behalten ihre Saldo-Zeile: die Mahnungen-Seite
	// (computeBalances) zeigt deren offene Splits weiterhin, also müssen paid
	// und owed unabhängig vom Aktiv-Status zählen, damit die Summe 0 bleibt.
	for (const e of expenses) {
		const b = balanceMap.get(e.paidByMemberId);
		if (b) b.paidCents += e.amountCents;
	}
	for (const s of splits) {
		if (s.settledAt) continue;
		const b = balanceMap.get(s.debtorMemberId);
		if (b) b.owedCents += s.amountCents;
	}
	for (const payment of payments) {
		const payer = balanceMap.get(payment.fromMemberId);
		const payee = balanceMap.get(payment.toMemberId);
		if (payer) payer.paidCents += payment.amountCents;
		if (payee) payee.owedCents += payment.amountCents;
	}
	for (const b of balanceMap.values()) {
		b.balanceCents = b.paidCents - b.owedCents;
	}
	return Array.from(balanceMap.values());
}

export function buildDueChores(
	choreRows: Array<{
		id: string;
		title: string;
		nextDueAt: Date;
		assignedMemberId: string | null;
	}>,
	memberById: Map<string, { name: string; color: string | null }>,
	now: Date,
): ChoreDue[] {
	return choreRows
		.map((c) => {
			const assigned = c.assignedMemberId ? (memberById.get(c.assignedMemberId) ?? null) : null;
			return {
				id: c.id,
				title: c.title,
				assignedMemberId: c.assignedMemberId,
				assignedMemberName: assigned?.name ?? null,
				assignedColor: assigned?.color ?? null,
				nextDueAt: c.nextDueAt.toISOString(),
				overdue: c.nextDueAt.getTime() <= now.getTime(),
			};
		})
		.sort((a, b) => a.nextDueAt.localeCompare(b.nextDueAt));
}

export function isDuplicateAuditActivity(
	rawByKey: Map<string, number>,
	kind: ActivityKind,
	entityId: string | null | undefined,
	timestampMs: number,
): boolean {
	if (!entityId) return false;
	const rawMs = rawByKey.get(`${kind}:${entityId}`);
	return rawMs !== undefined && Math.abs(timestampMs - rawMs) <= AUDIT_DEDUPE_WINDOW_MS;
}

export async function loadDashboardData(
	wgId: string,
	currentMemberId?: string | null,
	shareCode = '',
): Promise<DashboardData> {
	const now = new Date();
	// Windows are anchored to Berlin calendar days: stepping via
	// prevBerlinDayStart stays correct across DST days (23h/25h), where fixed
	// 24h arithmetic would drift the boundary by an hour.
	const todayStart = startOfBerlinDay(now);
	const sparklineStart = berlinDaysAgoStart(todayStart, SPARKLINE_DAYS - 1);
	const weekStart = berlinDaysAgoStart(todayStart, 6);
	const monthStart = berlinDaysAgoStart(todayStart, 29);

	const [
		memberRows,
		expenseRows,
		splitRows,
		paymentRows,
		shoppingRows,
		choreRows,
		announcementRows,
	] = await Promise.all([
		db
			.select({
				id: wgMembers.id,
				name: wgMembers.name,
				color: wgMembers.color,
			})
			.from(wgMembers)
			.where(eq(wgMembers.wgId, wgId)),
		db
			.select({
				id: expenses.id,
				paidByMemberId: expenses.paidByMemberId,
				amountCents: expenses.amountCents,
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
			})
			.from(expensePayments)
			.where(and(eq(expensePayments.wgId, wgId), eq(expensePayments.status, 'completed'))),
		db
			.select({
				id: shoppingItems.id,
				name: shoppingItems.name,
				quantity: shoppingItems.quantity,
				addedByMemberId: shoppingItems.addedByMemberId,
				createdAt: shoppingItems.createdAt,
				boughtAt: shoppingItems.boughtAt,
			})
			.from(shoppingItems)
			.where(eq(shoppingItems.wgId, wgId))
			.orderBy(desc(shoppingItems.createdAt)),
		db
			.select({
				id: chores.id,
				title: chores.title,
				nextDueAt: chores.nextDueAt,
				assignedMemberId: chores.assignedMemberId,
			})
			.from(chores)
			.where(eq(chores.wgId, wgId)),
		db
			.select({
				id: announcements.id,
				content: announcements.content,
				authorMemberId: announcements.authorMemberId,
				source: announcements.source,
				status: announcements.status,
				createdAt: announcements.createdAt,
			})
			.from(announcements)
			.where(eq(announcements.wgId, wgId))
			.orderBy(desc(announcements.createdAt)),
	]);

	const memberById = new Map(memberRows.map((m) => [m.id, m]));

	const balances = computeMemberBalances(memberRows, expenseRows, splitRows, paymentRows);

	const spendBuckets = new Map<string, number>();
	let bucketDay = sparklineStart;
	for (let i = 0; i < SPARKLINE_DAYS; i++) {
		spendBuckets.set(berlinDayKey(bucketDay), 0);
		bucketDay = nextBerlinDayStart(bucketDay);
	}
	let totalSpend = 0;
	let weekSpend = 0;
	let monthSpend = 0;
	for (const e of expenseRows) {
		totalSpend += e.amountCents;
		const d = new Date(e.occurredAt);
		if (d >= weekStart) weekSpend += e.amountCents;
		if (d >= monthStart) monthSpend += e.amountCents;
		const key = berlinDayKey(d);
		if (spendBuckets.has(key)) {
			spendBuckets.set(key, (spendBuckets.get(key) ?? 0) + e.amountCents);
		}
	}
	const spendByDay: DaySpend[] = Array.from(spendBuckets.entries()).map(([date, cents]) => ({
		date,
		cents,
	}));

	const openShopping = shoppingRows.filter((s) => !s.boughtAt);
	const openShoppingTop = openShopping
		.slice(0, 3)
		.map((s) => (s.quantity ? `${s.name} (${s.quantity})` : s.name));

	const allDueChores = buildDueChores(choreRows, memberById, now);
	const dueChores = allDueChores;

	const activity: ActivityItem[] = [];
	const rawActivityByKey = new Map<string, number>();
	for (const e of expenseRows.slice(0, ACTIVITY_LIMIT)) {
		activity.push({
			kind: 'expense',
			timestamp: e.occurredAt.toISOString(),
			memberName: memberById.get(e.paidByMemberId)?.name ?? '—',
			text: e.description,
			amountCents: e.amountCents,
			href: getDashboardActivityHref(shareCode, 'expense', e.id),
		});
		rawActivityByKey.set(`expense:${e.id}`, new Date(e.occurredAt).getTime());
	}
	for (const s of shoppingRows.slice(0, ACTIVITY_LIMIT)) {
		activity.push({
			kind: 'shopping',
			timestamp: (s.boughtAt ?? s.createdAt).toISOString(),
			memberName: memberById.get(s.addedByMemberId)?.name ?? '—',
			// Matches activity.ts's buildActivityTimeline wording for the same
			// event — these two feed builders are independently maintained
			// (dashboard-data.ts assembles a bounded per-category preview,
			// activity.ts the full chronicle), so their text must stay in sync
			// by hand until they're consolidated.
			text: s.boughtAt ? `${s.name} gekauft` : s.name,
			href: getDashboardActivityHref(shareCode, 'shopping', s.id),
		});
		rawActivityByKey.set(`shopping:${s.id}`, (s.boughtAt ?? s.createdAt).getTime());
	}
	for (const a of announcementRows
		.filter((item) => item.source === 'manual')
		.slice(0, ACTIVITY_LIMIT)) {
		activity.push({
			kind: 'announcement',
			timestamp: a.createdAt.toISOString(),
			memberName: memberById.get(a.authorMemberId)?.name ?? '—',
			text: a.content.length > 80 ? `${a.content.slice(0, 80)}…` : a.content,
			href: getDashboardActivityHref(shareCode, 'announcement', a.id),
		});
		rawActivityByKey.set(`announcement:${a.id}`, a.createdAt.getTime());
	}
	activity.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

	const latestAnnouncement = getLatestManualAnnouncement(announcementRows, memberById);
	const [myOpenAnnouncements, absenceRows, recurringRows, auditRows, currentMemberNotification] =
		await Promise.all([
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
			db
				.select({
					id: memberAbsences.id,
					memberId: memberAbsences.memberId,
					startDate: memberAbsences.startDate,
					endDate: memberAbsences.endDate,
				})
				.from(memberAbsences)
				.where(eq(memberAbsences.wgId, wgId)),
			db
				.select({
					id: recurringExpenses.id,
					description: recurringExpenses.description,
					amountCents: recurringExpenses.amountCents,
					nextDueAt: recurringExpenses.nextDueAt,
					lastCreatedAt: recurringExpenses.lastCreatedAt,
					createdAt: recurringExpenses.createdAt,
				})
				.from(recurringExpenses)
				.where(eq(recurringExpenses.wgId, wgId)),
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
			currentMemberId
				? db.query.wgMembers.findFirst({
						where: and(eq(wgMembers.id, currentMemberId), eq(wgMembers.wgId, wgId)),
						columns: { pushOptIn: true },
					})
				: Promise.resolve(null),
		]);
	const filteredMyOpenAnnouncements = myOpenAnnouncements;
	const dueRecurringExpenses = getDueRecurringExpenses(
		recurringRows.map((item) => ({
			...item,
			nextDueAt: item.nextDueAt.toISOString(),
		})),
		now.getTime(),
	);
	for (const absence of absenceRows.slice(0, ACTIVITY_LIMIT)) {
		activity.push({
			kind: 'absence',
			timestamp: absence.startDate.toISOString(),
			memberName: memberById.get(absence.memberId)?.name ?? '—',
			text: 'Abwesenheit eingetragen',
			href: getDashboardActivityHref(shareCode, 'absence', absence.id),
		});
		rawActivityByKey.set(`absence:${absence.id}`, absence.startDate.getTime());
	}
	for (const recurring of recurringRows.slice(0, ACTIVITY_LIMIT)) {
		const recurringTs = (recurring.lastCreatedAt ?? recurring.createdAt).getTime();
		activity.push({
			kind: 'recurring',
			timestamp: new Date(recurringTs).toISOString(),
			memberName: 'System',
			text: recurring.lastCreatedAt
				? `${recurring.description} aus Vorlage erstellt`
				: `${recurring.description} als Vorlage angelegt`,
			amountCents: recurring.amountCents,
			href: getDashboardActivityHref(shareCode, 'recurring', recurring.id),
		});
		rawActivityByKey.set(`recurring:${recurring.id}`, recurringTs);
	}
	for (const audit of auditRows) {
		const kind = getDashboardAuditKind(audit);
		if (isDuplicateAuditActivity(rawActivityByKey, kind, audit.entityId, audit.createdAt.getTime()))
			continue;
		const actorName = audit.memberId ? (memberById.get(audit.memberId)?.name ?? '—') : 'System';
		const href = getDashboardAuditHref(shareCode, audit);
		activity.push({
			kind,
			timestamp: audit.createdAt.toISOString(),
			memberName: actorName,
			text: formatAuditActivityText(audit.summary, actorName),
			...(href ? { href } : {}),
		});
	}
	activity.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
	const absentMemberIds = getAbsentMemberIds(
		absenceRows.map((item) => ({
			memberId: item.memberId,
			startDate: item.startDate.toISOString(),
			endDate: item.endDate.toISOString(),
		})),
		now.getTime(),
	);
	const currentAbsenceByMember = getCurrentAbsenceRowsByMember(absenceRows, now.getTime());
	const absentMembers = absentMemberIds
		.map((memberId) => {
			const absence = currentAbsenceByMember.get(memberId);
			const member = memberById.get(memberId);
			if (!absence || !member) return null;
			return {
				id: absence.id,
				memberId,
				name: member.name,
				endDate: absence.endDate.toISOString(),
				isCurrentMember: memberId === currentMemberId,
			};
		})
		.filter((item): item is NonNullable<typeof item> => item !== null);
	const openDebtCents = balances.reduce(
		(sum, balance) => sum + Math.max(0, -balance.balanceCents),
		0,
	);
	const openAnnouncementCount = countOpenManualAnnouncements(announcementRows);
	const hasAnnouncement = announcementRows.some((item) => item.source === 'manual');
	const overdueChoreCount = allDueChores.filter((item) => item.overdue).length;
	const currentMember = currentMemberId ? (memberById.get(currentMemberId) ?? null) : null;

	return {
		balances: [...balances].sort((a, b) => Math.abs(b.balanceCents) - Math.abs(a.balanceCents)),
		spendByDay,
		totalSpendCents: totalSpend,
		weekSpendCents: weekSpend,
		monthSpendCents: monthSpend,
		openShoppingCount: openShopping.length,
		openShoppingTop,
		dueChores,
		activity: activity.slice(0, ACTIVITY_LIMIT),
		latestAnnouncement,
		myOpenAnnouncements: filteredMyOpenAnnouncements.map((item) => ({
			...item,
			createdAt: item.createdAt.toISOString(),
		})),
		wgHealth: getWgHealth({
			shareCode,
			openShoppingCount: openShopping.length,
			overdueChoreCount,
			openDebtCents,
			openAnnouncementCount,
			absentMemberCount: absentMemberIds.length,
			dueRecurringCount: dueRecurringExpenses.length,
		}),
		dueRecurringExpenses,
		absentMembers,
		setup: {
			choreCount: choreRows.length,
			hasExpense: expenseRows.length > 0,
			hasShoppingItem: shoppingRows.length > 0,
			hasAnnouncement,
			notificationsEnabled: Boolean(currentMember && currentMemberNotification?.pushOptIn),
		},
	};
}
