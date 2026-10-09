import { recordAuditEvent } from '@/core/audit';
import { announcementReactions, announcements, db, wgMembers } from '@/core/db';
import { revokePrivateImageIfUnreferenced } from '@/core/db/private-image-deletions';
import { lockExpensePayments, withTransaction } from '@/core/db/transaction';
import { requireOwnerOrAdmin } from '@/core/guards/admin';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import {
	badRequest,
	conflict,
	forbidden,
	notFound,
	tooMany,
	unauthorized,
} from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import {
	type NotificationDispatchWarning,
	dispatchNotificationSafely,
} from '@/core/notifications/notification-dispatch';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { ANNOUNCEMENT_KINDS } from '@/features/pinnwand/announcement-workflow';
import { and, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const patchAnnouncementSchema = z.object({
	status: z.enum(['open', 'resolved']).optional(),
	pinned: z.boolean().optional(),
	kind: z.enum(ANNOUNCEMENT_KINDS).optional(),
	content: z.string().trim().min(1).max(2000).optional(),
	// The version the edit dialog was opened on; a newer one means someone saved meanwhile.
	expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});

export const PATCH = withWgRoute<{ id: string }>(
	'announcement PATCH',
	async (req, { code, id }) => {
		if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');

		const parsed = await parseBody(req, patchAnnouncementSchema, {
			fieldErrors: {
				status: 'status_invalid',
				pinned: 'pinned_invalid',
				kind: 'kind_invalid',
				content: 'content_invalid',
				expectedUpdatedAt: 'expected_state_invalid',
			},
		});
		if (!parsed.ok) return parsed.response;
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wg = auth.wg;
		const limited = await checkRateLimit(
			wgWriteLimiter,
			`announcement-patch:${wg.id}:${auth.member.memberId}`,
		);
		if (!limited.success) return tooMany();

		const existing = await db
			.select({
				id: announcements.id,
				authorMemberId: announcements.authorMemberId,
				content: announcements.content,
				status: announcements.status,
				source: announcements.source,
			})
			.from(announcements)
			.where(and(eq(announcements.id, id), eq(announcements.wgId, wg.id)))
			.limit(1);
		const row = existing[0];
		if (!row) return notFound('announcement_not_found');
		// Posts generated from a chore or an expense carry system text; only manual posts are editable.
		if (parsed.data.content !== undefined && row.source !== 'manual') {
			return forbidden('content_locked', 'content_locked');
		}

		const changesModeratedFields =
			parsed.data.kind !== undefined ||
			parsed.data.pinned !== undefined ||
			parsed.data.content !== undefined;
		const isAuthor = row.authorMemberId === auth.member.memberId;
		if (changesModeratedFields) {
			const denied = await requireOwnerOrAdmin(wg.id, auth.member, row.authorMemberId);
			if (denied) return denied;
		}

		const now = new Date();
		const patch: {
			content?: string;
			kind?: string;
			pinnedAt?: Date | null;
			status?: string;
			resolvedAt?: Date | null;
			resolvedByMemberId?: string | null;
			updatedAt?: Date;
		} = {};
		patch.updatedAt = now;
		if (parsed.data.kind) patch.kind = parsed.data.kind;
		if (parsed.data.content !== undefined) patch.content = parsed.data.content;
		if (typeof parsed.data.pinned === 'boolean') {
			patch.pinnedAt = parsed.data.pinned ? now : null;
		}
		if (parsed.data.status) {
			const hasTaken = await db
				.select({ id: announcementReactions.id })
				.from(announcementReactions)
				.where(
					and(
						eq(announcementReactions.announcementId, id),
						eq(announcementReactions.memberId, auth.member.memberId),
						eq(announcementReactions.reaction, 'take'),
					),
				)
				.limit(1);
			if (!isAuthor && hasTaken.length === 0) {
				return forbidden('status_change_not_allowed', 'status_change_not_allowed');
			}
			patch.status = parsed.data.status;
			patch.resolvedAt = parsed.data.status === 'resolved' ? now : null;
			patch.resolvedByMemberId = parsed.data.status === 'resolved' ? auth.member.memberId : null;
		}

		// The caller is read again with the write: a member who moved out since the request began
		// cannot save, and moving out waits for this write.
		const outcome = await withTransaction(async (tx) => {
			const [caller] = await tx
				.select({ deactivatedAt: wgMembers.deactivatedAt, role: wgMembers.role })
				.from(wgMembers)
				.where(and(eq(wgMembers.id, auth.member.memberId), eq(wgMembers.wgId, wg.id)))
				.limit(1)
				.for('share');
			if (!caller || caller.deactivatedAt) return 'member_deactivated' as const;
			// The owner-or-admin decision is repeated with the role as it is now.
			if (changesModeratedFields && !isAuthor && caller.role !== 'admin') {
				return 'not_allowed' as const;
			}
			const [row] = await tx
				.update(announcements)
				.set(patch)
				.where(
					and(
						eq(announcements.id, id),
						eq(announcements.wgId, wg.id),
						parsed.data.content !== undefined && parsed.data.expectedUpdatedAt
							? sql`date_trunc('milliseconds', ${announcements.updatedAt}) = ${new Date(parsed.data.expectedUpdatedAt)}`
							: undefined,
					),
				)
				.returning();
			return row ?? null;
		});
		if (outcome === 'member_deactivated') return unauthorized('member_deactivated');
		if (outcome === 'not_allowed') return forbidden('not_owner', 'not_owner');
		const updated = outcome;
		if (!updated) {
			const [stillThere] = await db
				.select({ id: announcements.id })
				.from(announcements)
				.where(and(eq(announcements.id, id), eq(announcements.wgId, wg.id)))
				.limit(1);
			return stillThere ? conflict('announcement_changed') : notFound('announcement_not_found');
		}
		await recordAuditEvent({
			wgId: wg.id,
			memberId: auth.member.memberId,
			eventType: 'announcement.updated',
			entityType: 'announcement',
			entityId: updated.id,
			summary: `${auth.member.name} hat einen Pinnwand-Beitrag aktualisiert.`,
			metadata: {
				status: updated.status,
				kind: updated.kind,
				pinned: updated.pinnedAt !== null,
			},
		});
		let warning: NotificationDispatchWarning = null;
		// A repeated resolve (double tap, retry) must not push the same notice twice.
		if (parsed.data.status === 'resolved' && row.status !== 'resolved') {
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
				new Set([row.authorMemberId, ...takers.map((taker) => taker.memberId)]),
			);
			const delivery = await dispatchNotificationSafely({
				wg,
				event: 'announcement.resolved',
				payload: {
					announcementId: id,
					title: row.content.slice(0, 120),
					actorName: auth.member.name,
				},
				targetMemberIds,
				excludeMemberId: auth.member.memberId,
			});
			warning = delivery.warning;
		}
		return NextResponse.json({ announcement: updated, warning });
	},
);

