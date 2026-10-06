import {
	announcementComments,
	announcements,
	auditEvents,
	chores,
	db,
	memberAbsences,
	shoppingItems,
	wgChatMessages,
	wgEvents,
} from '@/core/db';
import { asc, desc, eq } from 'drizzle-orm';
import type { ExportPage } from './export-queries';

export async function fetchShoppingRows(wgId: string, page: ExportPage) {
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
export function mapShoppingRows(shoppingRows: Awaited<ReturnType<typeof fetchShoppingRows>>) {
	return shoppingRows.map((item) => ({
		id: item.id,
		name: item.name,
		quantity: item.quantity ?? '',
		status: item.boughtAt ? 'erledigt' : 'offen',
		createdAt: item.createdAt.toISOString(),
	}));
}

export async function fetchChoreRows(wgId: string, page: ExportPage) {
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
export function mapChoreRows(
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

export async function fetchAbsenceRows(wgId: string, page: ExportPage) {
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
export function mapAbsenceRows(
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

export async function fetchAnnouncementRows(wgId: string, page: ExportPage) {
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
export function mapAnnouncementRows(
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

export async function fetchAnnouncementCommentRows(wgId: string, page: ExportPage) {
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
export function mapAnnouncementCommentRows(
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

export async function fetchEventRows(wgId: string, page: ExportPage) {
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
export function mapEventRows(
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

export async function fetchChatMessageRows(wgId: string, page: ExportPage) {
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
export function mapChatMessageRows(
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

export async function fetchAuditRows(wgId: string, page: ExportPage) {
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
export function mapAuditRows(
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
