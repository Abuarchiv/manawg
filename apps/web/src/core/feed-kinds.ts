/** Chat message kind for messages the app posts on behalf of the WG. */
export const SYSTEM_MESSAGE_KIND = 'system';

/** Events that post a system message to the WG chat. */
export type ChatSystemKind =
	| 'member.joined'
	| 'member.left'
	| 'expense.created'
	| 'chore.completed';
