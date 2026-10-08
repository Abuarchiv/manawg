import 'server-only';
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Guard for the read-marker upsert. A message id only moves the marker
 * forward; `null` explicitly resets it, which only changes a row that still
 * points at a message.
 */
export function buildChatReadMarkerSetWhere(
	candidateMessageId: string | null,
	currentMessageId: AnyPgColumn,
) {
	if (candidateMessageId === null) return sql`${currentMessageId} is not null`;

	const candidateCreatedAt = sql`(
		select candidate.created_at
		from wg_chat_messages candidate
		where candidate.id = ${candidateMessageId}::uuid
	)`;
	const currentCreatedAt = sql`coalesce(
		(select current_read.created_at
		 from wg_chat_messages current_read
		 where current_read.id = ${currentMessageId}),
		'-infinity'::timestamptz
	)`;

	return sql`
		${currentMessageId} is null
		or ${candidateCreatedAt} > ${currentCreatedAt}
		or (
			${candidateCreatedAt} = ${currentCreatedAt}
			and ${candidateMessageId}::uuid > ${currentMessageId}
		)
	`;
}
