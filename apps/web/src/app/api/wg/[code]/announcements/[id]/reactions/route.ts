import { recordAuditEvent } from '@/core/audit';
import { announcementReactions, db } from '@/core/db';
import { badRequest, notFound, tooMany } from '@/core/errors';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { withIdempotentJsonResponse } from '@/core/guards/idempotency';
import {
	type NotificationDispatchWarning,
	dispatchNotificationSafely,
} from '@/core/notifications/notification-dispatch';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { findWgAnnouncement } from '@/features/pinnwand/announcement-lookup';
import { ANNOUNCEMENT_REACTIONS } from '@/features/pinnwand/announcement-workflow';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const reactionSchema = z.object({
	reaction: z.enum(ANNOUNCEMENT_REACTIONS),
	// New clients send the desired state so a lost response can be retried
	// safely. Omitting it preserves the legacy toggle contract.
	active: z.boolean().optional(),
});

export const POST = withWgRoute<{ id: string }>(
	'announcement reaction POST',
	async (req, { code, id }) => {
		if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');

		let raw: unknown;
		try {
			raw = await req.json();
		} catch {
			return badRequest('invalid_json');
		}
		const parsed = reactionSchema.safeParse(raw);
		if (!parsed.success) return badRequest('reaction_invalid');
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wg = auth.wg;
		return withIdempotentJsonResponse(
			req,
			`announcement-reaction:${wg.id}:${auth.member.memberId}:${id}:${parsed.data.reaction}`,
			async () => {
				const limited = await checkRateLimit(
					wgWriteLimiter,
					`reaction:${wg.id}:${auth.member.memberId}`,
				);
				if (!limited.success) return tooMany();

		const announcement = await findWgAnnouncement(wg.id, id);
		if (!announcement) return notFound('announcement_not_found');

		const existingReaction = await db
			.select({ id: announcementReactions.id })
			.from(announcementReactions)
			.where(
				and(
					eq(announcementReactions.announcementId, id),
					eq(announcementReactions.memberId, auth.member.memberId),
					eq(announcementReactions.reaction, parsed.data.reaction),
				),
			)
			.limit(1);
		const wantActive = parsed.data.active ?? !existingReaction[0];
		if (wantActive && parsed.data.reaction === 'take' && announcement.status === 'resolved') {
			return badRequest('reaction_invalid');
		}

		if (!wantActive) {
			const [deleted] = await db
				.delete(announcementReactions)
				.where(
					and(
						eq(announcementReactions.announcementId, id),
						eq(announcementReactions.memberId, auth.member.memberId),
						eq(announcementReactions.reaction, parsed.data.reaction),
					),
				)
				.returning({ id: announcementReactions.id });
			if (!deleted)
				return NextResponse.json({ reaction: parsed.data.reaction, active: false, warning: null });
			await recordAuditEvent({
				wgId: wg.id,
				memberId: auth.member.memberId,
				eventType: 'announcement.reaction.removed',
				entityType: 'announcement_reaction',
				entityId: deleted.id,
				summary: `${auth.member.name} hat eine Reaktion entfernt.`,
				metadata: { announcementId: id, reaction: parsed.data.reaction },
			});
			return NextResponse.json({ reaction: parsed.data.reaction, active: false, warning: null });
		}

		const [reaction] = await db
			.insert(announcementReactions)
			.values({
				announcementId: id,
				memberId: auth.member.memberId,
				reaction: parsed.data.reaction,
			})
			.onConflictDoNothing()
			.returning({ id: announcementReactions.id });
		if (!reaction) {
			return NextResponse.json({ reaction: parsed.data.reaction, active: true, warning: null });
		}
		await recordAuditEvent({
			wgId: wg.id,
			memberId: auth.member.memberId,
			eventType: 'announcement.reaction.added',
			entityType: 'announcement_reaction',
			entityId: reaction?.id ?? id,
			summary: `${auth.member.name} hat mit ${parsed.data.reaction} reagiert.`,
			metadata: { announcementId: id, reaction: parsed.data.reaction },
		});
		let warning: NotificationDispatchWarning = null;
		if (announcement.authorMemberId !== auth.member.memberId) {
			const delivery = await dispatchNotificationSafely({
				wg,
				event: 'announcement.reacted',
				payload: {
					announcementId: id,
					title: announcement.content.slice(0, 120),
					actorName: auth.member.name,
				},
				targetMemberIds: [announcement.authorMemberId],
				excludeMemberId: auth.member.memberId,
			});
			warning = delivery.warning;
		}
			return NextResponse.json({ reaction: parsed.data.reaction, active: true, warning });
			},
		);
	},
);
