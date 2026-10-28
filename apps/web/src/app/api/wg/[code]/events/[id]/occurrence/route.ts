import { auditValues } from '@/core/audit-values';
import { auditEvents, wgEvents, wgMembers } from '@/core/db';
import { rejectWrite, responseCodec, withIdempotentWrite } from '@/core/db/idempotent-write';
import { TransactionAbort } from '@/core/db/transaction';
import { requireOwnerOrAdmin } from '@/core/guards/admin';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import {
	badRequest,
	conflict,
	notFound,
	serverError,
	tooMany,
	unauthorized,
} from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { readIdempotencyKey } from '@/core/idempotency-store';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import {
	MAX_EXDATES,
	parseRecurrenceRule,
	withExcludedOccurrence,
} from '@/features/events/event-recurrence-rule';
import {
	eventDateTimeSchema,
	eventDescriptionSchema,
	eventLocationSchema,
	eventTitleSchema,
} from '@/features/events/event-schemas';
import { expandRecurrence, serializeWgEvent } from '@/features/events/events';
import { notifyOccurrenceChange } from '@/features/events/server/event-change-notification';
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

	try {
		// A retry with the same key replays the first answer, so a lost response never turns the
		// saved change into an "occurrence not found" on the second attempt.
		const result = await withIdempotentWrite(
			{
				scope: `event-occurrence:${wgId}:${auth.member.memberId}:${id}`,
				key: readIdempotencyKey(req),
				codec: responseCodec(),
				// The answer carries the series rule and, for a detach, the new event: up to two
				// rules of EVENT_RECURRENCE_MAX characters. The default replay budget would be too small.
				maxStoredBytes: 256 * 1024,
				prepare: async () => {
					const limit = await checkRateLimit(
						wgWriteLimiter,
						`events:item:${wgId}:${auth.member.memberId}`,
					);
					return limit.success ? { input: undefined } : { stop: tooMany('rate_limited') };
				},
			},
			async (tx) => {
				const [root] = await tx
					.select()
					.from(wgEvents)
					.where(and(eq(wgEvents.id, id), eq(wgEvents.wgId, wgId)))
					.limit(1)
					.for('update');
				if (!root) return rejectWrite(notFound('event_not_found'));
				// The member resolved before the transaction may have moved out since.
				const [caller] = await tx
					.select({ deactivatedAt: wgMembers.deactivatedAt })
					.from(wgMembers)
					.where(and(eq(wgMembers.id, auth.member.memberId), eq(wgMembers.wgId, wgId)))
					.limit(1)
					// A shared lock until commit: moving the member out waits for this write.
					.for('share');
				if (!caller || caller.deactivatedAt) {
					return rejectWrite(unauthorized('member_deactivated'));
				}
				const denied = await requireOwnerOrAdmin(wgId, auth.member, root.createdByMemberId);
				if (denied) return rejectWrite(denied);
				if (!root.recurrence) return rejectWrite(badRequest('not_recurring'));
				// The values come from a form opened on an older version of the series.
				if (
					body.action === 'detach' &&
					body.expectedUpdatedAt &&
					root.updatedAt.getTime() !== new Date(body.expectedUpdatedAt).getTime()
				) {
					return rejectWrite(conflict('event_changed'));
				}

				// Only a real occurrence of the series can be changed, not an arbitrary instant.
				const occurrenceMs = Date.parse(body.occurrenceStartsAt);
				const isOccurrence = expandRecurrence(
					{ ...serializeWgEvent(root), recurrence: root.recurrence },
					new Date(occurrenceMs),
					new Date(occurrenceMs),
				).some((occurrence) => Date.parse(occurrence.startsAt) === occurrenceMs);
				if (!isOccurrence) return rejectWrite(notFound('occurrence_not_found'));

				if ((parseRecurrenceRule(root.recurrence)?.exdates?.length ?? 0) >= MAX_EXDATES) {
					return rejectWrite(conflict('exception_limit_reached'));
				}
				const recurrence = withExcludedOccurrence(root.recurrence, body.occurrenceStartsAt);
				if (!recurrence) return rejectWrite(conflict('occurrence_changed'));
				const [updated] = await tx
					.update(wgEvents)
					.set({ recurrence, updatedAt: new Date() })
					.where(eq(wgEvents.id, id))
					.returning();
				if (!updated) throw new TransactionAbort('update_failed');

				let created: typeof updated | null = null;
				if (body.action === 'detach') {
					[created = null] = await tx
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
				}
				// Written with the change, so a replayed request never finds a change without its audit entry.
				await tx.insert(auditEvents).values(
					auditValues({
						wgId,
						memberId: auth.member.memberId,
						eventType: 'event.updated',
						entityType: 'wg_event',
						entityId: id,
						actorName: auth.member.name,
						metadata: {
							title: updated.title,
							occurrenceStartsAt: body.occurrenceStartsAt,
							action: body.action,
						},
					}),
				);
				return {
					status: 200,
					body: {
						event: serializeWgEvent(updated),
						created: created ? serializeWgEvent(created) : null,
					},
				};
			},
		);
		if (result.kind === 'stopped') return result.response;
		if (result.kind === 'replayed') {
			return NextResponse.json(result.body, { status: result.status });
		}
		if (result.context && 'rejected' in result.context) return result.context.rejected;
		notifyOccurrenceChange({
			body,
			result: result.body,
			eventId: id,
			wg: { id: wgId, name: auth.wg.name, shareCode: code },
			actor: auth.member,
		});
		return NextResponse.json(result.body, { status: result.status });
	} catch (err) {
		if (err instanceof TransactionAbort) return serverError(err.code);
		throw err;
	}
});
