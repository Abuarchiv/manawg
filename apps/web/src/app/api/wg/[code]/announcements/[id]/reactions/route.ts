import { recordAuditEvent } from '@/core/audit';
import { announcementReactions, db } from '@/core/db';
import { badRequest, notFound, tooMany } from '@/core/errors';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { dispatchNotification } from '@/core/notifications/notification-dispatch';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { ANNOUNCEMENT_REACTIONS } from '@/lib/announcement-workflow';
import { findWgAnnouncement } from '@/lib/wg/announcement-lookup';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const reactionSchema = z.object({
	reaction: z.enum(ANNOUNCEMENT_REACTIONS),
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

		if (existingReaction[0]) {
			const [deleted] = await db
				.delete(announcementReactions)
				.where(eq(announcementReactions.id, existingReaction[0].id))
				.returning({ id: announcementReactions.id });
			if (!deleted) return notFound('reaction_not_found');
			await recordAuditEvent({
				wgId: wg.id,
				memberId: auth.member.memberId,
				eventType: 'announcement.reaction.removed',
				entityType: 'announcement_reaction',
				entityId: existingReaction[0].id,
				summary: `${auth.member.name} hat eine Reaktion entfernt.`,
				metadata: { announcementId: id, reaction: parsed.data.reaction },
			});
			return NextResponse.json({ reaction: parsed.data.reaction, active: false });
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
			return NextResponse.json({ reaction: parsed.data.reaction, active: true });
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
		if (announcement.authorMemberId !== auth.member.memberId) {
			void dispatchNotification({
				wg,
				event: 'announcement.reacted',
				payload: {
					announcementId: id,
					title: announcement.content.slice(0, 120),
					actorName: auth.member.name,
				},
				targetMemberIds: [announcement.authorMemberId],
				excludeMemberId: auth.member.memberId,
			}).catch((err) => console.error('[announcement reaction POST] notification failed', err));
		}
		return NextResponse.json({ reaction: parsed.data.reaction, active: true });
	},
);
