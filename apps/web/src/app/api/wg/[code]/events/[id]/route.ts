import { recordAuditEvent } from '@/core/audit';
import { db, wgEvents } from '@/core/db';
import { requireOwnerOrAdmin } from '@/core/guards/admin';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { badRequest, conflict, notFound, rateLimitResponse } from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { checkRateLimit, clientIpKey, wgReadLimiter, wgWriteLimiter } from '@/core/rate-limit';
import {
	eventDateTimeSchema,
	eventDescriptionSchema,
	eventLocationSchema,
	eventRecurrenceSchema,
	eventTitleSchema,
} from '@/features/events/event-schemas';
import { canonicalRecurrenceRule, serializeWgEvent } from '@/features/events/events';
import { and, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const patchSchema = z.object({
	title: eventTitleSchema.optional(),
	description: eventDescriptionSchema.optional(),
	startsAt: eventDateTimeSchema.optional(),
	endsAt: eventDateTimeSchema.nullable().optional(),
	allDay: z.boolean().optional(),
	location: eventLocationSchema.optional(),
	recurrence: eventRecurrenceSchema.optional(),
	// The version the form was opened on; a newer one means the series changed meanwhile
	// (an edit, or one date taken out of it).
	expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});

export const GET = withWgRoute<{ id: string }>('events GET id', async (req, { code, id }) => {
	if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');

	const limit = rateLimitResponse(
		await checkRateLimit(wgReadLimiter, `events:${clientIpKey(req)}`),
		'rate_limited',
	);
	if (limit) return limit;
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;
	const rows = await db
		.select()
		.from(wgEvents)
		.where(and(eq(wgEvents.id, id), eq(wgEvents.wgId, wgId)))
		.limit(1);
	const row = rows[0];
	if (!row) return notFound('event_not_found');
	return NextResponse.json({ event: serializeWgEvent(row) });
});

export const PATCH = withWgRoute<{ id: string }>('events PATCH', async (req, { code, id }) => {
	if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');

	const parsed = await parseBody(req, patchSchema, {
		fieldErrors: {
			title: 'title_invalid',
			startsAt: 'starts_at_invalid',
			endsAt: 'ends_at_invalid',
			description: 'description_invalid',
			location: 'location_invalid',
			recurrence: 'recurrence_invalid',
			expectedUpdatedAt: 'expected_state_invalid',
		},
	});
	if (!parsed.ok) return parsed.response;

	const recurrence =
		parsed.data.recurrence === undefined
			? undefined
			: canonicalRecurrenceRule(parsed.data.recurrence);
	if (recurrence && !recurrence.ok) return badRequest('recurrence_invalid');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;
	const limit = rateLimitResponse(
		await checkRateLimit(wgWriteLimiter, `events:item:${wgId}:${auth.member.memberId}`),
		'rate_limited',
	);
	if (limit) return limit;

	const existing = await db
		.select({
			createdByMemberId: wgEvents.createdByMemberId,
			startsAt: wgEvents.startsAt,
			endsAt: wgEvents.endsAt,
		})
		.from(wgEvents)
		.where(and(eq(wgEvents.id, id), eq(wgEvents.wgId, wgId)))
		.limit(1);
	const current = existing[0];
	if (!current) return notFound('event_not_found');
	const denied = await requireOwnerOrAdmin(wgId, auth.member, current.createdByMemberId);
	if (denied) return denied;

	const update: Partial<typeof wgEvents.$inferInsert> & { updatedAt: Date } = {
		updatedAt: new Date(),
	};
	if (parsed.data.title !== undefined) update.title = parsed.data.title;
	if (parsed.data.description !== undefined) update.description = parsed.data.description;
	if (parsed.data.startsAt !== undefined) update.startsAt = new Date(parsed.data.startsAt);
	if (parsed.data.endsAt !== undefined)
		update.endsAt = parsed.data.endsAt ? new Date(parsed.data.endsAt) : null;
	if (parsed.data.allDay !== undefined) update.allDay = parsed.data.allDay;
	if (parsed.data.location !== undefined) update.location = parsed.data.location;
	if (recurrence?.ok) update.recurrence = recurrence.rule;

	const effectiveStartsAt = update.startsAt ?? current.startsAt;
	const effectiveEndsAt = update.endsAt === undefined ? current.endsAt : update.endsAt;
	if (effectiveEndsAt && effectiveEndsAt.getTime() < effectiveStartsAt.getTime()) {
		return badRequest('ends_before_start');
	}

	const [row] = await db
		.update(wgEvents)
		.set(update)
		.where(
			and(
				eq(wgEvents.id, id),
				eq(wgEvents.wgId, wgId),
				parsed.data.expectedUpdatedAt
					? sql`date_trunc('milliseconds', ${wgEvents.updatedAt}) = ${new Date(parsed.data.expectedUpdatedAt)}`
					: undefined,
			),
		)
		.returning();
	if (!row) {
		// Still there means the version differed: someone saved or changed a date meanwhile.
		const [stillThere] = await db
			.select({ id: wgEvents.id })
			.from(wgEvents)
			.where(and(eq(wgEvents.id, id), eq(wgEvents.wgId, wgId)))
			.limit(1);
		return stillThere ? conflict('event_changed') : notFound('event_not_found');
	}

	await recordAuditEvent({
		wgId,
		memberId: auth.member.memberId,
		eventType: 'event.updated',
		entityType: 'wg_event',
		entityId: row.id,
		summary: `${auth.member.name} hat den Termin „${row.title}“ aktualisiert.`,
		metadata: {
			startsAt: row.startsAt.toISOString(),
			allDay: row.allDay,
		},
	});
	return NextResponse.json({ event: serializeWgEvent(row) });
});

export const DELETE = withWgRoute<{ id: string }>('events DELETE', async (req, { code, id }) => {
	if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;
	const limit = rateLimitResponse(
		await checkRateLimit(wgWriteLimiter, `events:item:${wgId}:${auth.member.memberId}`),
		'rate_limited',
	);
	if (limit) return limit;

	const existing = await db
		.select({ createdByMemberId: wgEvents.createdByMemberId, title: wgEvents.title })
		.from(wgEvents)
		.where(and(eq(wgEvents.id, id), eq(wgEvents.wgId, wgId)))
		.limit(1);
	const row = existing[0];
	if (!row) return notFound('event_not_found');
	const denied = await requireOwnerOrAdmin(wgId, auth.member, row.createdByMemberId);
	if (denied) return denied;

	const result = await db
		.delete(wgEvents)
		.where(and(eq(wgEvents.id, id), eq(wgEvents.wgId, wgId)))
		.returning({ id: wgEvents.id });
	if (result.length === 0) return notFound('event_not_found');

	await recordAuditEvent({
		wgId,
		memberId: auth.member.memberId,
		eventType: 'event.deleted',
		entityType: 'wg_event',
		entityId: id,
		summary: `${auth.member.name} hat den Termin „${row.title}“ entfernt.`,
		metadata: { title: row.title },
	});
	return NextResponse.json({ deleted: true });
});
