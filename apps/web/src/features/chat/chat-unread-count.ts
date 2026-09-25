export interface ChatUnreadCountResponse {
	count: number;
	exactCount: number;
	overflow: boolean;
}

const VISIBLE_UNREAD_COUNT_LIMIT = 99;

export function toChatUnreadCountResponse(total: number): ChatUnreadCountResponse {
	const exactCount = Math.max(0, Math.trunc(total));
	return {
		count: Math.min(exactCount, VISIBLE_UNREAD_COUNT_LIMIT),
		exactCount,
		overflow: exactCount > VISIBLE_UNREAD_COUNT_LIMIT,
	};
}
