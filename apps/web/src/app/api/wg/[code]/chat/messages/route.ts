import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { recordAuditEvent } from '@/core/audit';
import {
	db,
	wgChatMentions,
	wgChatMessages,
	wgChatReactions,
	wgChatReads,
	wgMembers,
} from '@/core/db';
import { rejectWrite, responseCodec, withIdempotentWrite } from '@/core/db/idempotent-write';
import { type DbTransaction, lockExpensePayments, withTransaction } from '@/core/db/transaction';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { badRequest, HTTP, rateLimitedReplayResponse, unauthorized } from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { readIdempotencyKey, setReplayWarning } from '@/core/idempotency-store';
import { readListLimit } from '@/core/infra/env';
import { logApiError } from '@/core/infra/observability';
import { dispatchNotificationSafely } from '@/core/notifications/notification-dispatch';
import { chatMessageLimiter, checkRateLimit } from '@/core/rate-limit';
import {
	CHAT_BODY_MAX,
	CHAT_REFRESH_BATCH_SIZE,
	chatMessagesReadPayload,
	filterPersistedMentionIds,
	previewBody,
	sanitizeMessageBody,
} from '@/features/chat/chat-pure';
import { CHAT_PAGE_SIZE } from '@/features/chat/chat-refresh';
import { buildChatCursorWhere } from '@/features/chat/server/chat-unread-query';
import { loadOwnReadMarker } from '@/features/chat/server/own-read-marker';

// Operator-tunable via CHAT_MESSAGES_*. Every value runs through readListLimit,
// so an empty, unparsable or out-of-range setting falls back to / clamps to a
// working limit instead of disabling the bound. The page ceiling matches the
// members listing, so neither knob can degenerate into an unbounded read. The
// client pages by CHAT_PAGE_SIZE and treats a shorter page as the oldest one,
// so the ceiling never drops below it: a lower cap would hide older history.
const PAGE_MAX = Math.max(
	CHAT_PAGE_SIZE,
	readListLimit(process.env, 'CHAT_MESSAGES_PAGE_MAX', 100, 500),
);
const PAGE_DEFAULT = readListLimit(process.env, 'CHAT_MESSAGES_PAGE_DEFAULT', 50, PAGE_MAX);
const PREVIEW_LENGTH = 120;
const MENTIONS_MAX = 20;

// Rejected replies (400) replay as stored; a rate-limited or deactivated-sender send may retry the same key.
const chatMessageCodec = responseCodec();
const storeChatStatus = (status: number) =>
	status !== HTTP.TOO_MANY && status !== HTTP.SERVICE_UNAVAILABLE && status !== HTTP.UNAUTHORIZED;

// Text only: storage is limited, so new messages carry no pictures.
const createMessageSchema = z
	.object({
		body: z.string().max(CHAT_BODY_MAX).optional(),
		replyToMessageId: z.string().uuid().optional().nullable(),
		mentionMemberIds: z.array(z.string().uuid()).max(MENTIONS_MAX).optional(),
	})
	.refine((value) => typeof value.body === 'string' && value.body.trim().length > 0, {
		message: 'empty_message',
	});

