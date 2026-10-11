import { recordAuditEvent } from '@/core/audit';
import { CHORE_RECURRENCE_TYPES, choreCompletions, chores, db, wgMembers } from '@/core/db';
import { bodyCodec, withIdempotentWrite } from '@/core/db/idempotent-write';
import { TransactionAbort } from '@/core/db/transaction';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { badRequest, serverError, tooMany } from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { readIdempotencyKey, setReplayWarning } from '@/core/idempotency-store';
import { logApiError } from '@/core/infra/observability';
import { dispatchNotificationSafely } from '@/core/notifications/notification-dispatch';
import type { NotificationWarning } from '@/core/notifications/notification-warning';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { berlinDayKey, startOfBerlinDay } from '@/core/utils/berlin-day';
import { MS_PER_DAY } from '@/core/utils/time';
import { computeOpenGapsByMember } from '@/features/chores/chore-fairness';
import { computeNextDueAt } from '@/features/chores/chore-recurrence';
import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const TITLE_MIN = 1;
const TITLE_MAX = 120;
const INTERVAL_MIN = 1;
// Cap depends on unit: 365 days or 60 months (5 years), both reasonable for a WG.
const INTERVAL_MAX_DAYS = 365;
const INTERVAL_MAX_MONTHS = 60;

type ChoreCreateResponseBody = { chore: unknown; warning: NotificationWarning };

const choreCreateCodec = bodyCodec(
	(body): body is ChoreCreateResponseBody =>
		body !== null && typeof body === 'object' && 'chore' in body,
);

const createChoreSchema = z
	.object({
		title: z.string().trim().min(TITLE_MIN).max(TITLE_MAX),
		intervalDays: z.number().int().min(INTERVAL_MIN).optional().default(7),
		// z.enum requires a mutable tuple; spread the readonly schema constant.
		recurrenceType: z
			.enum([...CHORE_RECURRENCE_TYPES])
			.optional()
			.default('days'),
		assignedMemberId: z.string().uuid().optional().nullable(),
		nextDueAt: z.string().datetime({ offset: true }).optional(),
	})
	.superRefine((data, ctx) => {
		const cap = data.recurrenceType === 'months' ? INTERVAL_MAX_MONTHS : INTERVAL_MAX_DAYS;
		if (data.intervalDays > cap) {
			ctx.addIssue({
				code: z.ZodIssueCode.too_big,
				maximum: cap,
				inclusive: true,
				type: 'number',
				path: ['intervalDays'],
				message: `intervalDays must be <= ${cap} for recurrenceType=${data.recurrenceType}`,
			});
		}
	});

export const GET = withWgRoute('chores GET', async (req, { code }) => {
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;
	const items = await db
		.select()
		.from(chores)
		.where(eq(chores.wgId, wgId))
		.orderBy(asc(chores.nextDueAt));

	if (items.length === 0) {
		return NextResponse.json({ chores: [] });
	}

	const now = Date.now();
	const monthStart = startOfBerlinDay(new Date(`${berlinDayKey(new Date(now)).slice(0, 7)}-01`));
	// Only the latest completion per chore and this month's per-member counts
	// are returned, so load exactly that instead of the full history. The
	// (chore_id, completed_at) index serves the DISTINCT ON; counts keep the
	// previous key order (most recent completer first). Completions are joined by WG instead of
	// `inArray(choreIds)`: one bind parameter per chore would exceed PostgreSQL's 65,535 limit.
	const [latestRows, monthRows] = await Promise.all([
		db
			.selectDistinctOn([choreCompletions.choreId], {
				choreId: choreCompletions.choreId,
				completedAt: choreCompletions.completedAt,
				completedByName: wgMembers.name,
			})
			.from(choreCompletions)
			.innerJoin(chores, eq(chores.id, choreCompletions.choreId))
			.innerJoin(wgMembers, eq(wgMembers.id, choreCompletions.completedByMemberId))
			.where(eq(chores.wgId, wgId))
			.orderBy(choreCompletions.choreId, desc(choreCompletions.completedAt)),
		db
			.select({
				memberId: choreCompletions.completedByMemberId,
				count: sql<number>`count(*)::int`,
			})
			.from(choreCompletions)
			.innerJoin(chores, eq(chores.id, choreCompletions.choreId))
			.where(and(eq(chores.wgId, wgId), gte(choreCompletions.completedAt, monthStart)))
			.groupBy(choreCompletions.completedByMemberId)
			.orderBy(sql`max(${choreCompletions.completedAt}) desc`),
	]);

	const latestCompletionByChore = new Map<string, { completedAt: Date; completedByName: string }>();
	for (const row of latestRows) {
		latestCompletionByChore.set(row.choreId, {
			completedAt: row.completedAt,
			completedByName: row.completedByName,
		});
	}

	const monthCompletions: Record<string, number> = {};
	for (const row of monthRows) monthCompletions[row.memberId] = Number(row.count);

	const openGapsByMember = computeOpenGapsByMember(
		items.map((item) => ({
			assignedMemberId: item.assignedMemberId,
			nextDueAt: item.nextDueAt.toISOString(),
		})),
		now,
	);

	return NextResponse.json({
		monthCompletions,
		chores: items.map((item) => {
			const latest = latestCompletionByChore.get(item.id) ?? null;
			return {
				...item,
				lastCompletedAt: latest?.completedAt ?? null,
				lastCompletedByName: latest?.completedByName ?? null,
				openGapCountForAssignee: item.assignedMemberId
					? (openGapsByMember.get(item.assignedMemberId) ?? 0)
					: 0,
			};
		}),
	});
});

