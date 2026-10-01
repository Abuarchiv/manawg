import { db, wgChatMessages, wgChatReads, wgMembers } from '@/core/db';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { toChatUnreadCountResponse } from '@/features/chat/chat-unread-count';
import { buildUnreadChatMessagesWhere } from '@/features/chat/chat-unread-query';
import { and, count, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export const GET = withWgRoute(
	'chat unread-count GET',
	async (req, { code }) => {
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;

		const readRow = await db
			.select({
				lastReadMessageId: wgChatReads.lastReadMessageId,
			})
			.from(wgChatReads)
			.where(and(eq(wgChatReads.wgId, wgId), eq(wgChatReads.memberId, auth.member.memberId)))
			.limit(1);

		const lastReadId = readRow[0]?.lastReadMessageId ?? null;
		let cutoff: Date | null = null;
		let cutoffMessageId: string | null = null;
		if (lastReadId) {
			const lastMsg = await db
				.select({ id: wgChatMessages.id, createdAt: wgChatMessages.createdAt })
				.from(wgChatMessages)
				.where(and(eq(wgChatMessages.id, lastReadId), eq(wgChatMessages.wgId, wgId)))
				.limit(1);
			cutoff = lastMsg[0]?.createdAt ?? null;
			cutoffMessageId = lastMsg[0]?.id ?? null;
		}
		// First-time-in-chat: never opened it before. Anchor the cutoff to the
		// member's join date so older history does not flood the unread badge.
		if (!cutoff) {
			const memberRow = await db
				.select({ createdAt: wgMembers.createdAt })
				.from(wgMembers)
				.where(eq(wgMembers.id, auth.member.memberId))
				.limit(1);
			cutoff = memberRow[0]?.createdAt ?? null;
		}

		const whereExpr = buildUnreadChatMessagesWhere(
			wgChatMessages,
			wgId,
			auth.member.memberId,
			cutoff,
			cutoffMessageId,
		);

		const rows = await db
			.select({ value: count(wgChatMessages.id) })
			.from(wgChatMessages)
			.where(whereExpr);

		const total = Number(rows[0]?.value ?? 0);
		return NextResponse.json(toChatUnreadCountResponse(total));
	},
	{
		fixture: () => {
			return NextResponse.json(toChatUnreadCountResponse(0));
		},
	},
);
