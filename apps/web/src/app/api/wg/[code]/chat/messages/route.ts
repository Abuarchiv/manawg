import { recordAuditEvent } from '@/core/audit';
import { db, wgChatMentions, wgChatMessages, wgChatReactions, wgMembers } from '@/core/db';
import { serverError, tooMany } from '@/core/errors';
import { badRequest, payloadTooLarge } from '@/core/errors';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { withIdempotentJsonResponse } from '@/core/guards/idempotency';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { readJsonBody } from '@/core/http/read-json';
import { readListLimit } from '@/core/infra/env';
import { dispatchNotificationSafely } from '@/core/notifications/notification-dispatch';
import { chatMessageLimiter, checkRateLimit } from '@/core/rate-limit';
import { imageUrlSchema, isAllowedImageUrlForWg } from '@/core/validators/image-url';
import {
	filterPersistedMentionIds,
	previewBody,
	sanitizeMessageBody,
} from '@/features/chat/chat-pure';
import { and, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

// Operator-tunable via CHAT_MESSAGES_* (see .env.example). Every value runs
// through readListLimit, so an empty, unparsable or out-of-range setting falls
// back to / clamps to a working limit instead of disabling the bound.
// The body ceiling stays well under the route's 64 KiB raw-body cap, and the
// page ceiling matches the members listing, so neither knob can degenerate
// into an unbounded read or a whole-request payload.
const BODY_MAX = readListLimit(process.env, 'CHAT_MESSAGES_BODY_MAX', 4000, 10_000);
const PAGE_MAX = readListLimit(process.env, 'CHAT_MESSAGES_PAGE_MAX', 100, 500);
const PAGE_DEFAULT = readListLimit(process.env, 'CHAT_MESSAGES_PAGE_DEFAULT', 50, PAGE_MAX);
const PREVIEW_LENGTH = 120;
const MENTIONS_MAX = 20;

const createMessageSchema = z
	.object({
		body: z.string().max(BODY_MAX).optional(),
		imageUrl: imageUrlSchema,
		replyToMessageId: z.string().uuid().optional().nullable(),
		mentionMemberIds: z.array(z.string().uuid()).max(MENTIONS_MAX).optional(),
	})
	.refine(
		(value) =>
			(typeof value.body === 'string' && value.body.trim().length > 0) ||
			(typeof value.imageUrl === 'string' && value.imageUrl.length > 0),
		{ message: 'empty_message' },
	);

export const GET = withWgRoute('chat messages GET', async (req, { code }) => {
	const url = new URL(req.url);
	const beforeRaw = url.searchParams.get('before');
	const beforeId = url.searchParams.get('beforeId');
	const limitRaw = url.searchParams.get('limit');
	const limit = Math.min(
		PAGE_MAX,
		Math.max(1, Number.parseInt(limitRaw ?? `${PAGE_DEFAULT}`, 10) || PAGE_DEFAULT),
	);
	const before = beforeRaw ? new Date(beforeRaw) : null;
	if (before && Number.isNaN(before.getTime())) return badRequest('before_invalid');
	if (beforeId && !UUID_PATTERN.test(beforeId)) return badRequest('before_id_invalid');
	// Pagination cursor must be complete: beforeId without before (or vice
	// versa) would either silently fall back to the latest page or lose rows
	// on createdAt ties.
	if (!!before !== !!beforeId) return badRequest('before_cursor_incomplete');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;

	const where = before
		? and(
				eq(wgChatMessages.wgId, wg.id),
				isNull(wgChatMessages.deletedAt),
				beforeId
					? or(
							lt(wgChatMessages.createdAt, before),
							and(eq(wgChatMessages.createdAt, before), lt(wgChatMessages.id, beforeId)),
						)
					: lt(wgChatMessages.createdAt, before),
			)
		: and(eq(wgChatMessages.wgId, wg.id), isNull(wgChatMessages.deletedAt));

	const rows = await db
		.select()
		.from(wgChatMessages)
		.where(where)
		.orderBy(desc(wgChatMessages.createdAt), desc(wgChatMessages.id))
		.limit(limit);

	if (rows.length === 0) {
		return NextResponse.json({ messages: [], reactions: [], mentions: [] });
	}

	const ids = rows.map((row) => row.id);
	const [reactionRows, mentionRows] = await Promise.all([
		db
			.select({
				messageId: wgChatReactions.messageId,
				memberId: wgChatReactions.memberId,
				emoji: wgChatReactions.emoji,
				memberName: wgMembers.name,
				memberColor: wgMembers.color,
			})
			.from(wgChatReactions)
			.innerJoin(wgMembers, eq(wgChatReactions.memberId, wgMembers.id))
			.where(inArray(wgChatReactions.messageId, ids)),
		db
			.select({
				messageId: wgChatMentions.messageId,
				mentionedMemberId: wgChatMentions.mentionedMemberId,
			})
			.from(wgChatMentions)
			.where(inArray(wgChatMentions.messageId, ids)),
	]);

	const messages = rows
		.map((row) => ({
			...row,
			body: row.deletedAt ? null : row.body,
			imageUrl: row.deletedAt ? null : row.imageUrl,
		}))
		.reverse();

	return NextResponse.json({
		messages,
		reactions: reactionRows,
		mentions: mentionRows,
	});
});

export const POST = withWgRoute('chat messages POST', async (req, { code }) => {
	const rawResult = await readJsonBody(req, 64 * 1024);
	if (!rawResult.ok)
		return rawResult.reason === 'payload_too_large'
			? payloadTooLarge()
			: badRequest('invalid_json');
	const raw = rawResult.body;

	const parsed = createMessageSchema.safeParse(raw);
	if (!parsed.success) {
		const { formErrors, fieldErrors } = parsed.error.flatten();
		if (formErrors.includes('empty_message')) return badRequest('empty_message');
		if (fieldErrors.imageUrl) return badRequest('image_invalid');
		if (fieldErrors.replyToMessageId) return badRequest('reply_to_invalid');
		if (fieldErrors.mentionMemberIds) return badRequest('mentions_invalid');
		return badRequest('body_invalid');
	}

	const cleanBody = sanitizeMessageBody(parsed.data.body ?? null, BODY_MAX);
	const imageUrl =
		typeof parsed.data.imageUrl === 'string' && parsed.data.imageUrl.length > 0
			? parsed.data.imageUrl
			: null;
	const kind = imageUrl ? 'image' : 'text';
	const replyToMessageId = parsed.data.replyToMessageId ?? null;
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;
	if (!isAllowedImageUrlForWg(imageUrl, wg.id)) return badRequest('image_invalid');

	return withIdempotentJsonResponse(
		req,
		`chat-message:${wg.id}:${auth.member.memberId}`,
		async () => {
			const limited = await checkRateLimit(
				chatMessageLimiter,
				`chat:${wg.id}:${auth.member.memberId}`,
			);
			if (!limited.success) return tooMany();

			if (replyToMessageId) {
				if (!UUID_PATTERN.test(replyToMessageId)) return badRequest('reply_to_invalid');
				const replyRow = await db
					.select({ id: wgChatMessages.id })
					.from(wgChatMessages)
					.where(
						and(
							eq(wgChatMessages.id, replyToMessageId),
							eq(wgChatMessages.wgId, wg.id),
							isNull(wgChatMessages.deletedAt),
						),
					)
					.limit(1);
				if (replyRow.length === 0) return badRequest('reply_to_not_found');
			}

			const requestedMentionIds = Array.from(
				new Set((parsed.data.mentionMemberIds ?? []).filter((id) => UUID_PATTERN.test(id))),
			);
			let validMentionIds: string[] = [];
			if (requestedMentionIds.length > 0) {
				const validRows = await db
					.select({ id: wgMembers.id })
					.from(wgMembers)
					.where(and(eq(wgMembers.wgId, wg.id), inArray(wgMembers.id, requestedMentionIds)));
				validMentionIds = validRows
					.map((row) => row.id)
					.filter((id) => id !== auth.member.memberId);
			}

			const [inserted] = await db
				.insert(wgChatMessages)
				.values({
					wgId: wg.id,
					senderMemberId: auth.member.memberId,
					kind,
					body: cleanBody,
					imageUrl,
					replyToMessageId,
				})
				.returning();
			if (!inserted) return serverError('insert_failed');

			let persistedMentionIds: string[] = [];
			if (validMentionIds.length > 0) {
				const insertedMentionRows = await db
					.insert(wgChatMentions)
					.values(
						validMentionIds.map((mentionedMemberId) => ({
							messageId: inserted.id,
							mentionedMemberId,
						})),
					)
					.onConflictDoNothing()
					.returning({ mentionedMemberId: wgChatMentions.mentionedMemberId });
				persistedMentionIds = filterPersistedMentionIds(validMentionIds, insertedMentionRows);
			}

			const preview = previewBody(cleanBody ?? (imageUrl ? 'Bild' : ''), PREVIEW_LENGTH);

			const notificationDispatches = [
				dispatchNotificationSafely({
					wg,
					event: 'chat.message',
					payload: {
						messageId: inserted.id,
						actorName: auth.member.name,
						preview,
					},
					excludeMemberId: auth.member.memberId,
				}),
			];
			if (persistedMentionIds.length > 0) {
				notificationDispatches.push(
					dispatchNotificationSafely({
						wg,
						event: 'chat.mention',
						payload: {
							messageId: inserted.id,
							actorName: auth.member.name,
							preview,
						},
						targetMemberIds: persistedMentionIds,
						excludeMemberId: auth.member.memberId,
					}),
				);
			}

			// Audit log for traceability — kept lightweight (no full body, only preview).
			void recordAuditEvent({
				wgId: wg.id,
				memberId: auth.member.memberId,
				eventType: 'chat.message.created',
				entityType: 'chat_message',
				entityId: inserted.id,
				summary: `${auth.member.name} hat im Chat eine Nachricht gesendet.`,
				metadata: { preview, kind, mentions: persistedMentionIds.length },
			}).catch(() => undefined);

			const notificationResults = await Promise.all(notificationDispatches);
			const warning = notificationResults.some(
				(result) => result.warning === 'notification_delivery_unknown',
			)
				? 'notification_delivery_unknown'
				: notificationResults.some((result) => result.warning === 'notification_delivery_failed')
					? 'notification_delivery_failed'
					: null;

			return NextResponse.json({ message: inserted, mentions: persistedMentionIds, warning });
		},
	);
});
