import { recordAuditEvent } from '@/core/audit';
import { announcementComments, announcements, db } from '@/core/db';
import { badRequest, forbidden, notFound, requireVerifiedMember, tooMany } from '@/core/errors';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const commentSchema = z.object({
	content: z.string().trim().min(1).max(600),
});

async function assertCommentOwner(
	wgId: string,
	announcementId: string,
	commentId: string,
	memberId: string,
): Promise<{ status: 'ok'; content: string } | { status: 'not_found' | 'forbidden' }> {
	const rows = await db
		.select({
			content: announcementComments.content,
			memberId: announcementComments.memberId,
		})
		.from(announcementComments)
		.innerJoin(announcements, eq(announcementComments.announcementId, announcements.id))
		.where(
			and(
				eq(announcementComments.id, commentId),
				eq(announcementComments.announcementId, announcementId),
				eq(announcements.wgId, wgId),
			),
		)
		.limit(1);
	const row = rows[0];
	if (!row) return { status: 'not_found' };
	return row.memberId === memberId
		? { status: 'ok', content: row.content }
		: { status: 'forbidden' };
}

function auditCommentSnippet(content: string): string {
	return content.slice(0, 160);
}

export const PATCH = withWgRoute<{ id: string; commentId: string }>(
	'announcement comment PATCH',
	async (req, { code, id, commentId }) => {
		if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(commentId)) return badRequest('id_invalid');

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
		const wgId = auth.wg.id;
		// Owner check trusts the caller identity claimed by the spoofable
		// x-manawg-member-id header, so require a verified HMAC token before
		// trusting it (same pattern as expense mutations).
		const unverified = requireVerifiedMember(auth.member);
		if (unverified) return unverified;
		const limited = await checkRateLimit(
			wgWriteLimiter,
			`comment-edit:${wgId}:${auth.member.memberId}`,
		);
		if (!limited.success) return tooMany();

		const owner = await assertCommentOwner(wgId, id, commentId, auth.member.memberId);
		if (owner.status !== 'ok') {
			return owner.status === 'not_found'
				? notFound('comment_not_found')
				: forbidden('not_owner', 'not_owner');
		}

		const [comment] = await db
			.update(announcementComments)
			.set({ content: parsed.data.content })
			.where(eq(announcementComments.id, commentId))
			.returning();
		if (!comment) return notFound('comment_not_found');
		await recordAuditEvent({
			wgId,
			memberId: auth.member.memberId,
			eventType: 'announcement.comment.updated',
			entityType: 'announcement_comment',
			entityId: comment.id,
			summary: `${auth.member.name} hat einen Kommentar aktualisiert.`,
			metadata: {
				announcementId: id,
				contentBefore: auditCommentSnippet(owner.content),
				contentAfter: auditCommentSnippet(comment.content),
			},
		});
		return NextResponse.json({ comment });
	},
);

export const DELETE = withWgRoute<{ id: string; commentId: string }>(
	'announcement comment DELETE',
	async (req, { code, id, commentId }) => {
		if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(commentId)) return badRequest('id_invalid');
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;
		// Owner check trusts the caller identity claimed by the spoofable
		// x-manawg-member-id header, so require a verified HMAC token before
		// trusting it (same pattern as expense mutations).
		const unverified = requireVerifiedMember(auth.member);
		if (unverified) return unverified;
		const limited = await checkRateLimit(
			wgWriteLimiter,
			`comment-delete:${wgId}:${auth.member.memberId}`,
		);
		if (!limited.success) return tooMany();

		const owner = await assertCommentOwner(wgId, id, commentId, auth.member.memberId);
		if (owner.status !== 'ok') {
			return owner.status === 'not_found'
				? notFound('comment_not_found')
				: forbidden('not_owner', 'not_owner');
		}

		const [deleted] = await db
			.delete(announcementComments)
			.where(eq(announcementComments.id, commentId))
			.returning({ id: announcementComments.id });
		if (!deleted) return notFound('comment_not_found');
		await recordAuditEvent({
			wgId,
			memberId: auth.member.memberId,
			eventType: 'announcement.comment.deleted',
			entityType: 'announcement_comment',
			entityId: commentId,
			summary: `${auth.member.name} hat einen Kommentar entfernt.`,
			metadata: { announcementId: id, content: owner.content.slice(0, 160) },
		});
		return NextResponse.json({ deleted: true });
	},
);
