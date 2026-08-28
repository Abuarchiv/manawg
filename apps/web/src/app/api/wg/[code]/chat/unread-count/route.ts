import { db, wgChatMessages, wgChatReads, wgMembers } from '@/lib/db';
import { requireWgMember } from '@/lib/wg/require-wg-member';
import { withWgRoute } from '@/lib/wg/with-wg-route';
import { and, count, eq, gt, isNull, ne, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const UNREAD_CAP = 99;

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
		if (lastReadId) {
			const lastMsg = await db
				.select({ createdAt: wgChatMessages.createdAt })
				.from(wgChatMessages)
				.where(and(eq(wgChatMessages.id, lastReadId), eq(wgChatMessages.wgId, wgId)))
				.limit(1);
			cutoff = lastMsg[0]?.createdAt ?? null;
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

		const whereExpr = and(
			eq(wgChatMessages.wgId, wgId),
			isNull(wgChatMessages.deletedAt),
			or(
				ne(wgChatMessages.senderMemberId, auth.member.memberId),
				isNull(wgChatMessages.senderMemberId),
			),
			cutoff ? gt(wgChatMessages.createdAt, cutoff) : undefined,
		);

		const rows = await db
			.select({ value: count(wgChatMessages.id) })
			.from(wgChatMessages)
			.where(whereExpr);

		const total = Number(rows[0]?.value ?? 0);
		const capped = total > UNREAD_CAP ? UNREAD_CAP : total;
		return NextResponse.json({ count: capped, overflow: total > UNREAD_CAP });
	},
	{
		fixture: () => {
			return NextResponse.json(
				{ count: 0, overflow: false },
				{ headers: { 'Cache-Control': 'private, no-store' } },
			);
		},
	},
);
