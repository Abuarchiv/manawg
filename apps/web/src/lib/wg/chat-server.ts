// Backward-compat shim: src/lib/wg/expenses.ts (owned by a parallel expense-feature
// extraction, out of scope here) imports `appendSystemMessage` directly to post a
// chat system message when an expense is settled. The real implementation now
// lives in features/chat. Remove this shim once expenses.ts's own extraction
// either imports from features/chat directly or routes the write through
// @/core (mirroring @/core/activity-feed.ts's postSystemNotice pattern).
export { appendSystemMessage } from '@/features/chat/chat-server';
