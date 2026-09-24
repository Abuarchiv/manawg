import { db, wgChatMessages, wgChatReads } from '@/core/db';
import { badRequest, notFound, tooMany } from '@/core/errors';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
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
		raw = await req.json();
	} catch {
		return badRequest('invalid_json');
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

	await db
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
		});

	return NextResponse.json({ ok: true });
});
