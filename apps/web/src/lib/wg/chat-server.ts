import 'server-only';

import { type WgChatMessage, db, wgChatMessages } from '@/lib/db';
import { type AppendSystemMessageInput, SYSTEM_MESSAGE_KIND } from './chat-pure';

export async function appendSystemMessage(input: AppendSystemMessageInput): Promise<WgChatMessage> {
	const [row] = await db
		.insert(wgChatMessages)
		.values({
			wgId: input.wgId,
			senderMemberId: null,
			kind: SYSTEM_MESSAGE_KIND,
			systemKind: input.kind,
			systemPayload: input.payload,
		})
		.returning();
	if (!row) throw new Error('chat_system_insert_failed');
	return row;
}