export const DELETE = withWgRoute<{ id: string }>(
	'announcement DELETE',
	async (req, { code, id }) => {
		if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;
		const limited = await checkRateLimit(
			wgWriteLimiter,
			`announcement-delete:${wgId}:${auth.member.memberId}`,
		);
		if (!limited.success) return tooMany();

		// Author OR admin may delete an announcement. Authors own their own posts; the WG admin
		// can moderate stale or inappropriate content, e.g. posts of members who moved out.
		const deletion = await withTransaction(async (tx) => {
			await lockExpensePayments(tx, wgId);
			const [row] = await tx
				.select({
					authorMemberId: announcements.authorMemberId,
					content: announcements.content,
					imageUrl: announcements.imageUrl,
				})
				.from(announcements)
				.where(and(eq(announcements.id, id), eq(announcements.wgId, wgId)))
				.limit(1)
				.for('update');
			if (!row) return { ok: false as const, response: notFound('announcement_not_found') };
			const denied = await requireOwnerOrAdmin(wgId, auth.member, row.authorMemberId);
			if (denied) return { ok: false as const, response: denied };

			const deleted = await tx
				.delete(announcements)
				.where(and(eq(announcements.id, id), eq(announcements.wgId, wgId)))
				.returning({ id: announcements.id });
			if (deleted.length === 0) {
				return { ok: false as const, response: notFound('announcement_not_found') };
			}
			await revokePrivateImageIfUnreferenced(tx, wgId, row.imageUrl);
			return { ok: true as const, row };
		});
		if (!deletion.ok) return deletion.response;
		const { row } = deletion;
		await recordAuditEvent({
			wgId,
			memberId: auth.member.memberId,
			eventType: 'announcement.deleted',
			entityType: 'announcement',
			entityId: id,
			summary: `${auth.member.name} hat einen Pinnwand-Beitrag entfernt.`,
			metadata: { content: row.content.slice(0, 160) },
		});
		return NextResponse.json({ deleted: true });
	},
);
