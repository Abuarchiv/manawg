import { recordAuditEvent } from '@/core/audit';
import { wgEvents } from '@/core/db';
import { TransactionAbort, withTransaction } from '@/core/db/transaction';
import { requireOwnerOrAdmin } from '@/core/guards/admin';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { badRequest, conflict, notFound, tooMany } from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import {
	eventDateTimeSchema,
	eventDescriptionSchema,
	eventLocationSchema,
	eventTitleSchema,
} from '@/features/events/event-schemas';
import { expandRecurrence, serializeWgEvent } from '@/features/events/events';
import { withExcludedOccurrence } from '@/features/events/recurrence-rule';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const occurrenceSchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('cancel'), occurrenceStartsAt: eventDateTimeSchema }),
	z.object({
		action: z.literal('detach'),
		occurrenceStartsAt: eventDateTimeSchema,
		title: eventTitleSchema,
		description: eventDescriptionSchema.optional(),
		startsAt: eventDateTimeSchema,
		endsAt: eventDateTimeSchema.nullable().optional(),
		allDay: z.boolean().optional().default(false),
		location: eventLocationSchema.optional(),
		expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
	}),
]);

/**
 * Change one occurrence of a series: `cancel` takes it out, `detach` takes it out and creates
 * a single event with the given values in its place. Both happen in one transaction.
 */
export const POST = withWgRoute<{ id: string }>('events occurrence', async (req, { code, id }) => {
	if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
	const parsed = await parseBody(req, occurrenceSchema, {
		fieldErrors: {
			title: 'title_invalid',
			startsAt: 'starts_at_invalid',
			endsAt: 'ends_at_invalid',
			description: 'description_invalid',
			location: 'location_invalid',
			occurrenceStartsAt: 'occurrence_invalid',
			expectedUpdatedAt: 'expected_state_invalid',
		},
	});
	if (!parsed.ok) return parsed.response;
	const body = parsed.data;
	if (
		body.action === 'detach' &&
		body.endsAt &&
		Date.parse(body.endsAt) < Date.parse(body.startsAt)
	) {
		return badRequest('ends_before_start');
	}
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;
	const limit = await checkRateLimit(wgWriteLimiter, `events:item:${wgId}:${auth.member.memberId}`);
	if (!limit.success) return tooMany('rate_limited');

	let denied: NextResponse | null = null;
	try {
		const outcome = await withTransaction(async (tx) => {
			const [root] = await tx
				.select()
				.from(wgEvents)
				.where(and(eq(wgEvents.id, id), eq(wgEvents.wgId, wgId)))
				.limit(1)
				.for('update');
			if (!root) return { error: notFound('event_not_found') };
			denied = await requireOwnerOrAdmin(wgId, auth.member, root.createdByMemberId);
			if (denied) return { error: denied };
			if (!root.recurrence) return { error: badRequest('not_recurring') };
			// The values come from a form opened on an older version of the series.
			if (
				body.action === 'detach' &&
				body.expectedUpdatedAt &&
				root.updatedAt.getTime() !== new Date(body.expectedUpdatedAt).getTime()
			) {
				return { error: conflict('event_changed') };
			}

			// Only a real occurrence of the series can be changed, not an arbitrary instant.
			const occurrenceMs = Date.parse(body.occurrenceStartsAt);
			const isOccurrence = expandRecurrence(
				{ ...serializeWgEvent(root), recurrence: root.recurrence },
				new Date(occurrenceMs),
				new Date(occurrenceMs),
			).some((occurrence) => Date.parse(occurrence.startsAt) === occurrenceMs);
			if (!isOccurrence) return { error: notFound('occurrence_not_found') };

			const recurrence = withExcludedOccurrence(root.recurrence, body.occurrenceStartsAt);
			if (!recurrence) return { error: conflict('occurrence_changed') };
			const [updated] = await tx
				.update(wgEvents)
				.set({ recurrence, updatedAt: new Date() })
				.where(eq(wgEvents.id, id))
				.returning();
			if (!updated) throw new TransactionAbort('update_failed');

			if (body.action === 'cancel') return { updated, created: null };
			const [created] = await tx
				.insert(wgEvents)
				.values({
					wgId,
					title: body.title,
					description: body.description ?? null,
					startsAt: new Date(body.startsAt),
					endsAt: body.endsAt ? new Date(body.endsAt) : null,
					allDay: body.allDay,
					location: body.location ?? null,
					recurrence: null,
					createdByMemberId: root.createdByMemberId,
				})
				.returning();
			if (!created) throw new TransactionAbort('insert_failed');
			return { updated, created };
		});
		if ('error' in outcome) return outcome.error;
		await recordAuditEvent({
			wgId,
			memberId: auth.member.memberId,
			eventType: 'event.updated',
			entityType: 'wg_event',
			entityId: id,
			summary:
				body.action === 'cancel'
					? `${auth.member.name} hat einen Termin der Serie „${outcome.updated.title}“ entfernt.`
					: `${auth.member.name} hat einen Termin der Serie „${outcome.updated.title}“ geändert.`,
			metadata: { occurrenceStartsAt: body.occurrenceStartsAt, action: body.action },
		});
		return NextResponse.json({
			event: serializeWgEvent(outcome.updated),
			created: outcome.created ? serializeWgEvent(outcome.created) : null,
		});
	} catch (err) {
		if (err instanceof TransactionAbort) return badRequest(err.code);
		throw err;
	}
});
