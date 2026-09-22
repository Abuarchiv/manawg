import {
	announcements,
	chores,
	db,
	expenseSplits,
	expenses,
	memberAbsences,
	recurringExpenses,
	shoppingItems,
	wgMembers,
} from '@/core/db';
import { serverError } from '@/core/errors';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { readShareCode, resolveE2EFixture } from '@/core/guards/route-preamble';
import type { RouteCtx } from '@/core/infra/api-types';
import { buildE2EDashboardData } from '@/core/infra/e2e-db-down';
import { logApiError } from '@/core/infra/observability';
import { getSearchSuggestions, searchWgItems } from '@/core/reads/search';
import { desc, eq, sql } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

const SEARCH_PAGE_LIMIT = 120;

function iso(value: Date | string): string {
	return value instanceof Date ? value.toISOString() : String(value);
}

function buildE2ESearchResponse(code: string, currentMemberId: string, rawQuery: string) {
	const dashboard = buildE2EDashboardData(code);
	const input = {
		currentMemberId,
		shareCode: code,
		announcements: dashboard.latestAnnouncement
			? [
					{
						id: 'e2e-announcement-latest',
						content: dashboard.latestAnnouncement.content,
						createdAt: new Date().toISOString(),
						status: 'open',
					},
				]
			: [],
		chores: dashboard.dueChores.map((chore) => ({
			id: chore.id,
			title: chore.title,
			nextDueAt: chore.nextDueAt,
			assignedMemberId: currentMemberId,
		})),
		expenses: [
			{
				id: 'e2e-expense-miete',
				description: 'Miete Mai',
				amountCents: 95000,
				currency: 'EUR',
				occurredAt: new Date().toISOString(),
				paidByMemberId: currentMemberId,
				splits: [{ settledAt: null }],
			},
		],
		recurringExpenses: dashboard.dueRecurringExpenses.map((expense) => ({
			id: expense.id,
			description: expense.description,
			amountCents: expense.amountCents,
			currency: expense.currency,
			intervalMonths: 1,
			nextDueAt: expense.nextDueAt,
			paidByMemberId: currentMemberId,
		})),
		shoppingItems: dashboard.openShoppingTop.map((name, index) => ({
			id: `e2e-shopping-${index + 1}`,
			name,
			quantity: null,
			boughtAt: null,
			addedByMemberId: currentMemberId,
		})),
		absences: dashboard.absentMembers.map((absence) => ({
			id: `e2e-absence-${absence.memberId}`,
			memberId: absence.memberId,
			memberName: absence.name,
			startDate: new Date().toISOString(),
			endDate: absence.endDate,
			reason: null,
		})),
	};

	return {
		results: searchWgItems(rawQuery, input),
		suggestions: getSearchSuggestions({
			openShoppingTop: dashboard.openShoppingTop,
			dueChoreTitles: dashboard.dueChores.map((chore) => chore.title),
			dueRecurringDescriptions: dashboard.dueRecurringExpenses.map(
				(expense) => expense.description,
			),
			latestAnnouncementContent: dashboard.latestAnnouncement?.content ?? null,
		}),
	};
}

