/** Dashboard view pieces built from loaded rows: activity preview, due chores and absences. */
import { getAbsentMemberIds } from '@/features/chores/absence';
import type { ActivityKind } from './activity';
import { formatAuditActivityText } from './activity-audit';
import {
	getDashboardActivityHref,
	getDashboardAuditHref,
	getDashboardAuditKind,
} from './dashboard-links';

export const ACTIVITY_LIMIT = 6;
const AUDIT_DEDUPE_WINDOW_MS = 60_000;

type MemberLookup = Map<string, { name: string; color: string | null }>;

export interface ActivityItem {
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

export interface ChoreDue {
	id: string;
	title: string;
	assignedMemberId: string | null;
	assignedMemberName: string | null;
	assignedColor: string | null;
	nextDueAt: string;
	overdue: boolean;
}

export interface LatestAnnouncement {
	id?: string;
	content: string;
	authorName: string;
	createdAt: string;
}

export interface AbsentMember {
	id: string;
	memberId: string;
	name: string;
	endDate: string;
	isCurrentMember: boolean;
}

interface AnnouncementRow {
	id: string;
	content: string;
	authorMemberId: string;
	createdAt: Date;
}

interface AbsenceRow {
	id: string;
	memberId: string;
	startDate: Date;
	endDate: Date;
}

interface DashboardActivityInput {
	shareCode: string;
	memberById: MemberLookup;
	expenseRows: ReadonlyArray<{
		id: string;
		paidByMemberId: string;
		amountCents: number;
		currency: string;
		description: string;
		occurredAt: Date;
	}>;
	recentShopping: ReadonlyArray<{
		id: string;
		name: string;
		addedByMemberId: string;
		createdAt: Date;
		boughtAt: Date | null;
	}>;
	announcementRows: readonly AnnouncementRow[];
	absenceRows: readonly AbsenceRow[];
	recurringRows: ReadonlyArray<{
		id: string;
		description: string;
		amountCents: number;
		lastCreatedAt: Date | null;
		createdAt: Date;
	}>;
	auditRows: ReadonlyArray<
		Parameters<typeof getDashboardAuditKind>[0] &
			Parameters<typeof getDashboardAuditHref>[1] & {
				memberId: string | null;
				entityId: string | null;
				summary: string;
				createdAt: Date;
			}
	>;
}

// Code points, not UTF-16 units: slicing mid-surrogate leaves a broken "�".
function clip(text: string, max: number): string {
	const chars = Array.from(text);
	return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
}

/** `announcementRows` holds manual posts only, newest first. */
export function getLatestManualAnnouncement(
	announcementRows: ReadonlyArray<Omit<AnnouncementRow, 'id'> & { id?: string }>,
	memberById: Map<string, { name: string }>,
): LatestAnnouncement | null {
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

export function buildDueChores(
	choreRows: ReadonlyArray<{
		id: string;
		title: string;
		nextDueAt: Date;
		assignedMemberId: string | null;
	}>,
	memberById: MemberLookup,
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

/**
 * The newest ACTIVITY_LIMIT entries across all sections. Audit events that only repeat a raw
 * entry of the same entity within AUDIT_DEDUPE_WINDOW_MS are dropped.
 */
export function buildDashboardActivity(input: DashboardActivityInput): ActivityItem[] {
	const { shareCode, memberById } = input;
	const memberName = (id: string) => memberById.get(id)?.name ?? '—';
	const activity: ActivityItem[] = [];
	const rawActivityByKey = new Map<string, number>();
	for (const e of input.expenseRows.slice(0, ACTIVITY_LIMIT)) {
		activity.push({
			kind: 'expense',
			timestamp: e.occurredAt.toISOString(),
			memberId: e.paidByMemberId,
			memberName: memberName(e.paidByMemberId),
			text: e.description,
			amountCents: e.amountCents,
			currency: e.currency,
			href: getDashboardActivityHref(shareCode, 'expense', e.id),
		});
		rawActivityByKey.set(`expense:${e.id}`, new Date(e.occurredAt).getTime());
	}
	for (const s of input.recentShopping) {
		activity.push({
			kind: 'shopping',
			timestamp: (s.boughtAt ?? s.createdAt).toISOString(),
			memberId: s.addedByMemberId,
			memberName: memberName(s.addedByMemberId),
			// Same wording as buildActivityTimeline in activity.ts: this bounded preview and the
			// full chronicle are built separately, so their texts are kept in sync by hand.
			text: s.boughtAt ? `${s.name} gekauft` : s.name,
			href: getDashboardActivityHref(shareCode, 'shopping', s.id),
		});
		rawActivityByKey.set(`shopping:${s.id}`, (s.boughtAt ?? s.createdAt).getTime());
	}
	for (const a of input.announcementRows) {
		activity.push({
			kind: 'announcement',
			timestamp: a.createdAt.toISOString(),
			memberId: a.authorMemberId,
			memberName: memberName(a.authorMemberId),
			text: clip(a.content, 80),
			href: getDashboardActivityHref(shareCode, 'announcement', a.id),
		});
		rawActivityByKey.set(`announcement:${a.id}`, a.createdAt.getTime());
	}
	// Sorted before the later sections are appended so equal timestamps keep a stable order.
	activity.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
	for (const absence of input.absenceRows.slice(0, ACTIVITY_LIMIT)) {
		activity.push({
			kind: 'absence',
			timestamp: absence.startDate.toISOString(),
			memberId: absence.memberId,
			memberName: memberName(absence.memberId),
			text: 'Abwesenheit eingetragen',
			href: getDashboardActivityHref(shareCode, 'absence', absence.id),
		});
		rawActivityByKey.set(`absence:${absence.id}`, absence.startDate.getTime());
	}
	for (const recurring of input.recurringRows.slice(0, ACTIVITY_LIMIT)) {
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
	for (const audit of input.auditRows) {
		const kind = getDashboardAuditKind(audit);
		if (isDuplicateAuditActivity(rawActivityByKey, kind, audit.entityId, audit.createdAt.getTime()))
			continue;
		const actorName = audit.memberId ? memberName(audit.memberId) : 'System';
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
	return activity.slice(0, ACTIVITY_LIMIT);
}

function getCurrentAbsenceRowsByMember<TRow extends AbsenceRow>(
	absenceRows: readonly TRow[],
	nowMs: number,
): Map<string, TRow> {
	const currentRows = absenceRows
		.filter((item) => item.startDate.getTime() <= nowMs && item.endDate.getTime() >= nowMs)
		.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
	const currentByMember = new Map<string, TRow>();
	for (const item of currentRows) {
		if (!currentByMember.has(item.memberId)) currentByMember.set(item.memberId, item);
	}
	return currentByMember;
}

/** Members absent right now, with the absence that covers today. */
export function buildAbsentMembers(
	absenceRows: readonly AbsenceRow[],
	memberById: MemberLookup,
	currentMemberId: string | null | undefined,
	nowMs: number,
): { absentMemberIds: string[]; absentMembers: AbsentMember[] } {
	const absentMemberIds = getAbsentMemberIds(
		absenceRows.map((item) => ({
			memberId: item.memberId,
			startDate: item.startDate.toISOString(),
			endDate: item.endDate.toISOString(),
		})),
		nowMs,
	);
	const currentAbsenceByMember = getCurrentAbsenceRowsByMember(absenceRows, nowMs);
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
	return { absentMemberIds, absentMembers };
}
