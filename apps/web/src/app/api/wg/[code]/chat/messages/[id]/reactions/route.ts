import { db, wgChatMessages, wgChatReactions } from '@/core/db';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { withIdempotentJsonResponse } from '@/core/guards/idempotency';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import {
	badRequest,
	conflict,
	notFound,
	tooMany,
	unreadableJsonBody,
} from '@/core/http/api-errors';
import { readJsonLimited } from '@/core/http/read-json';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { isSingleEmoji } from '@/features/chat/chat-pure';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

async function ensureMessage(
	messageId: string,
	wgId: string,
): Promise<{ exists: boolean; deleted: boolean }> {
	const row = await db
		.select({ id: wgChatMessages.id, deletedAt: wgChatMessages.deletedAt })
		.from(wgChatMessages)
		.where(and(eq(wgChatMessages.id, messageId), eq(wgChatMessages.wgId, wgId)))
		.limit(1);
	if (row.length === 0) return { exists: false, deleted: false };
	return { exists: true, deleted: row[0]?.deletedAt != null };
}

export const POST = withWgRoute<{ id: string }>(
	'chat reactions POST',
	async (req, { code, id }) => {
		if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');

		let raw: unknown;
		try {
			raw = await readJsonLimited(req);
		} catch (err) {
			return unreadableJsonBody(err);
		}
		const emoji =
			raw && typeof raw === 'object' && 'emoji' in raw
				? (raw as { emoji?: unknown }).emoji
				: undefined;
		if (!isSingleEmoji(emoji)) return badRequest('emoji_invalid');
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;

		const limited = await checkRateLimit(
			wgWriteLimiter,
			`chat-react:${wgId}:${auth.member.memberId}`,
		);
		if (!limited.success) return tooMany();

		const messageCheck = await ensureMessage(id, wgId);
		if (!messageCheck.exists) return notFound('message_not_found');
		if (messageCheck.deleted) return conflict('message_deleted', 'message_deleted');

		return withIdempotentJsonResponse(
			req,
			`chat-reaction-add:${wgId}:${auth.member.memberId}:${id}:${(emoji as string).trim()}`,
			async () => {
				await db
					.insert(wgChatReactions)
					.values({
						messageId: id,
						memberId: auth.member.memberId,
						emoji: (emoji as string).trim(),
					})
					.onConflictDoNothing();

				return NextResponse.json({ ok: true });
			},
		);
	},
);

export const DELETE = withWgRoute<{ id: string }>(
	'chat reactions DELETE',
	async (req, { code, id }) => {
		if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');

		const url = new URL(req.url);
		const emoji = url.searchParams.get('emoji');
		if (!isSingleEmoji(emoji)) return badRequest('emoji_invalid');
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;

		const limited = await checkRateLimit(
			wgWriteLimiter,
			`chat-react:${wgId}:${auth.member.memberId}`,
		);
		if (!limited.success) return tooMany();

		const messageCheck = await ensureMessage(id, wgId);
		if (!messageCheck.exists) return notFound('message_not_found');
		if (messageCheck.deleted) return conflict('message_deleted');

		return withIdempotentJsonResponse(
			req,
			`chat-reaction-remove:${wgId}:${auth.member.memberId}:${id}:${(emoji as string).trim()}`,
			async () => {
				await db
					.delete(wgChatReactions)
					.where(
						and(
							eq(wgChatReactions.messageId, id),
							eq(wgChatReactions.memberId, auth.member.memberId),
							eq(wgChatReactions.emoji, (emoji as string).trim()),
						),
					);

				return NextResponse.json({ ok: true });
			},
		);
	},
);
