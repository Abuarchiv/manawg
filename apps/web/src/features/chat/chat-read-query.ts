import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

export function buildChatReadMarkerSetWhere(
	candidateMessageId: string | null,
	currentMessageId: AnyPgColumn,
) {
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
		${candidateMessageId}::uuid is not null
		and (
			${currentMessageId} is null
			or ${candidateCreatedAt} > ${currentCreatedAt}
			or (
				${candidateCreatedAt} = ${currentCreatedAt}
				and ${candidateMessageId}::uuid > ${currentMessageId}
			)
		)
	`;
}
