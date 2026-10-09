import { recordAuditEvent } from '@/core/audit';
import { CHORE_RECURRENCE_TYPES, announcements, chores, db, wgMembers } from '@/core/db';
import type { ChoreRecurrenceType } from '@/core/db';
import { withTransaction } from '@/core/db/transaction';
import { isWgAdmin } from '@/core/guards/admin';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { badRequest, conflict, forbidden, notFound, tooMany } from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { buildChorePatchUpdate } from '@/features/chores/chore-patch';
import { type SQL, and, eq, isNull, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const INTERVAL_MIN = 1;
const INTERVAL_MAX_DAYS = 365;
const INTERVAL_MAX_MONTHS = 60;

const patchSchema = z
	.object({
		title: z.string().trim().min(1).max(120).optional(),
		assignedMemberId: z.string().uuid().nullable().optional(),
		nextDueAt: z.string().datetime({ offset: true }).optional(),
		intervalDays: z.number().int().min(INTERVAL_MIN).optional(),
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
		const cap = data.recurrenceType === 'months' ? INTERVAL_MAX_MONTHS : INTERVAL_MAX_DAYS;
		if (data.intervalDays > cap) {
			ctx.addIssue({
				code: z.ZodIssueCode.too_big,
				maximum: cap,
				inclusive: true,
				type: 'number',
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

	const limited = await checkRateLimit(wgWriteLimiter, `chore:${wgId}:${auth.member.memberId}`);
	if (!limited.success) return tooMany();

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
		updatedAt: Date;
	} = {
		updatedAt: new Date(),
	};
	if (parsed.data.title !== undefined) update.title = parsed.data.title;
	if (recurrencePatch) Object.assign(update, recurrencePatch.update);
	const expectedVersion = parsed.data.expectedUpdatedAt
		? sql`date_trunc('milliseconds', ${chores.updatedAt}) = ${new Date(parsed.data.expectedUpdatedAt)}`
		: undefined;
	if (parsed.data.assignedMemberId !== undefined) {
		const nextAssignee = parsed.data.assignedMemberId;
		update.assignedMemberId = nextAssignee;
		// A new assignee starts with a fresh reminder throttle, as on completion
		// and move-out; re-saving the same assignee keeps it.
		update.lastReminderAt = sql`case when ${chores.assignedMemberId} is distinct from ${nextAssignee}::uuid then null else ${chores.lastReminderAt} end`;
	}

	const previousAssignee =
		parsed.data.assignedMemberId !== undefined
			? ((
					await db
						.select({ assignedMemberId: chores.assignedMemberId })
						.from(chores)
						.where(and(eq(chores.id, id), eq(chores.wgId, wgId)))
						.limit(1)
				)[0]?.assignedMemberId ?? null)
			: undefined;

	const currentMatch = currentChore
		? and(
				eq(chores.intervalDays, currentChore.intervalDays),
				eq(chores.recurrenceType, currentChore.recurrenceType),
				eq(chores.nextDueAt, currentChore.nextDueAt),
			)
		: undefined;
	// The chore and the swap requests it answers change together: a failure in between would
	// leave an open request that no retry could ever close.
	const updated = await withTransaction(async (tx) => {
		const [row] = await tx
			.update(chores)
			.set(update)
			.where(and(eq(chores.id, id), eq(chores.wgId, wgId), currentMatch, expectedVersion))
			.returning();
		// A swap request is answered once someone else holds the chore, however that happened.
		if (row && previousAssignee !== undefined && previousAssignee !== row.assignedMemberId) {
			const now = new Date();
			await tx
				.update(announcements)
				.set({
					status: 'resolved',
					resolvedAt: now,
					resolvedByMemberId: auth.member.memberId,
					updatedAt: now,
				})
				.where(
					and(
						eq(announcements.wgId, wgId),
						eq(announcements.status, 'open'),
						eq(announcements.source, 'chore_swap'),
						eq(announcements.sourcePath, `/putzen?highlight=${encodeURIComponent(row.id)}`),
					),
				);
		}
		return row;
	});

	if (!updated) {
		if (currentChore || expectedVersion) {
			const stillExists = await db
				.select({ id: chores.id })
				.from(chores)
				.where(and(eq(chores.id, id), eq(chores.wgId, wgId)))
				.limit(1);
			if (stillExists.length > 0) return conflict('chore_changed');
		}
		return notFound('chore_not_found');
	}
	await recordAuditEvent({
		wgId,
		memberId: auth.member.memberId,
		eventType: 'chore.updated',
		entityType: 'chore',
		entityId: updated.id,
		summary: `${auth.member.name} hat ${updated.title} aktualisiert.`,
		metadata: {
			nextDueAt: updated.nextDueAt.toISOString(),
			assignedMemberId: updated.assignedMemberId,
			intervalDays: updated.intervalDays,
			recurrenceType: updated.recurrenceType,
		},
	});
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
	// Without this check, any member could wipe the chore plan (P1 audit
	// finding).
	if (!(await isWgAdmin(wgId, auth.member.memberId))) {
		return forbidden('admin_required', 'admin_required');
	}

	const limited = await checkRateLimit(wgWriteLimiter, `chore:${wgId}:${auth.member.memberId}`);
	if (!limited.success) return tooMany();

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
	await recordAuditEvent({
		wgId,
		memberId: auth.member.memberId,
		eventType: 'chore.deleted',
		entityType: 'chore',
		entityId: id,
		summary: `${auth.member.name} hat ${row.title} aus dem Putzplan entfernt.`,
		metadata: { title: row.title },
	});
	return NextResponse.json({ deleted: result[0]?.id });
});
