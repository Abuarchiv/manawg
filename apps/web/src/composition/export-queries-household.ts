import { chores, db, memberAbsences, shoppingItems, wgMembers } from '@/core/db';
import { asc, desc, eq } from 'drizzle-orm';
import type { ExportPage } from './export-queries-types';

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
