import {
	announcements,
	auditEvents,
	chores,
	db,
	expenseSplits,
	expenses,
	memberAbsences,
	recurringExpenses,
	shoppingItems,
	wgMembers,
} from '@/core/db';
import { badRequest, serverError, tooMany } from '@/core/errors';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { readShareCode, resolveE2EFixture } from '@/core/guards/route-preamble';
import type { RouteCtx } from '@/core/infra/api-types';
import { logApiError } from '@/core/infra/observability';
import { checkRateLimit, wgExportLimiter } from '@/core/rate-limit';
import {
	type ExportSectionKey,
	buildWgExport,
	formatExpenseSplitsForExport,
	getExportSectionHeaders,
	getExportSectionRows,
	isExportSectionKey,
	parseRecurringSplitsForExport,
	toCsv,
} from '@/core/reads/export';
import { desc, eq, inArray } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

function getExportFormat(req: NextRequest): 'json' | 'csv' | null {
	const format = req.nextUrl.searchParams.get('format');
	if (format === null || format === 'json') return 'json';
	if (format === 'csv') return 'csv';
	return null;
}

function csvExportResponse(
	shareCode: string,
	section: ExportSectionKey,
	rows: Array<Record<string, unknown>>,
): NextResponse {
	return new NextResponse(toCsv(rows, getExportSectionHeaders(section)), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${shareCode}-${section}.csv"`,
		},
	});
}

interface ExportSplitRow {
	expenseId: string;
	debtorMemberId: string;
	amountCents: number;
	settledAt: Date | null;
}

/**
 * Group every split belonging to the given expenses by expense id.
 *
 * Both export paths — the expenses CSV section and the full JSON dump — read
 * the same rows the same way and built the same map, character for character.
 */
async function loadSplitsByExpense(expenseIds: string[]): Promise<Map<string, ExportSplitRow[]>> {
	const splitsByExpense = new Map<string, ExportSplitRow[]>();
	if (expenseIds.length === 0) return splitsByExpense;

	const splitRows = await db
		.select({
			expenseId: expenseSplits.expenseId,
			debtorMemberId: expenseSplits.debtorMemberId,
			amountCents: expenseSplits.amountCents,
			settledAt: expenseSplits.settledAt,
		})
		.from(expenseSplits)
		.where(inArray(expenseSplits.expenseId, expenseIds));

	for (const split of splitRows) {
		const splits = splitsByExpense.get(split.expenseId) ?? [];
		splits.push(split);
		splitsByExpense.set(split.expenseId, splits);
	}
	return splitsByExpense;
}

/*
 * The CSV branch (one section, on demand) and the JSON branch (every section,
 * in one dump) used to run the same query and the same row-mapping twice —
 * once per branch. Below: one fetch + one map per section, shared by both.
 */

async function fetchMemberRows(wgId: string) {
	return db
		.select({ id: wgMembers.id, name: wgMembers.name, createdAt: wgMembers.createdAt })
		.from(wgMembers)
		.where(eq(wgMembers.wgId, wgId));
}
type MemberRows = Awaited<ReturnType<typeof fetchMemberRows>>;

function toMemberById(memberRows: MemberRows): Map<string, string> {
	return new Map(memberRows.map((member) => [member.id, member.name]));
}
async function getMemberById(wgId: string): Promise<Map<string, string>> {
	return toMemberById(await fetchMemberRows(wgId));
}
function mapMemberRows(memberRows: MemberRows) {
	return memberRows.map((member) => ({
		id: member.id,
		name: member.name,
		createdAt: member.createdAt.toISOString(),
	}));
}

async function fetchExpenseRows(wgId: string) {
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
		.orderBy(desc(expenses.occurredAt));
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
		imageUrl: expense.imageUrl ?? '',
		occurredAt: expense.occurredAt.toISOString(),
		splits: formatExpenseSplitsForExport(splitsByExpense.get(expense.id) ?? [], memberById),
	}));
}