async function buildDbSearchResponse(
	wgId: string,
	currentMemberId: string,
	code: string,
	rawQuery: string,
) {
	const [
		memberRows,
		announcementRows,
		choreRows,
		expenseRows,
		recurringRows,
		shoppingRows,
		absenceRows,
		splitRows,
	] = await Promise.all([
		db
			.select({ id: wgMembers.id, name: wgMembers.name })
			.from(wgMembers)
			.where(eq(wgMembers.wgId, wgId)),
		db
			.select({
				id: announcements.id,
				authorMemberId: announcements.authorMemberId,
				content: announcements.content,
				imageUrl: announcements.imageUrl,
				status: announcements.status,
				createdAt: announcements.createdAt,
			})
			.from(announcements)
			.where(eq(announcements.wgId, wgId))
			.orderBy(desc(announcements.createdAt))
			.limit(SEARCH_PAGE_LIMIT),
		db
			.select({
				id: chores.id,
				title: chores.title,
				nextDueAt: chores.nextDueAt,
				assignedMemberId: chores.assignedMemberId,
			})
			.from(chores)
			.where(eq(chores.wgId, wgId))
			.orderBy(desc(chores.nextDueAt))
			.limit(SEARCH_PAGE_LIMIT),
		db
			.select({
				id: expenses.id,
				paidByMemberId: expenses.paidByMemberId,
				description: expenses.description,
				amountCents: expenses.amountCents,
				currency: expenses.currency,
				imageUrl: expenses.imageUrl,
				occurredAt: expenses.occurredAt,
			})
			.from(expenses)
			.where(eq(expenses.wgId, wgId))
			.orderBy(desc(expenses.occurredAt), desc(expenses.id))
			.limit(SEARCH_PAGE_LIMIT),
		db
			.select({
				id: recurringExpenses.id,
				description: recurringExpenses.description,
				amountCents: recurringExpenses.amountCents,
				intervalMonths: recurringExpenses.intervalMonths,
				nextDueAt: recurringExpenses.nextDueAt,
				paidByMemberId: recurringExpenses.paidByMemberId,
			})
			.from(recurringExpenses)
			.where(eq(recurringExpenses.wgId, wgId))
			.orderBy(desc(recurringExpenses.nextDueAt))
			.limit(SEARCH_PAGE_LIMIT),
		db
			.select({
				id: shoppingItems.id,
				name: shoppingItems.name,
				quantity: shoppingItems.quantity,
				boughtAt: shoppingItems.boughtAt,
				addedByMemberId: shoppingItems.addedByMemberId,
			})
			.from(shoppingItems)
			.where(eq(shoppingItems.wgId, wgId))
			.orderBy(desc(shoppingItems.createdAt))
			.limit(SEARCH_PAGE_LIMIT),
		db
			.select({
				id: memberAbsences.id,
				memberId: memberAbsences.memberId,
				startDate: memberAbsences.startDate,
				endDate: memberAbsences.endDate,
				reason: memberAbsences.reason,
			})
			.from(memberAbsences)
			.where(eq(memberAbsences.wgId, wgId))
			.orderBy(desc(memberAbsences.startDate))
			.limit(SEARCH_PAGE_LIMIT),
		// The splits belong to exactly the expense page above. They used to be a
		// second, sequential round trip; the correlated subquery keeps them in
		// the same parallel batch while selecting the identical row set (same
		// ordering, same limit — `id` as tiebreaker so both stay deterministic).
		db
			.select({
				expenseId: expenseSplits.expenseId,
				settledAt: expenseSplits.settledAt,
			})
			.from(expenseSplits)
			.where(
				sql`${expenseSplits.expenseId} in (
					select ${expenses.id} from ${expenses}
					where ${expenses.wgId} = ${wgId}
					order by ${expenses.occurredAt} desc, ${expenses.id} desc
					limit ${SEARCH_PAGE_LIMIT}
				)`,
			),
	]);

	const splitsByExpenseId = new Map<string, Array<{ settledAt: string | null }>>();
	for (const split of splitRows) {
		const list = splitsByExpenseId.get(split.expenseId) ?? [];
		list.push({ settledAt: split.settledAt ? iso(split.settledAt) : null });
		splitsByExpenseId.set(split.expenseId, list);
	}

	const memberNameById = new Map(memberRows.map((member) => [member.id, member.name]));
	const results = searchWgItems(rawQuery, {
		currentMemberId,
		shareCode: code,
		announcements: announcementRows.map((item) => ({
			...item,
			createdAt: iso(item.createdAt),
		})),
		chores: choreRows.map((item) => ({
			...item,
			nextDueAt: iso(item.nextDueAt),
		})),
		expenses: expenseRows.map((item) => ({
			...item,
			occurredAt: iso(item.occurredAt),
			splits: splitsByExpenseId.get(item.id) ?? [],
		})),
		recurringExpenses: recurringRows.map((item) => ({
			...item,
			currency: 'EUR',
			nextDueAt: iso(item.nextDueAt),
		})),
		shoppingItems: shoppingRows.map((item) => ({
			...item,
			boughtAt: item.boughtAt ? iso(item.boughtAt) : null,
		})),
		absences: absenceRows.map((item) => ({
			...item,
			memberName: memberNameById.get(item.memberId) ?? 'Mitglied',
			startDate: iso(item.startDate),
			endDate: iso(item.endDate),
		})),
	});

	return {
		results,
		suggestions: getSearchSuggestions({
			openShoppingTop: shoppingRows
				.filter((item) => item.boughtAt === null)
				.slice(0, 3)
				.map((item) => item.name),
			dueChoreTitles: choreRows.slice(0, 3).map((item) => item.title),
			dueRecurringDescriptions: recurringRows.slice(0, 3).map((item) => item.description),
			latestAnnouncementContent: announcementRows[0]?.content ?? null,
		}),
	};
}

export async function GET(
	req: NextRequest,
	ctx: RouteCtx<{ code: string }>,
): Promise<NextResponse> {
	const codeResult = await readShareCode(ctx);
	if (!codeResult.ok) return codeResult.response;
	const { code } = codeResult;
	const rawQuery = req.nextUrl.searchParams.get('q') ?? '';

	const e2e = await resolveE2EFixture(req, code);
	if (e2e.mode === 'denied') return e2e.response;
	if (e2e.mode === 'fixture') {
		const { memberId: currentMemberId } = e2e;
		return NextResponse.json(buildE2ESearchResponse(code, currentMemberId, rawQuery), {
			headers: { 'Cache-Control': 'private, no-store' },
		});
	}

	try {
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;

		return NextResponse.json(
			await buildDbSearchResponse(auth.wg.id, auth.member.memberId, code, rawQuery),
			{ headers: { 'Cache-Control': 'private, no-store' } },
		);
	} catch (err) {
		logApiError('[search GET]', err);
		return serverError(err);
	}
}
