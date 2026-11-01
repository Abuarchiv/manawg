import { and, eq, isNull, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { recordAuditEvent } from '@/core/audit';
import { db, idempotencyResponses, wgChatMessages } from '@/core/db';
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
	rateLimitResponse,
} from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { CHAT_BODY_MAX, canEditMessage, sanitizeMessageBody } from '@/features/chat/chat-pure';
import { replaceMessageMentions } from '@/features/chat/server/chat-mentions';

const patchSchema = z.object({
	body: z.string().min(1).max(CHAT_BODY_MAX),
});

export const PATCH = withWgRoute<{ id: string }>(
	'chat message PATCH',
	async (req, { code, id }) => {
		if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');

		const parsed = await parseBody(req, patchSchema, {
			invalid: 'body_invalid',
		});
		if (!parsed.ok) return parsed.response;
		const cleanBody = sanitizeMessageBody(parsed.data.body, CHAT_BODY_MAX);
		if (!cleanBody) return badRequest('body_invalid');
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;
		const limited = rateLimitResponse(
			await checkRateLimit(wgWriteLimiter, `chat-edit:${wgId}:${auth.member.memberId}`),
		);
		if (limited) return limited;

		const existing = await db
			.select()
			.from(wgChatMessages)
			.where(and(eq(wgChatMessages.id, id), eq(wgChatMessages.wgId, wgId)))
			.limit(1);
		const row = existing[0];
		if (!row) return notFound('message_not_found');

		if (!canEditMessage(row, { id: auth.member.memberId })) {
			return forbidden('edit_not_allowed', 'edit_not_allowed');
		}

		const now = new Date();
		// The mention rows follow the text in the same transaction, so an edit never keeps a
		// mention of someone the new text does not name.
		const updated = await withTransaction(async (tx) => {
			const [edited] = await tx
				.update(wgChatMessages)
				.set({ body: cleanBody, editedAt: now })
				// Author, kind and deletedAt guard against a DELETE that landed after the read above.
				.where(
					and(
						eq(wgChatMessages.id, id),
						eq(wgChatMessages.wgId, wgId),
						eq(wgChatMessages.senderMemberId, auth.member.memberId),
						eq(wgChatMessages.kind, 'text'),
						isNull(wgChatMessages.deletedAt),
					),
				)
				.returning();
			if (!edited) return null;
			await replaceMessageMentions(tx, {
				wgId,
				messageId: id,
				senderMemberId: auth.member.memberId,
				body: cleanBody,
			});
			return edited;
		});
		// Row, author and kind are fixed after the check, so no row means a parallel delete.
		if (!updated) return conflict('message_deleted', 'message_deleted');

		await recordAuditEvent({
			wgId,
			memberId: auth.member.memberId,
			eventType: 'chat.message.edited',
			entityType: 'chat_message',
			entityId: id,
			actorName: auth.member.name,
		});

		return NextResponse.json({ message: updated });
	},
);

export const DELETE = withWgRoute<{ id: string }>(
	'chat message DELETE',
	async (req, { code, id }) => {
		if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;
		const limited = rateLimitResponse(
			await checkRateLimit(wgWriteLimiter, `chat-delete:${wgId}:${auth.member.memberId}`),
		);
		if (limited) return limited;

		const deletion = await withTransaction(async (tx) => {
			await lockExpensePayments(tx, wgId);
			const [row] = await tx
				.select({
					senderMemberId: wgChatMessages.senderMemberId,
					deletedAt: wgChatMessages.deletedAt,
					kind: wgChatMessages.kind,
					imageUrl: wgChatMessages.imageUrl,
				})
				.from(wgChatMessages)
				.where(and(eq(wgChatMessages.id, id), eq(wgChatMessages.wgId, wgId)))
				.limit(1)
				.for('update');
			if (!row) return { ok: false as const, response: notFound('message_not_found') };
			if (row.deletedAt) return { ok: true as const, deleted: false as const, row };

			const isAuthor = row.senderMemberId === auth.member.memberId;
			const denied = await requireOwnerOrAdmin(wgId, auth.member, row.senderMemberId);
			if (denied) return { ok: false as const, response: denied };

			const [updated] = await tx
				.update(wgChatMessages)
				// Reads already hide a deleted message's text; erase it at rest too,
				// so "gelöscht" means deleted (GDPR Art. 17), not merely hidden.
				.set({ deletedAt: new Date(), body: null })
				.where(
					and(
						eq(wgChatMessages.id, id),
						eq(wgChatMessages.wgId, wgId),
						isNull(wgChatMessages.deletedAt),
					),
				)
				.returning({ id: wgChatMessages.id });
			if (!updated) return { ok: false as const, response: notFound('message_not_found') };
			// The author's stored send response still holds the text; blank it but keep the row,
			// so a late retry of the same key replays instead of posting the message again.
			await tx
				.update(idempotencyResponses)
				.set({
					responseBody: sql`jsonb_set(${idempotencyResponses.responseBody}, '{body,message,body}', 'null'::jsonb)`,
				})
				.where(
					and(
						eq(idempotencyResponses.scope, `chat-message:${wgId}:${row.senderMemberId}`),
						sql`${idempotencyResponses.responseBody} #>> '{body,message,id}' = ${id}`,
					),
				);
			await revokePrivateImageIfUnreferenced(tx, wgId, row.imageUrl);
			return { ok: true as const, deleted: true as const, row, isAuthor };
		});
		if (!deletion.ok) return deletion.response;
		if (!deletion.deleted) return NextResponse.json({ deleted: true });
		const { row, isAuthor } = deletion;

		await recordAuditEvent({
			wgId,
			memberId: auth.member.memberId,
			eventType: 'chat.message.deleted',
			entityType: 'chat_message',
			entityId: id,
			actorName: auth.member.name,
			metadata: {
				kind: row.kind,
				adminOverride: !isAuthor,
			},
		});

		return NextResponse.json({ deleted: true });
	},
);