async function fetchRecurringRows(wgId: string) {
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
		.orderBy(desc(recurringExpenses.nextDueAt));
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

async function fetchShoppingRows(wgId: string) {
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
		.orderBy(desc(shoppingItems.createdAt));
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

async function fetchChoreRows(wgId: string) {
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
		.orderBy(desc(chores.nextDueAt));
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

async function fetchAbsenceRows(wgId: string) {
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
		.orderBy(desc(memberAbsences.startDate));
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

async function fetchAnnouncementRows(wgId: string) {
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
		.orderBy(desc(announcements.createdAt));
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

async function fetchAuditRows(wgId: string) {
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
		.orderBy(desc(auditEvents.createdAt));
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

export async function GET(
	req: NextRequest,
	ctx: RouteCtx<{ code: string }>,
): Promise<NextResponse> {
	const codeResult = await readShareCode(ctx);
	if (!codeResult.ok) return codeResult.response;
	const { code } = codeResult;
	const format = getExportFormat(req);
	if (!format) return badRequest('format_invalid');

	const e2e = await resolveE2EFixture(req, code);
	if (e2e.mode === 'denied') return e2e.response;
	if (e2e.mode === 'fixture') {
		const { fixture } = e2e;
		const now = new Date().toISOString();
		const data = buildWgExport({
			wg: { name: fixture.name, shareCode: fixture.shareCode },
			members: fixture.members.map((member) => ({
				id: member.id,
				name: member.name,
				createdAt: now,
			})),
			expenses: [],
			recurringExpenses: [],
			shoppingItems: [],
			chores: [],
			absences: [],
			announcements: [],
			auditEvents: [],
		});
		if (format === 'csv') {
			const requestedSection = req.nextUrl.searchParams.get('section');
			if (requestedSection !== null && !isExportSectionKey(requestedSection)) {
				return badRequest('section_invalid');
			}
			const section = requestedSection ?? 'expenses';
			return new NextResponse(
				toCsv(getExportSectionRows(data, section), getExportSectionHeaders(section)),
				{
					headers: {
						'content-type': 'text/csv; charset=utf-8',
						'content-disposition': `attachment; filename="${fixture.shareCode}-${section}.csv"`,
					},
				},
			);
		}
		return NextResponse.json(data);
	}

	try {
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wg = auth.wg;

		// Keyed per member rather than per IP: a whole WG can sit behind one NAT,
		// and one member's export budget must not lock out their flatmates.
		const limit = await checkRateLimit(wgExportLimiter, `export:${wg.id}:${auth.member.memberId}`);
		if (!limit.success) return tooMany('rate_limited');

		if (format === 'csv') {
			const requestedSection = req.nextUrl.searchParams.get('section');
			if (requestedSection !== null && !isExportSectionKey(requestedSection)) {
				return badRequest('section_invalid');
			}
			const section = requestedSection ?? 'expenses';

			if (section === 'members') {
				return csvExportResponse(
					wg.shareCode,
					section,
					mapMemberRows(await fetchMemberRows(wg.id)),
				);
			}

			if (section === 'expenses') {
				const [memberById, expenseRows] = await Promise.all([
					getMemberById(wg.id),
					fetchExpenseRows(wg.id),
				]);
				const splitsByExpense = await loadSplitsByExpense(expenseRows.map((expense) => expense.id));
				return csvExportResponse(
					wg.shareCode,
					section,
					mapExpenseRows(expenseRows, memberById, splitsByExpense),
				);
			}

			if (section === 'recurringExpenses') {
				const [memberById, recurringRows] = await Promise.all([
					getMemberById(wg.id),
					fetchRecurringRows(wg.id),
				]);
				return csvExportResponse(
					wg.shareCode,
					section,
					mapRecurringRows(recurringRows, memberById),
				);
			}

			if (section === 'shoppingItems') {
				return csvExportResponse(
					wg.shareCode,
					section,
					mapShoppingRows(await fetchShoppingRows(wg.id)),
				);
			}

			if (section === 'chores') {
				const [memberById, choreRows] = await Promise.all([
					getMemberById(wg.id),
					fetchChoreRows(wg.id),
				]);
				return csvExportResponse(wg.shareCode, section, mapChoreRows(choreRows, memberById));
			}

			if (section === 'absences') {
				const [memberById, absenceRows] = await Promise.all([
					getMemberById(wg.id),
					fetchAbsenceRows(wg.id),
				]);
				return csvExportResponse(wg.shareCode, section, mapAbsenceRows(absenceRows, memberById));
			}

			if (section === 'announcements') {
				const [memberById, announcementRows] = await Promise.all([
					getMemberById(wg.id),
					fetchAnnouncementRows(wg.id),
				]);
				return csvExportResponse(
					wg.shareCode,
					section,
					mapAnnouncementRows(announcementRows, memberById),
				);
			}

			const [memberById, auditRows] = await Promise.all([
				getMemberById(wg.id),
				fetchAuditRows(wg.id),
			]);
			return csvExportResponse(wg.shareCode, section, mapAuditRows(auditRows, memberById));
		}

		const [
			memberRows,
			expenseRows,
			recurringRows,
			shoppingRows,
			choreRows,
			absenceRows,
			announcementRows,
			auditRows,
		] = await Promise.all([
			fetchMemberRows(wg.id),
			fetchExpenseRows(wg.id),
			fetchRecurringRows(wg.id),
			fetchShoppingRows(wg.id),
			fetchChoreRows(wg.id),
			fetchAbsenceRows(wg.id),
			fetchAnnouncementRows(wg.id),
			fetchAuditRows(wg.id),
		]);
		const memberById = toMemberById(memberRows);
		const splitsByExpense = await loadSplitsByExpense(expenseRows.map((expense) => expense.id));
		const data = buildWgExport({
			wg: { name: wg.name, shareCode: wg.shareCode },
			members: mapMemberRows(memberRows),
			expenses: mapExpenseRows(expenseRows, memberById, splitsByExpense),
			recurringExpenses: mapRecurringRows(recurringRows, memberById),
			shoppingItems: mapShoppingRows(shoppingRows),
			chores: mapChoreRows(choreRows, memberById),
			absences: mapAbsenceRows(absenceRows, memberById),
			announcements: mapAnnouncementRows(announcementRows, memberById),
			auditEvents: mapAuditRows(auditRows, memberById),
		});

		return NextResponse.json(data);
	} catch (err) {
		logApiError('[export GET]', err);
		return serverError(err);
	}
}
