import { and, eq, isNull, type SQL, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { recordAuditEvent } from '@/core/audit';
import type { ChoreRecurrenceType } from '@/core/db';
import { CHORE_RECURRENCE_TYPES, chores, db, wgMembers } from '@/core/db';
import { rowHoldsPatch } from '@/core/db/row-holds-patch';
import { withTransaction } from '@/core/db/transaction';
import { isWgAdmin } from '@/core/guards/admin';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import {
	badRequest,
	conflict,
	forbidden,
	notFound,
	rateLimitResponse,
} from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { dispatchNotificationSafely } from '@/core/notifications/notification-dispatch';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { MS_PER_DAY } from '@/core/utils/time';
import {
	CHORE_INTERVAL_MAX_DAYS,
	CHORE_INTERVAL_MAX_MONTHS,
	CHORE_INTERVAL_MIN,
	CHORE_TITLE_MAX,
	CHORE_TITLE_MIN,
} from '@/features/chores/chore-limits';
import { buildChorePatchUpdate } from '@/features/chores/chore-patch';
import { choreDueAtSchema } from '@/features/chores/server/chore-due-at-schema';
import {
	closeChoreSwapRequest,
	resolveChoreSwapRequest,
} from '@/features/chores/server/resolve-swap-request';

const patchSchema = z
	.object({
		title: z.string().trim().min(CHORE_TITLE_MIN).max(CHORE_TITLE_MAX).optional(),
		assignedMemberId: z.string().uuid().nullable().optional(),
		nextDueAt: choreDueAtSchema.optional(),
		intervalDays: z.number().int().min(CHORE_INTERVAL_MIN).optional(),
		// z.enum requires a mutable tuple; spread the readonly schema constant.
		recurrenceType: z.enum([...CHORE_RECURRENCE_TYPES]).optional(),
		// The version the editor was opened on; a newer one means someone saved meanwhile.
		expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
	})
	.superRefine((data, ctx) => {
		// Only validate the interval cap when intervalDays is being changed;
		// recurrenceType-only updates inherit the existing intervalDays.
		if (data.intervalDays === undefined) return;
		// Use the most permissive cap if recurrenceType is not provided in the
		// patch (the existing column value may be either). The cap mainly
		// guards against absurd values like intervalDays=999999.
		const cap =
			data.recurrenceType === 'months' ? CHORE_INTERVAL_MAX_MONTHS : CHORE_INTERVAL_MAX_DAYS;
		if (data.intervalDays > cap) {
			ctx.addIssue({
				code: 'too_big',
				maximum: cap,
				inclusive: true,
				origin: 'number',
				path: ['intervalDays'],
				message: `intervalDays must be <= ${cap}`,
			});
		}
	});

export const GET = withWgRoute<{ id: string }>('chores GET id', async (req, { code, id }) => {
	if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const rows = await db
		.select()
		.from(chores)
		.where(and(eq(chores.id, id), eq(chores.wgId, auth.wg.id)))
		.limit(1);
	const chore = rows[0];
	if (!chore) return notFound('chore_not_found');
	return NextResponse.json({ chore });
});

export const PATCH = withWgRoute<{ id: string }>('chores PATCH', async (req, { code, id }) => {
	if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');

	const parsed = await parseBody(req, patchSchema, {
		fieldErrors: {
			title: 'title_invalid',
			assignedMemberId: 'member_id_invalid',
			nextDueAt: 'due_date_invalid',
			intervalDays: 'interval_invalid',
			recurrenceType: 'recurrence_type_invalid',
			expectedUpdatedAt: 'expected_state_invalid',
		},
	});
	if (!parsed.ok) return parsed.response;
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;

	const limited = rateLimitResponse(
		await checkRateLimit(wgWriteLimiter, `chore:${wgId}:${auth.member.memberId}`),
	);
	if (limited) return limited;

	if (parsed.data.assignedMemberId) {
		const member = await db
			.select({ id: wgMembers.id })
			.from(wgMembers)
			.where(
				and(
					eq(wgMembers.id, parsed.data.assignedMemberId),
					eq(wgMembers.wgId, wgId),
					isNull(wgMembers.deactivatedAt),
				),
			)
			.limit(1);
		if (member.length === 0) return badRequest('member_not_in_wg');
	}
	const cadenceChanged =
		parsed.data.intervalDays !== undefined || parsed.data.recurrenceType !== undefined;
	const needsCurrentChore = cadenceChanged || parsed.data.nextDueAt !== undefined;
	let currentChore: {
		intervalDays: number;
		recurrenceType: ChoreRecurrenceType;
		nextDueAt: Date;
	} | null = null;
	if (needsCurrentChore) {
		const existing = await db
			.select({
				intervalDays: chores.intervalDays,
				recurrenceType: chores.recurrenceType,
				nextDueAt: chores.nextDueAt,
			})
			.from(chores)
			.where(and(eq(chores.id, id), eq(chores.wgId, wgId)))
			.limit(1);
		const row = existing[0];
		if (!row) return notFound('chore_not_found');
		currentChore = row;
	}
	const recurrencePatch = currentChore ? buildChorePatchUpdate(currentChore, parsed.data) : null;
	if (cadenceChanged && recurrencePatch && !recurrencePatch.validCadence) {
		return badRequest('interval_invalid');
	}

	const update: {
		title?: string;
		assignedMemberId?: string | null;
		nextDueAt?: Date;
		anchorAt?: Date;
		intervalDays?: number;
		recurrenceType?: ChoreRecurrenceType;
		lastReminderAt?: SQL;
		updatedAt: SQL;
	} = {
		updatedAt: sql`greatest(clock_timestamp(), ${chores.updatedAt} + interval '1 millisecond')`,
	};
	if (recurrencePatch) Object.assign(update, recurrencePatch.update);
	if (parsed.data.title !== undefined) update.title = parsed.data.title;
	if (parsed.data.assignedMemberId !== undefined) {
		const nextAssignee = parsed.data.assignedMemberId;
		update.assignedMemberId = nextAssignee;
		// A new assignee starts with a fresh reminder throttle, as on completion
		// and move-out; re-saving the same assignee keeps it.
		update.lastReminderAt = sql`case when ${chores.assignedMemberId} is distinct from ${nextAssignee}::uuid then null else ${chores.lastReminderAt} end`;
	}

	const expectedVersion = parsed.data.expectedUpdatedAt
		? sql`date_trunc('milliseconds', ${chores.updatedAt}) = ${new Date(parsed.data.expectedUpdatedAt)}`
		: undefined;
	const currentMatch = currentChore
		? and(
				eq(chores.intervalDays, currentChore.intervalDays),
				eq(chores.recurrenceType, currentChore.recurrenceType),
				eq(chores.nextDueAt, currentChore.nextDueAt),
			)
		: undefined;
	// The chore and the swap request it answers change together: a failure in between would
	// leave an open request that no retry could ever close.
	const { updated, previousAssigneeId } = await withTransaction(async (tx) => {
		// Read under the row lock that the update below keeps: a request opened by someone who
		// took the chore a moment ago is only answered by a change this transaction really makes.
		const previousAssigneeId =
			parsed.data.assignedMemberId !== undefined
				? ((
						await tx
							.select({ assignedMemberId: chores.assignedMemberId })
							.from(chores)
							.where(and(eq(chores.id, id), eq(chores.wgId, wgId)))
							.limit(1)
							.for('update')
					)[0]?.assignedMemberId ?? null)
				: undefined;
		const [row] = await tx
			.update(chores)
			.set(update)
			.where(and(eq(chores.id, id), eq(chores.wgId, wgId), currentMatch, expectedVersion))
			.returning();
		// An unassigned chore leaves the request open: nobody took it over.
		if (
			row?.assignedMemberId &&
			previousAssigneeId !== undefined &&
			previousAssigneeId !== row.assignedMemberId
		) {
			await closeChoreSwapRequest(tx, wgId, row.id, auth.member.memberId);
		}
		return { updated: row, previousAssigneeId };
	});

	if (!updated) {
		if (currentChore || expectedVersion) {
			const [stored] = await db
				.select()
				.from(chores)
				.where(and(eq(chores.id, id), eq(chores.wgId, wgId)))
				.limit(1);
			if (!stored) return notFound('chore_not_found');
			// The retry of a save whose answer got lost finds its own values in place.
			const requested = {
				title: parsed.data.title,
				assignedMemberId: parsed.data.assignedMemberId,
				intervalDays: parsed.data.intervalDays,
				recurrenceType: parsed.data.recurrenceType,
				nextDueAt: parsed.data.nextDueAt ? new Date(parsed.data.nextDueAt) : undefined,
			};
			if (rowHoldsPatch(stored, requested)) return NextResponse.json({ chore: stored });
			return conflict('chore_changed');
		}
		return notFound('chore_not_found');
	}
	await recordAuditEvent({
		wgId,
		memberId: auth.member.memberId,
		eventType: 'chore.updated',
		entityType: 'chore',
		entityId: updated.id,
		actorName: auth.member.name,
		metadata: {
			title: updated.title,
			nextDueAt: updated.nextDueAt.toISOString(),
			assignedMemberId: updated.assignedMemberId,
			intervalDays: updated.intervalDays,
			recurrenceType: updated.recurrenceType,
		},
	});
	const assigneeChanged =
		previousAssigneeId !== undefined && previousAssigneeId !== updated.assignedMemberId;
	// Taking over a chore yourself needs no push; handing a due chore to someone else does.
	if (
		assigneeChanged &&
		updated.assignedMemberId &&
		updated.assignedMemberId !== auth.member.memberId &&
		updated.nextDueAt.getTime() <= Date.now() + MS_PER_DAY
	) {
		await dispatchNotificationSafely({
			wg: auth.wg,
			event: 'chore.due',
			payload: {
				title: updated.title,
				choreId: updated.id,
				nextDueAt: updated.nextDueAt.toISOString(),
			},
			targetMemberIds: [updated.assignedMemberId],
		});
	}
	return NextResponse.json({ chore: updated });
});

export const DELETE = withWgRoute<{ id: string }>('chores DELETE', async (req, { code, id }) => {
	if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;

	// Admin-only gate: chores are shared infrastructure for the whole WG,
	// so any member can edit/reassign (PATCH stays open for collaboration),
	// but only the admin may permanently remove a chore from the plan.
	// Without this check, any member could wipe the chore plan.
	if (!(await isWgAdmin(wgId, auth.member.memberId))) {
		return forbidden('admin_required', 'admin_required');
	}

	const limited = rateLimitResponse(
		await checkRateLimit(wgWriteLimiter, `chore:${wgId}:${auth.member.memberId}`),
	);
	if (limited) return limited;

	const existing = await db
		.select({ title: chores.title })
		.from(chores)
		.where(and(eq(chores.id, id), eq(chores.wgId, wgId)))
		.limit(1);
	const row = existing[0];
	if (!row) return notFound('chore_not_found');

	const result = await db
		.delete(chores)
		.where(and(eq(chores.id, id), eq(chores.wgId, wgId)))
		.returning({ id: chores.id });

	if (result.length === 0) return notFound('chore_not_found');
	await resolveChoreSwapRequest(wgId, id, auth.member.memberId);
	await recordAuditEvent({
		wgId,
		memberId: auth.member.memberId,
		eventType: 'chore.deleted',
		entityType: 'chore',
		entityId: id,
		actorName: auth.member.name,
		metadata: { title: row.title },
	});
	return NextResponse.json({ deleted: result[0]?.id });
});