export const GET = withWgRoute('chat messages GET', async (req, { code }) => {
	const url = new URL(req.url);
	const beforeRaw = url.searchParams.get('before');
	const beforeId = url.searchParams.get('beforeId');
	const refreshIdParams = url.searchParams.getAll('refreshId');
	const limitRaw = url.searchParams.get('limit');
	const limit = Math.min(
		PAGE_MAX,
		Math.max(1, Number.parseInt(limitRaw ?? `${PAGE_DEFAULT}`, 10) || PAGE_DEFAULT),
	);
	const before = beforeRaw ? new Date(beforeRaw) : null;
	if (before && Number.isNaN(before.getTime())) return badRequest('before_invalid');
	if (beforeId && !UUID_PATTERN.test(beforeId)) return badRequest('before_id_invalid');
	if (
		refreshIdParams.length > CHAT_REFRESH_BATCH_SIZE ||
		refreshIdParams.some((id) => !UUID_PATTERN.test(id))
	)
		return badRequest('refresh_ids_invalid');
	// Pagination cursor must be complete: beforeId without before (or vice
	// versa) would either silently fall back to the latest page or lose rows
	// on createdAt ties.
	if (!!before !== !!beforeId) return badRequest('before_cursor_incomplete');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;

	// Only the bootstrap asks for it (before it marks the chat read), so polls skip the query.
	const readMarkerPayload =
		url.searchParams.get('includeReadMarker') === '1'
			? { readMarker: await loadOwnReadMarker(wg.id, auth.member.memberId) }
			: {};

	const where = beforeId
		? and(
				eq(wgChatMessages.wgId, wg.id),
				buildChatCursorWhere(wgChatMessages, wg.id, beforeId, 'before'),
			)
		: eq(wgChatMessages.wgId, wg.id);

	// Read markers drive the read ticks; only the latest page (the poll) needs them.
	const [pageRows, reads] = await Promise.all([
		db
			.select()
			.from(wgChatMessages)
			.where(where)
			.orderBy(desc(wgChatMessages.createdAt), desc(wgChatMessages.id))
			.limit(limit),
		beforeId
			? []
			: db
					.select({ memberId: wgChatReads.memberId, lastReadAt: wgChatMessages.createdAt })
					.from(wgChatReads)
					.innerJoin(wgChatMessages, eq(wgChatMessages.id, wgChatReads.lastReadMessageId))
					.where(eq(wgChatReads.wgId, wg.id)),
	]);

	const pageIds = new Set(pageRows.map((row) => row.id));
	const refreshIds = [...new Set(refreshIdParams)].filter((id) => !pageIds.has(id));
	const refreshedRows =
		refreshIds.length > 0
			? await db
					.select()
					.from(wgChatMessages)
					.where(and(eq(wgChatMessages.wgId, wg.id), inArray(wgChatMessages.id, refreshIds)))
			: [];
	const rows = [...pageRows, ...refreshedRows];

	const liveMessageIds = rows.filter((row) => !row.deletedAt).map((row) => row.id);
	if (liveMessageIds.length === 0) {
		return NextResponse.json({
			...chatMessagesReadPayload(pageRows, refreshedRows),
			reads,
			...readMarkerPayload,
			reactions: [],
			mentions: [],
		});
	}
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
			.where(inArray(wgChatReactions.messageId, liveMessageIds)),
		db
			.select({
				messageId: wgChatMentions.messageId,
				mentionedMemberId: wgChatMentions.mentionedMemberId,
			})
			.from(wgChatMentions)
			.where(inArray(wgChatMentions.messageId, liveMessageIds)),
	]);

	return NextResponse.json({
		...chatMessagesReadPayload(pageRows, refreshedRows),
		reads,
		...readMarkerPayload,
		reactions: reactionRows,
		mentions: mentionRows,
	});
});

export const POST = withWgRoute('chat messages POST', async (req, { code }) => {
	const parsed = await parseBody(req, createMessageSchema, {
		maxBytes: 64 * 1024,
		formErrors: { empty_message: 'empty_message' },
		formErrorsFirst: true,
		fieldErrors: {
			replyToMessageId: 'reply_to_invalid',
			mentionMemberIds: 'mentions_invalid',
		},
		invalid: 'body_invalid',
	});
	if (!parsed.ok) return parsed.response;

	const cleanBody = sanitizeMessageBody(parsed.data.body ?? null, CHAT_BODY_MAX);
	if (parsed.data.body?.trim() && !cleanBody) {
		return badRequest('body_invalid');
	}
	const replyToMessageId = parsed.data.replyToMessageId ?? null;
	const requestedMentionIds = parsed.data.mentionMemberIds ?? [];
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;
	const member = auth.member;

	const key = readIdempotencyKey(req);
	const scope = `chat-message:${wg.id}:${member.memberId}`;
	const send = () =>
		withIdempotentWrite(
			{
				scope,
				key,
				codec: chatMessageCodec,
				storeStatus: storeChatStatus,
				inTransaction: (work) =>
					withTransaction(async (tx) => {
						// The per-WG write lock is shared with payments and WG deletion, so deletion waits for sends.
						await lockExpensePayments(tx, wg.id);
						return work(tx);
					}),
			},
			async (tx) => {
				// The member resolved before the transaction may have moved out since.
				const [sender] = await tx
					.select({ id: wgMembers.id })
					.from(wgMembers)
					.where(
						and(
							eq(wgMembers.id, member.memberId),
							eq(wgMembers.wgId, wg.id),
							isNull(wgMembers.deactivatedAt),
						),
					)
					.limit(1)
					// A shared lock until commit: moving the member out waits for this write.
					.for('share');
				if (!sender) return rejectWrite(unauthorized('member_deactivated'));
				// The rate limit runs under the claim, so only the request that sends counts.
				const limited = rateLimitedReplayResponse(
					await checkRateLimit(chatMessageLimiter, `chat:${wg.id}:${member.memberId}`),
				);
				if (limited) return limited;
				return insertMessage(tx, {
					wgId: wg.id,
					senderMemberId: member.memberId,
					body: cleanBody,
					replyToMessageId,
					requestedMentionIds,
				});
			},
		);
	const result = await send();
	if (result.kind === 'replayed' || !result.context) {
		return NextResponse.json(result.body, { status: result.status });
	}
	if ('rejected' in result.context) return result.context.rejected;
	const { created, mentionIds } = result.context;

	const preview = previewBody(cleanBody ?? '', PREVIEW_LENGTH);
	const notificationDispatches = [
		dispatchNotificationSafely({
			wg,
			event: 'chat.message',
			payload: { messageId: created.id, actorName: member.name, preview },
			excludeMemberId: member.memberId,
			// Mentioned members get only the targeted mention push, not the general one on top.
			excludeMemberIds: mentionIds,
		}),
	];
	if (mentionIds.length > 0) {
		notificationDispatches.push(
			dispatchNotificationSafely({
				wg,
				event: 'chat.mention',
				payload: { messageId: created.id, actorName: member.name, preview },
				targetMemberIds: mentionIds,
				excludeMemberId: member.memberId,
			}),
		);
	}
	await recordAuditEvent({
		wgId: wg.id,
		memberId: member.memberId,
		eventType: 'chat.message.created',
		entityType: 'chat_message',
		entityId: created.id,
		actorName: member.name,
		// No text preview: audit rows outlive message deletion, chat text must not.
		metadata: { kind: 'text', mentions: mentionIds.length },
	});

	const notificationResults = await Promise.all(notificationDispatches);
	let warning: 'notification_delivery_failed' | 'notification_delivery_unknown' | null =
		notificationResults.some((entry) => entry.warning === 'notification_delivery_unknown')
			? 'notification_delivery_unknown'
			: notificationResults.some((entry) => entry.warning === 'notification_delivery_failed')
				? 'notification_delivery_failed'
				: null;
	if (warning && key) {
		try {
			const target = {
				match: [{ path: ['body', 'message', 'id'], equals: created.id }],
				warningPath: ['body', 'warning'],
				replaces: [null, warning],
			};
			if (!(await setReplayWarning(scope, key, target, warning))) {
				logApiError(
					'[chat/messages] replay warning persistence failed',
					new Error('replay_row_missing'),
				);
				warning = null;
			}
		} catch (err) {
			logApiError('[chat/messages] replay warning persistence failed', err);
			warning = null;
		}
	}
	return NextResponse.json({ message: created, mentions: mentionIds, warning });
});

