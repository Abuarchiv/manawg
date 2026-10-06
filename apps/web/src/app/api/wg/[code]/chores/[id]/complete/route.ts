import { recordAuditEvent } from '@/core/audit';
import { announcements, choreCompletions, chores, db, memberAbsences, wgMembers } from '@/core/db';
import { bodyCodec, withIdempotentWrite } from '@/core/db/idempotent-write';
import { type DbTransaction, TransactionAbort } from '@/core/db/transaction';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import {
	HTTP,
	badRequest,
	conflict,
	notFound,
	serverError,
	tooMany,
	unreadableJsonBody,
} from '@/core/http/api-errors';
import { readJsonLimited } from '@/core/http/read-json';
import { readIdempotencyKey } from '@/core/idempotency-store';
import { logApiError } from '@/core/infra/observability';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { startOfBerlinDay } from '@/core/utils/berlin-day';
import { getAbsentMemberIds } from '@/features/chores/absence';
import {
	chooseNextAvailableMember,
	computeOpenGapsByMember,
} from '@/features/chores/chore-fairness';
import { computeNextDueAt, isLateCompletion } from '@/features/chores/chore-recurrence';
import { and, eq, gte, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';

type ChoreCompleteResponseBody = { chore: unknown };

const choreCompleteCodec = bodyCodec(
	(body): body is ChoreCompleteResponseBody =>
		body !== null && typeof body === 'object' && !Array.isArray(body) && 'chore' in body,
);

type ChoreSnapshot = Pick<
	typeof chores.$inferSelect,
	| 'id'
	| 'wgId'
	| 'intervalDays'
	| 'recurrenceType'
	| 'title'
	| 'assignedMemberId'
	| 'nextDueAt'
	| 'anchorAt'
>;

type CompletionPlan = {
	completedAt: Date;
	nextDueAt: Date;
	nextAssigned: string | null;
	effectiveAnchor: Date;
};

/**
 * The client sends the occurrence it completed. Queued actions that carry only the chore id
 * stay a visible conflict and are never reinterpreted as a completion of the current one.
 */
async function readExpectedOccurrence(
	req: Request,
	chore: ChoreSnapshot,
): Promise<NextResponse | null> {
	let raw: unknown;
	try {
		raw = await readJsonLimited(req);
	} catch (err) {
		return unreadableJsonBody(err);
	}
	const body =
		raw !== null && typeof raw === 'object' && !Array.isArray(raw)
			? (raw as Record<string, unknown>)
			: {};
	const expectedNextDueAt = body.expectedNextDueAt;
	const hasExpectedAssignee = Object.hasOwn(body, 'expectedAssignedMemberId');
	const expectedAssignedMemberId = body.expectedAssignedMemberId;
	if (typeof expectedNextDueAt !== 'string' || !hasExpectedAssignee) {
		return conflict('chore_occurrence_changed');
	}
	if (
		!Number.isFinite(Date.parse(expectedNextDueAt)) ||
		(expectedAssignedMemberId !== null &&
			(typeof expectedAssignedMemberId !== 'string' ||
				!UUID_PATTERN.test(expectedAssignedMemberId)))
	) {
		return badRequest('expected_occurrence_invalid');
	}
	if (
		Date.parse(expectedNextDueAt) !== chore.nextDueAt.getTime() ||
		expectedAssignedMemberId !== chore.assignedMemberId
	) {
		return conflict('chore_occurrence_changed');
	}
	return null;
}

/**
 * Next due date and assignee. Next-due anchors on the previous due date (clamped to now when
 * overdue), so early completions do not slide the cadence forward; a late completion re-anchors
 * a monthly cycle on its completion time. Only active members join the rotation, and the
 * score-aware ranker sees the same chore snapshot as the UI's "Nächste:r" hint.
 */
async function planCompletion(c: ChoreSnapshot): Promise<CompletionPlan> {
	const completedAt = new Date();
	const nextDueAt = computeNextDueAt(
		c.nextDueAt,
		c.intervalDays,
		completedAt,
		c.recurrenceType,
		c.anchorAt,
	);
	const late = isLateCompletion(c.nextDueAt, completedAt);
	const effectiveAnchor = late ? completedAt : (c.anchorAt ?? c.nextDueAt);
	const [members, absenceRows, wgChoresSnapshot] = await Promise.all([
		db
			.select({ id: wgMembers.id, name: wgMembers.name })
			.from(wgMembers)
			.where(and(eq(wgMembers.wgId, c.wgId), isNull(wgMembers.deactivatedAt)))
			.orderBy(wgMembers.createdAt),
		db
			.select({
				memberId: memberAbsences.memberId,
				startDate: memberAbsences.startDate,
				endDate: memberAbsences.endDate,
			})
			.from(memberAbsences)
			.where(
				and(
					eq(memberAbsences.wgId, c.wgId),
					gte(memberAbsences.endDate, startOfBerlinDay(nextDueAt)),
				),
			),
		db
			.select({ assignedMemberId: chores.assignedMemberId, nextDueAt: chores.nextDueAt })
			.from(chores)
			.where(eq(chores.wgId, c.wgId)),
	]);
	const absentMemberIds = getAbsentMemberIds(
		absenceRows.map((absence) => ({
			memberId: absence.memberId,
			startDate: absence.startDate.toISOString(),
			endDate: absence.endDate.toISOString(),
		})),
		// The next assignee has to be available on the next due day, not today: someone back
		// tomorrow can take a chore due next week.
		nextDueAt.getTime(),
	);
	const openGapsByMember = computeOpenGapsByMember(
		wgChoresSnapshot.map((row) => ({
			assignedMemberId: row.assignedMemberId,
			nextDueAt: row.nextDueAt.toISOString(),
		})),
		completedAt.getTime(),
	);
	const nextAssigned = chooseNextAvailableMember({
		members,
		currentMemberId: c.assignedMemberId,
		absentMemberIds,
		chores: wgChoresSnapshot.map((row) => ({
			assignedMemberId: row.assignedMemberId,
			openGapCountForAssignee: row.assignedMemberId
				? (openGapsByMember.get(row.assignedMemberId) ?? 0)
				: 0,
			nextDueAt: row.nextDueAt.toISOString(),
		})),
	});
	return { completedAt, nextDueAt, nextAssigned, effectiveAnchor };
}

/**
 * Advance the chore and record the completion as one unit: chore-fairness.ts counts
 * completions, so a rotation committed without its completion row would undercount that person
 * forever. The update is a compare-and-set on the snapshot used for cadence and rotation;
 * losing it to a concurrent completion or edit is a normal outcome that commits nothing.
 */
async function writeCompletion(
	tx: DbTransaction,
	c: ChoreSnapshot,
	plan: CompletionPlan,
	completedBy: string,
) {
	const assigneeMatch = c.assignedMemberId
		? eq(chores.assignedMemberId, c.assignedMemberId)
		: isNull(chores.assignedMemberId);
	// A new assignee must not be muted by the previous assignee's 18 h reminder throttle; an
	// unchanged assignee keeps it so a single-member WG is not reminded twice a day.
	const reminderReset = plan.nextAssigned !== c.assignedMemberId ? { lastReminderAt: null } : {};
	const [updated] = await tx
		.update(chores)
		.set({
			nextDueAt: plan.nextDueAt,
			assignedMemberId: plan.nextAssigned,
			anchorAt: plan.effectiveAnchor,
			...reminderReset,
		})
		.where(
			and(
				eq(chores.id, c.id),
				assigneeMatch,
				eq(chores.nextDueAt, c.nextDueAt),
				eq(chores.intervalDays, c.intervalDays),
				eq(chores.recurrenceType, c.recurrenceType),
			),
		)
		.returning();
	if (!updated) {
		return { status: HTTP.CONFLICT, body: null, context: { raced: true as const } };
	}

	const [completion] = await tx
		.insert(choreCompletions)
		.values({ choreId: c.id, completedByMemberId: completedBy })
		.returning({ id: choreCompletions.id });
	if (!completion) throw new TransactionAbort('completion_insert_failed');

	await tx
		.update(announcements)
		.set({
			status: 'resolved',
			resolvedAt: plan.completedAt,
			resolvedByMemberId: completedBy,
			updatedAt: plan.completedAt,
		})
		.where(
			and(
				eq(announcements.wgId, c.wgId),
				eq(announcements.status, 'open'),
				eq(announcements.source, 'chore_swap'),
				eq(announcements.sourcePath, `/putzen?highlight=${encodeURIComponent(c.id)}`),
			),
		);
	const body: ChoreCompleteResponseBody = { chore: updated };
	return { status: 200, body, context: { nextAssigned: plan.nextAssigned } };
}

export const POST = withWgRoute<{ id: string }>(
	'chore complete POST',
	async (req, { code, id }) => {
		if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const [c] = await db
			.select({
				id: chores.id,
				wgId: chores.wgId,
				intervalDays: chores.intervalDays,
				recurrenceType: chores.recurrenceType,
				title: chores.title,
				assignedMemberId: chores.assignedMemberId,
				nextDueAt: chores.nextDueAt,
				anchorAt: chores.anchorAt,
			})
			.from(chores)
			.where(and(eq(chores.id, id), eq(chores.wgId, auth.wg.id)))
			.limit(1);
		if (!c) return notFound('chore_not_found');
		// SECURITY: completedBy is always the authenticated caller; any body-supplied
		// attribution is ignored.
		const completedBy = auth.member.memberId;
		let writing = false;

		// A stored completion replays before the body is checked: once the first attempt
		// advanced the chore, its expected occurrence does not match anymore.
		const complete = () =>
			withIdempotentWrite(
				{
					scope: `chores-complete:${c.wgId}:${completedBy}:${c.id}`,
					key: readIdempotencyKey(req),
					codec: choreCompleteCodec,
					completeFailureCode: 'idempotency_response_write_failed',
					prepare: async () => {
						const invalid = await readExpectedOccurrence(req, c);
						if (invalid) return { stop: invalid };
						const limited = await checkRateLimit(wgWriteLimiter, `chore:${c.wgId}:${completedBy}`);
						if (!limited.success) return { stop: tooMany() };
						return { input: await planCompletion(c) };
					},
				},
				(tx, plan: CompletionPlan) => {
					writing = true;
					return writeCompletion(tx, c, plan, completedBy);
				},
			);
		let result: Awaited<ReturnType<typeof complete>>;
		try {
			result = await complete();
		} catch (err) {
			if (!writing) throw err;
			if (err instanceof TransactionAbort) {
				logApiError('[chore complete POST] completion insert failed', err);
				return serverError(err.code);
			}
			logApiError('[chore complete POST] transaction failed', err);
			return serverError('completion_insert_failed');
		}
		if (result.kind === 'stopped') return result.response;
		if (result.kind === 'replayed' || !result.context) {
			return NextResponse.json(result.body, { status: result.status });
		}
		if ('raced' in result.context) {
			// A concurrent DELETE also loses the compare-and-set: report it as gone, not done.
			const [stillThere] = await db
				.select({ id: chores.id })
				.from(chores)
				.where(eq(chores.id, c.id))
				.limit(1);
			return stillThere ? conflict('chore_already_completed') : notFound('chore_not_found');
		}

		await recordAuditEvent({
			wgId: c.wgId,
			memberId: completedBy,
			eventType: 'chore.completed',
			entityType: 'chore',
			entityId: c.id,
			summary: `${auth.member.name} hat ${c.title} erledigt.`,
			metadata: { nextAssignedMemberId: result.context.nextAssigned },
		});
		return NextResponse.json(result.body, { status: result.status });
	},
);
