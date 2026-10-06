/** Assembles the dashboard payload from the WG's rows: balances, activity preview and health. */
import { getAbsentMemberIds } from '@/features/chores/absence';
import { getDueRecurringExpenses } from '@/features/expenses/recurring-expenses';
import type { ActivityKind } from './activity';
import { formatAuditActivityText } from './activity-audit';
import { type WgHealth, getWgHealth } from './dashboard-health';
import {
	getDashboardActivityHref,
	getDashboardAuditHref,
	getDashboardAuditKind,
} from './dashboard-links';
import {
	ACTIVITY_LIMIT,
	loadDashboardCoreRows,
	loadDashboardSecondaryRows,
} from './dashboard-queries';
import {
	type CurrencyTotals,
	type DaySpend,
	type MemberBalance,
	addCurrencyTotal,
	computeMemberBalances,
	singleCurrencyTotal,
	summarizeDashboardSpend,
} from './dashboard-summary';

export { computeMemberBalances, summarizeDashboardSpend } from './dashboard-summary';

const AUDIT_DEDUPE_WINDOW_MS = 60_000;

// Code points, not UTF-16 units: slicing mid-surrogate leaves a broken "�".
function clip(text: string, max: number): string {
	const chars = Array.from(text);
	return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
}

interface ActivityItem {
	kind: 'expense' | 'shopping' | 'announcement' | 'chore' | 'recurring' | 'absence' | 'audit';
	timestamp: string;
	/** Lets the UI render the viewer's own entries as „Du …“. */
	memberId?: string | null;
	memberName: string;
	text: string;
	amountCents?: number;
	currency?: string;
	href?: string;
}

interface ChoreDue {
	id: string;
	title: string;
	assignedMemberId: string | null;
	assignedMemberName: string | null;
	assignedColor: string | null;
	nextDueAt: string;
	overdue: boolean;
}

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
		currency: string;
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

/** `announcementRows` holds manual posts only, newest first. */
function getLatestManualAnnouncement(
	announcementRows: Array<{
		id?: string;
		content: string;
		authorMemberId: string;
		createdAt: Date;
	}>,
	memberById: Map<string, { name: string }>,
): DashboardData['latestAnnouncement'] {
	const latestManual = announcementRows[0];
	return latestManual
		? {
				...(latestManual.id ? { id: latestManual.id } : {}),
				content: latestManual.content,
				authorName: memberById.get(latestManual.authorMemberId)?.name ?? '—',
				createdAt: latestManual.createdAt.toISOString(),
			}
		: null;
}

function getCurrentAbsenceRowsByMember<
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

function buildDueChores(
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

function isDuplicateAuditActivity(
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

	const memberById = new Map(memberRows.map((m) => [m.id, m]));

	const balances = computeMemberBalances(memberRows, expenseRows, splitRows, paymentRows);

	const spendSummary = summarizeDashboardSpend(expenseRows, now);

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
			memberId: e.paidByMemberId,
			memberName: memberById.get(e.paidByMemberId)?.name ?? '—',
			text: e.description,
			amountCents: e.amountCents,
			currency: e.currency,
			href: getDashboardActivityHref(shareCode, 'expense', e.id),
		});
		rawActivityByKey.set(`expense:${e.id}`, new Date(e.occurredAt).getTime());
	}
	for (const s of recentShopping) {
		activity.push({
			kind: 'shopping',
			timestamp: (s.boughtAt ?? s.createdAt).toISOString(),
			memberId: s.addedByMemberId,
			memberName: memberById.get(s.addedByMemberId)?.name ?? '—',
			// Same wording as buildActivityTimeline in activity.ts: this bounded preview and the
			// full chronicle are built separately, so their texts are kept in sync by hand.
			text: s.boughtAt ? `${s.name} gekauft` : s.name,
			href: getDashboardActivityHref(shareCode, 'shopping', s.id),
		});
		rawActivityByKey.set(`shopping:${s.id}`, (s.boughtAt ?? s.createdAt).getTime());
	}
	for (const a of announcementRows) {
		activity.push({
			kind: 'announcement',
			timestamp: a.createdAt.toISOString(),
			memberId: a.authorMemberId,
			memberName: memberById.get(a.authorMemberId)?.name ?? '—',
			text: clip(a.content, 80),
			href: getDashboardActivityHref(shareCode, 'announcement', a.id),
		});
		rawActivityByKey.set(`announcement:${a.id}`, a.createdAt.getTime());
	}
	activity.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

	const latestAnnouncement = getLatestManualAnnouncement(announcementRows, memberById);
	const { myOpenAnnouncements, absenceRows, recurringRows, auditRows, currentMemberNotification } =
		await loadDashboardSecondaryRows(wgId, currentMemberId);
	const filteredMyOpenAnnouncements = myOpenAnnouncements;
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
	for (const absence of absenceRows.slice(0, ACTIVITY_LIMIT)) {
		activity.push({
			kind: 'absence',
			timestamp: absence.startDate.toISOString(),
			memberId: absence.memberId,
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
			currency: 'EUR',
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
			memberId: audit.memberId ?? null,
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
	const openDebtByCurrency: CurrencyTotals = {};
	for (const balance of balances) {
		if (balance.balanceCents < 0) {
			addCurrencyTotal(openDebtByCurrency, balance.currency, -balance.balanceCents);
		}
	}
	const openDebtCents = singleCurrencyTotal(openDebtByCurrency);
	const openAnnouncementCount = openAnnouncementCountRows[0]?.value ?? 0;
	const hasAnnouncement = announcementRows.length > 0;
	const overdueChoreCount = allDueChores.filter((item) => item.overdue).length;
	const currentMember = currentMemberId ? (memberById.get(currentMemberId) ?? null) : null;

	return {
		balances: [...balances].sort((a, b) => Math.abs(b.balanceCents) - Math.abs(a.balanceCents)),
		...spendSummary,
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
			openDebtCents: openDebtCents ?? 0,
			openDebtByCurrency,
			openAnnouncementCount,
			absentMemberCount: absentMemberIds.length,
			dueRecurringCount: dueRecurringExpenses.length,
		}),
		dueRecurringExpenses,
		absentMembers,
		setup: {
			choreCount: choreRows.length,
			hasExpense: expenseRows.length > 0,
			hasShoppingItem: recentShopping.length > 0,
			hasAnnouncement,
			notificationsEnabled: Boolean(currentMember && currentMemberNotification?.pushOptIn),
		},
	};
}