/** Insert the message and its mentions. A missing reply target answers 400 and is stored. */
async function insertMessage(
	tx: DbTransaction,
	input: {
		wgId: string;
		senderMemberId: string;
		body: string | null;
		replyToMessageId: string | null;
		requestedMentionIds: string[];
	},
) {
	if (input.replyToMessageId) {
		if (!UUID_PATTERN.test(input.replyToMessageId)) {
			return { status: HTTP.BAD_REQUEST, body: { error: 'reply_to_invalid' } };
		}
		const replyRow = await tx
			.select({ id: wgChatMessages.id })
			.from(wgChatMessages)
			.where(
				and(
					eq(wgChatMessages.id, input.replyToMessageId),
					eq(wgChatMessages.wgId, input.wgId),
					isNull(wgChatMessages.deletedAt),
				),
			)
			.limit(1);
		if (replyRow.length === 0) {
			return { status: HTTP.BAD_REQUEST, body: { error: 'reply_to_not_found' } };
		}
	}
	const requestedMentionIds = Array.from(
		new Set(input.requestedMentionIds.filter((id) => UUID_PATTERN.test(id))),
	);
	let validMentionIds: string[] = [];
	if (requestedMentionIds.length > 0) {
		const validRows = await tx
			.select({ id: wgMembers.id })
			.from(wgMembers)
			.where(and(eq(wgMembers.wgId, input.wgId), inArray(wgMembers.id, requestedMentionIds)));
		validMentionIds = validRows.map((row) => row.id).filter((id) => id !== input.senderMemberId);
	}

	const [inserted] = await tx
		.insert(wgChatMessages)
		.values({
			wgId: input.wgId,
			senderMemberId: input.senderMemberId,
			kind: 'text',
			body: input.body,
			replyToMessageId: input.replyToMessageId,
			// The insert runs behind the WG lock: the transaction start would stamp it before an
			// earlier message committed meanwhile, and the unread cursor would skip that message.
			createdAt: sql`clock_timestamp()`,
		})
		.returning();
	if (!inserted) throw new Error('chat_message_insert_failed');

	let persistedMentionIds: string[] = [];
	if (validMentionIds.length > 0) {
		const insertedMentionRows = await tx
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
	return {
		status: 200,
		body: { message: inserted, mentions: persistedMentionIds, warning: null },
		context: { created: inserted, mentionIds: persistedMentionIds },
	};
}
