import { recordAuditEvent } from '@/core/audit';
import {
	announcementComments,
	announcementReactions,
	announcements,
	db,
	wgMembers,
} from '@/core/db';
import { badRequest, notFound, serverError, tooMany } from '@/core/errors';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { dispatchNotification } from '@/core/notifications/notification-dispatch';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { findWgAnnouncement } from '@/lib/wg/announcement-lookup';
import { and, asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const COMMENT_MAX = 600;
const COMMENTS_LIST_LIMIT = 500;

const commentSchema = z.object({
	content: z.string().trim().min(1).max(COMMENT_MAX),
});

export const GET = withWgRoute<{ id: string }>(
	'announcement comments GET',
	async (req, { code, id }) => {
		if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;

		const existingAnnouncement = await db
			.select({ id: announcements.id })
			.from(announcements)
			.where(and(eq(announcements.id, id), eq(announcements.wgId, wgId)))
			.limit(1);
		if (!existingAnnouncement[0]) return notFound('announcement_not_found');

		const comments = await db
			.select({
				id: announcementComments.id,
				announcementId: announcementComments.announcementId,
				memberId: announcementComments.memberId,
				content: announcementComments.content,
				createdAt: announcementComments.createdAt,
				authorName: wgMembers.name,
				authorColor: wgMembers.color,
			})
			.from(announcementComments)
			.innerJoin(wgMembers, eq(announcementComments.memberId, wgMembers.id))
			.where(eq(announcementComments.announcementId, id))
			.orderBy(asc(announcementComments.createdAt))
			.limit(COMMENTS_LIST_LIMIT);

		return NextResponse.json({ comments });
	},
	{
		fixture: () => {
			return NextResponse.json({ comments: [] });
		},
	},
);

export const POST = withWgRoute<{ id: string }>(
	'announcement comments POST',
	async (req, { code, id }) => {
		if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');

		let raw: unknown;
		try {
			raw = await req.json();
		} catch {
			return badRequest('invalid_json');
		}
		const parsed = commentSchema.safeParse(raw);
		if (!parsed.success) return badRequest('comment_invalid');
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wg = auth.wg;
		const limited = await checkRateLimit(
			wgWriteLimiter,
			`comment:${wg.id}:${auth.member.memberId}`,
		);
		if (!limited.success) return tooMany();

		const announcement = await findWgAnnouncement(wg.id, id);
		if (!announcement) return notFound('announcement_not_found');

		const [comment] = await db
			.insert(announcementComments)
			.values({
				announcementId: id,
				memberId: auth.member.memberId,
				content: parsed.data.content,
			})
			.returning();
		if (!comment) return serverError('insert_failed');
		await recordAuditEvent({
			wgId: wg.id,
			memberId: auth.member.memberId,
			eventType: 'announcement.comment.created',
			entityType: 'announcement_comment',
			entityId: comment.id,
			summary: `${auth.member.name} hat einen Kommentar geschrieben.`,
			metadata: {
				announcementId: id,
				contentPreview: parsed.data.content.slice(0, 120),
			},
		});
		const takers = await db
			.select({ memberId: announcementReactions.memberId })
			.from(announcementReactions)
			.where(
				and(
					eq(announcementReactions.announcementId, id),
					eq(announcementReactions.reaction, 'take'),
				),
			);
		const targetMemberIds = Array.from(
			new Set([announcement.authorMemberId, ...takers.map((taker) => taker.memberId)]),
		);
		if (targetMemberIds.length > 0) {
			void dispatchNotification({
				wg,
				event: 'announcement.commented',
				payload: {
					announcementId: id,
					title: parsed.data.content.slice(0, 120),
					actorName: auth.member.name,
				},
				targetMemberIds,
				excludeMemberId: auth.member.memberId,
			}).catch((err) => console.error('[announcement comments POST] notification failed', err));
		}

		return NextResponse.json({
			comment: {
				...comment,
				authorName: auth.member.name,
				authorColor:
					'color' in auth.member && typeof auth.member.color === 'string'
						? auth.member.color
						: null,
			},
		});
	},
);
