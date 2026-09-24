import { and, eq, gt, isNull, ne, or, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

export function buildChatCursorWhere(
	messages: { createdAt: AnyPgColumn; id: AnyPgColumn },
	wgId: string,
	cursorId: string,
	direction: 'before' | 'after',
) {
	// Compare in PostgreSQL: a JS Date drops the cursor timestamp's microseconds.
	const cursor = sql`(
		select cursor.created_at, cursor.id
		from wg_chat_messages cursor
		where cursor.id = ${cursorId}::uuid and cursor.wg_id = ${wgId}::uuid
	)`;
	return direction === 'before'
		? sql`(${messages.createdAt}, ${messages.id}) < ${cursor}`
		: sql`(${messages.createdAt}, ${messages.id}) > ${cursor}`;
}

interface ChatUnreadColumns {
	id: AnyPgColumn;
	wgId: AnyPgColumn;
	senderMemberId: AnyPgColumn;
	deletedAt: AnyPgColumn;
	createdAt: AnyPgColumn;
}

export function buildUnreadChatMessagesWhere(
	messages: ChatUnreadColumns,
	wgId: string,
	memberId: string,
	cutoff: Date | null,
	cutoffMessageId: string | null = null,
) {
	return and(
		eq(messages.wgId, wgId),
		isNull(messages.deletedAt),
		or(ne(messages.senderMemberId, memberId), isNull(messages.senderMemberId)),
		cutoffMessageId
			? buildChatCursorWhere(messages, wgId, cutoffMessageId, 'after')
			: cutoff
				? gt(messages.createdAt, cutoff)
				: undefined,
	);
}
