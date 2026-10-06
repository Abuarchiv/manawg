import { db, wgChatMessages, wgChatReads } from '@/core/db';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { badRequest, notFound, tooMany, unreadableJsonBody } from '@/core/http/api-errors';
import { readJsonLimited } from '@/core/http/read-json';
import { chatReadLimiter, checkRateLimit } from '@/core/rate-limit';
import { buildChatReadMarkerSetWhere } from '@/features/chat/chat-read-query';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const postSchema = z.object({
	lastReadMessageId: z.string().uuid().nullable(),
});

export const POST = withWgRoute('chat read POST', async (req, { code }) => {
	let raw: unknown;
	try {
		raw = await readJsonLimited(req);
	} catch (err) {
		return unreadableJsonBody(err);
	}
	const parsed = postSchema.safeParse(raw);
	if (!parsed.success) return badRequest('body_invalid');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;

	const limited = await checkRateLimit(
		chatReadLimiter,
		`chat-read:${wgId}:${auth.member.memberId}`,
	);
	if (!limited.success) return tooMany();

	const messageId = parsed.data.lastReadMessageId;
	if (messageId) {
		if (!UUID_PATTERN.test(messageId)) return badRequest('message_id_invalid');
		const messageRows = await db
			.select({ id: wgChatMessages.id })
			.from(wgChatMessages)
			.where(and(eq(wgChatMessages.id, messageId), eq(wgChatMessages.wgId, wgId)))
			.limit(1);
		if (!messageRows[0]) return notFound('message_not_found');
	}

	// `applied` tells the client whether the marker actually moved: an older
	// receipt is ignored, and a `null` reset is a no-op on an unset marker.
	const changed = await db
		.insert(wgChatReads)
		.values({
			wgId,
			memberId: auth.member.memberId,
			lastReadMessageId: messageId,
		})
		.onConflictDoUpdate({
			target: [wgChatReads.wgId, wgChatReads.memberId],
			set: { lastReadMessageId: messageId, updatedAt: new Date() },
			setWhere: buildChatReadMarkerSetWhere(messageId, wgChatReads.lastReadMessageId),
		})
		.returning({ memberId: wgChatReads.memberId });

	return NextResponse.json({ ok: true, applied: changed.length > 0 });
});
