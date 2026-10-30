import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { recordAuditEvent } from '@/core/audit';
import { announcementComments, announcements, wgMembers } from '@/core/db';
import { type DbTransaction, withTransaction } from '@/core/db/transaction';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import {
	badRequest,
	forbidden,
	notFound,
	rateLimitResponse,
	unauthorized,
} from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { COMMENT_MAX } from '@/features/announcements/constants';

const commentSchema = z.object({
	content: z.string().trim().min(1).max(COMMENT_MAX),
});

async function assertCommentOwner(
	tx: DbTransaction,
	wgId: string,
	announcementId: string,
	commentId: string,
	memberId: string,
	role: string,
	allowAdmin = false,
): Promise<{ status: 'ok'; moderated: boolean } | { status: 'not_found' | 'forbidden' }> {
	const rows = await tx
		.select({
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
		.limit(1)
		.for('update', { of: announcementComments });
	const row = rows[0];
	if (!row) return { status: 'not_found' };
	if (row.memberId === memberId) return { status: 'ok', moderated: false };
	// Editing stays with the author; only removal may be moderated by the WG admin.
	if (allowAdmin && role === 'admin') {
		return { status: 'ok', moderated: true };
	}
	return { status: 'forbidden' };
}

export const PATCH = withWgRoute<{ id: string; commentId: string }>(
	'announcement comment PATCH',
	async (req, { code, id, commentId }) => {
		if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(commentId)) return badRequest('id_invalid');

		const parsed = await parseBody(req, commentSchema, { invalid: 'comment_invalid' });
		if (!parsed.ok) return parsed.response;
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;
		const limited = rateLimitResponse(
			await checkRateLimit(wgWriteLimiter, `comment-edit:${wgId}:${auth.member.memberId}`),
		);
		if (limited) return limited;

		const outcome = await withTransaction(async (tx) => {
			const [caller] = await tx
				.select({ deactivatedAt: wgMembers.deactivatedAt, role: wgMembers.role })
				.from(wgMembers)
				.where(and(eq(wgMembers.id, auth.member.memberId), eq(wgMembers.wgId, wgId)))
				.limit(1)
				.for('share');
			if (!caller || caller.deactivatedAt) {
				return { response: unauthorized('member_deactivated') };
			}
			const owner = await assertCommentOwner(
				tx,
				wgId,
				id,
				commentId,
				auth.member.memberId,
				caller.role,
			);
			if (owner.status !== 'ok') {
				return {
					response:
						owner.status === 'not_found'
							? notFound('comment_not_found')
							: forbidden('not_owner', 'not_owner'),
				};
			}
			const [comment] = await tx
				.update(announcementComments)
				.set({ content: parsed.data.content })
				.where(
					and(eq(announcementComments.id, commentId), eq(announcementComments.announcementId, id)),
				)
				.returning();
			return comment ? { comment } : { response: notFound('comment_not_found') };
		});
		if ('response' in outcome) return outcome.response;
		const { comment } = outcome;
		await recordAuditEvent({
			wgId,
			memberId: auth.member.memberId,
			eventType: 'announcement.comment.updated',
			entityType: 'announcement_comment',
			entityId: comment.id,
			actorName: auth.member.name,
			metadata: { announcementId: id },
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
		const limited = rateLimitResponse(
			await checkRateLimit(wgWriteLimiter, `comment-delete:${wgId}:${auth.member.memberId}`),
		);
		if (limited) return limited;

		const outcome = await withTransaction(async (tx) => {
			const [caller] = await tx
				.select({ deactivatedAt: wgMembers.deactivatedAt, role: wgMembers.role })
				.from(wgMembers)
				.where(and(eq(wgMembers.id, auth.member.memberId), eq(wgMembers.wgId, wgId)))
				.limit(1)
				.for('share');
			if (!caller || caller.deactivatedAt) {
				return { response: unauthorized('member_deactivated') };
			}
			const owner = await assertCommentOwner(
				tx,
				wgId,
				id,
				commentId,
				auth.member.memberId,
				caller.role,
				true,
			);
			if (owner.status !== 'ok') {
				return {
					response:
						owner.status === 'not_found'
							? notFound('comment_not_found')
							: forbidden('not_owner', 'not_owner'),
				};
			}
			const [deleted] = await tx
				.delete(announcementComments)
				.where(
					and(eq(announcementComments.id, commentId), eq(announcementComments.announcementId, id)),
				)
				.returning({ id: announcementComments.id });
			return deleted ? { owner } : { response: notFound('comment_not_found') };
		});
		if ('response' in outcome) return outcome.response;
		const { owner } = outcome;
		await recordAuditEvent({
			wgId,
			memberId: auth.member.memberId,
			eventType: 'announcement.comment.deleted',
			entityType: 'announcement_comment',
			entityId: commentId,
			actorName: auth.member.name,
			metadata: {
				announcementId: id,
				moderated: owner.moderated,
			},
		});
		return NextResponse.json({ deleted: true });
	},
);
