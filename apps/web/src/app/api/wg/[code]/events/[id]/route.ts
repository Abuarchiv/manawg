import { recordAuditEvent } from '@/core/audit';
import { db, wgEvents } from '@/core/db';
import { badRequest, forbidden, notFound, tooMany } from '@/core/errors';
import { isVerifiedWgAdmin } from '@/core/guards/admin';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { checkRateLimit, clientIpKey, wgReadLimiter, wgWriteLimiter } from '@/core/rate-limit';
import {
	formatRecurrenceRule,
	parseRecurrenceRule,
	serializeWgEvent,
} from '@/features/events/events';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2_000;
const LOCATION_MAX = 200;
const RECURRENCE_MAX = 200;

const patchSchema = z.object({
	title: z.string().trim().min(1).max(TITLE_MAX).optional(),
	description: z.string().trim().max(DESCRIPTION_MAX).nullable().optional(),
	startsAt: z.string().datetime({ offset: true }).optional(),
	endsAt: z.string().datetime({ offset: true }).nullable().optional(),
	allDay: z.boolean().optional(),
	location: z.string().trim().max(LOCATION_MAX).nullable().optional(),
	recurrence: z.string().trim().max(RECURRENCE_MAX).nullable().optional(),
});

function normalizeRecurrence(value: string | null): string | null | 'invalid' {
	if (value === null || value.length === 0) return null;
	const parsed = parseRecurrenceRule(value);
	if (!parsed) return 'invalid';
	return formatRecurrenceRule(parsed);
}

export const GET = withWgRoute<{ id: string }>('events GET id', async (req, { code, id }) => {
	if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');

	const limit = await checkRateLimit(wgReadLimiter, `events:${clientIpKey(req)}`);
	if (!limit.success) return tooMany('rate_limited');
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

	let raw: unknown;
	try {
		raw = await req.json();
	} catch {
		return badRequest('invalid_json');
	}
	const parsed = patchSchema.safeParse(raw);
	if (!parsed.success) {
		const { fieldErrors } = parsed.error.flatten();
		if (fieldErrors.title) return badRequest('title_invalid');
		if (fieldErrors.startsAt) return badRequest('starts_at_invalid');
		if (fieldErrors.endsAt) return badRequest('ends_at_invalid');
		if (fieldErrors.description) return badRequest('description_invalid');
		if (fieldErrors.location) return badRequest('location_invalid');
		if (fieldErrors.recurrence) return badRequest('recurrence_invalid');
		return badRequest('invalid_body');
	}

	const recurrence =
		parsed.data.recurrence === undefined ? undefined : normalizeRecurrence(parsed.data.recurrence);
	if (recurrence === 'invalid') return badRequest('recurrence_invalid');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;
	const limit = await checkRateLimit(wgWriteLimiter, `events:item:${wgId}:${auth.member.memberId}`);
	if (!limit.success) return tooMany('rate_limited');

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
	const isOwner = auth.member.verified && current.createdByMemberId === auth.member.memberId;
	if (!isOwner && !(await isVerifiedWgAdmin(wgId, auth.member.memberId, auth.member.verified))) {
		return forbidden('not_owner', 'not_owner');
	}

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
	if (recurrence !== undefined) update.recurrence = recurrence;

	const effectiveStartsAt = update.startsAt ?? current.startsAt;
	const effectiveEndsAt = update.endsAt === undefined ? current.endsAt : update.endsAt;
	if (effectiveEndsAt && effectiveEndsAt.getTime() < effectiveStartsAt.getTime()) {
		return badRequest('ends_before_start');
	}

	const [row] = await db
		.update(wgEvents)
		.set(update)
		.where(and(eq(wgEvents.id, id), eq(wgEvents.wgId, wgId)))
		.returning();
	if (!row) return notFound('event_not_found');

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
	const limit = await checkRateLimit(wgWriteLimiter, `events:item:${wgId}:${auth.member.memberId}`);
	if (!limit.success) return tooMany('rate_limited');

	const existing = await db
		.select({ createdByMemberId: wgEvents.createdByMemberId, title: wgEvents.title })
		.from(wgEvents)
		.where(and(eq(wgEvents.id, id), eq(wgEvents.wgId, wgId)))
		.limit(1);
	const row = existing[0];
	if (!row) return notFound('event_not_found');
	const isOwner = auth.member.verified && row.createdByMemberId === auth.member.memberId;
	if (!isOwner && !(await isVerifiedWgAdmin(wgId, auth.member.memberId, auth.member.verified))) {
		return forbidden('not_owner', 'not_owner');
	}

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