export const POST = withWgRoute('chores POST', async (req, { code }) => {
	const parsed = await parseBody(req, createChoreSchema, {
		fieldErrors: {
			title: 'title_invalid',
			intervalDays: 'interval_invalid',
			recurrenceType: 'recurrence_type_invalid',
			assignedMemberId: 'member_id_invalid',
			nextDueAt: 'due_date_invalid',
		},
	});
	if (!parsed.ok) return parsed.response;

	const {
		title,
		intervalDays,
		recurrenceType,
		assignedMemberId = null,
		nextDueAt: nextDueAtStr,
	} = parsed.data;
	const createdAt = new Date();
	const nextDueAt = nextDueAtStr
		? new Date(nextDueAtStr)
		: // Months-based chores are first due today + N months (not today + 30N days), the
			// cadence the completion handler uses later. See chore-recurrence.ts.
			computeNextDueAt(createdAt, intervalDays, createdAt, recurrenceType);
	// Store the unclamped cadence anchor: a monthly chore created on 31.01 is
	// first due 28.02 but must keep day 31 for 31.03, 30.04, …
	const anchorAt = nextDueAtStr ? nextDueAt : createdAt;
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;
	const member = auth.member;
	const key = readIdempotencyKey(req);
	const scope = `chores-create:${wg.id}:${member.memberId}`;

	const createChore = () =>
		withIdempotentWrite(
			{
				scope,
				key,
				codec: choreCreateCodec,
				completeFailureCode: 'idempotency_response_write_failed',
				prepare: async () => {
					const limited = await checkRateLimit(wgWriteLimiter, `chore:${wg.id}:${member.memberId}`);
					if (!limited.success) return { stop: tooMany() };
					if (!assignedMemberId) return { input: undefined };
					// A chore may only be assigned to an active member, never to someone who
					// moved out.
					const memberExists = await db
						.select({ id: wgMembers.id })
						.from(wgMembers)
						.where(
							and(
								eq(wgMembers.id, assignedMemberId),
								eq(wgMembers.wgId, wg.id),
								isNull(wgMembers.deactivatedAt),
							),
						)
						.limit(1);
					return memberExists.length === 0
						? { stop: badRequest('member_not_in_wg') }
						: { input: undefined };
				},
			},
			async (tx) => {
				const [chore] = await tx
					.insert(chores)
					.values({
						wgId: wg.id,
						title,
						intervalDays,
						recurrenceType,
						assignedMemberId,
						nextDueAt,
						anchorAt,
					})
					.returning();
				if (!chore) throw new TransactionAbort('insert_failed');
				const body: ChoreCreateResponseBody = { chore, warning: null };
				return { status: 200, body, context: chore };
			},
		);
	let result: Awaited<ReturnType<typeof createChore>>;
	try {
		result = await createChore();
	} catch (err) {
		if (err instanceof TransactionAbort) return serverError(err.code);
		throw err;
	}
	if (result.kind === 'stopped') return result.response;
	if (result.kind === 'replayed' || !result.context) {
		return NextResponse.json(result.body, { status: result.status });
	}
	const chore = result.context;
	await recordAuditEvent({
		wgId: wg.id,
		memberId: member.memberId,
		eventType: 'chore.created',
		entityType: 'chore',
		entityId: chore.id,
		summary: `${member.name} hat ${chore.title} im Putzplan angelegt.`,
		metadata: {
			title: chore.title,
			intervalDays: chore.intervalDays,
			recurrenceType: chore.recurrenceType,
			assignedMemberId: chore.assignedMemberId,
			nextDueAt: chore.nextDueAt,
		},
	});
	let warning: NotificationWarning = null;
	if (assignedMemberId && nextDueAt.getTime() <= Date.now() + MS_PER_DAY) {
		({ warning } = await dispatchNotificationSafely({
			wg,
			event: 'chore.due',
			payload: { title, choreId: chore.id, nextDueAt: nextDueAt.toISOString() },
			targetMemberIds: [assignedMemberId],
		}));
	}
	if (key && warning !== null) {
		try {
			const persisted = await setReplayWarning(
				scope,
				key,
				{
					match: [{ path: ['chore', 'id'], equals: chore.id }],
					warningPath: ['warning'],
					replaces: [null],
				},
				warning,
			);
			if (!persisted) {
				warning = null;
				logApiError(
					'[chores POST] warning replay update missed',
					new Error('replay_warning_missed'),
				);
			}
		} catch (err) {
			warning = null;
			logApiError('[chores POST] warning replay update failed', err);
		}
	}
	const responseBody: ChoreCreateResponseBody = { chore, warning };
	return NextResponse.json(responseBody);
});
