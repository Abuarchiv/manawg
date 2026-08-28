const MENTION_PATTERN = /(^|[\s(])@([A-Za-zÄÖÜäöüß0-9_-]{1,40})/g;
const EDIT_WINDOW_MS_DEFAULT = 15 * 60 * 1000;
const SYSTEM_MESSAGE_KIND = 'system';
const TEXT_MESSAGE_KIND = 'text';

export type ChatSystemKind =
	| 'member.joined'
	| 'member.left'
	| 'expense.created'
	| 'chore.completed';

interface ChatMessageLike {
	id: string;
	senderMemberId: string | null;
	kind: string;
	deletedAt?: Date | string | null;
	createdAt: Date | string;
}

interface ChatMemberLike {
	id: string;
	role?: string | null;
}

interface ParsedMentions {
	mentions: string[];
	cleanedBody: string;
}

export function parseMentions(body: string): ParsedMentions {
	const matches = new Set<string>();
	if (typeof body !== 'string' || body.length === 0) {
		return { mentions: [], cleanedBody: '' };
	}
	for (const match of body.matchAll(MENTION_PATTERN)) {
		const name = match[2];
		if (typeof name === 'string' && name.length > 0) matches.add(name);
	}
	return { mentions: [...matches], cleanedBody: body.trim() };
}

function toDate(value: Date | string): Date {
	return value instanceof Date ? value : new Date(value);
}

function isoDayKey(date: Date, locale: string): string {
	return new Intl.DateTimeFormat(locale, {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(date);
}

interface MessageDayGroup<T extends { createdAt: Date | string }> {
	day: Date;
	key: string;
	messages: T[];
}

export function groupMessagesByDay<T extends { createdAt: Date | string }>(
	messages: ReadonlyArray<T>,
	locale = 'de-DE',
): MessageDayGroup<T>[] {
	const groups: MessageDayGroup<T>[] = [];
	const lookup = new Map<string, MessageDayGroup<T>>();
	for (const message of messages) {
		const date = toDate(message.createdAt);
		if (Number.isNaN(date.getTime())) continue;
		const key = isoDayKey(date, locale);
		const existing = lookup.get(key);
		if (existing) {
			existing.messages.push(message);
			continue;
		}
		const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
		const group: MessageDayGroup<T> = { day, key, messages: [message] };
		lookup.set(key, group);
		groups.push(group);
	}
	return groups;
}

export function canEditMessage(
	message: ChatMessageLike,
	member: ChatMemberLike,
	now: Date | number = Date.now(),
	maxEditWindowMs = EDIT_WINDOW_MS_DEFAULT,
): boolean {
	if (message.kind !== TEXT_MESSAGE_KIND) return false;
	if (message.deletedAt) return false;
	if (message.senderMemberId !== member.id) return false;
	const createdMs = toDate(message.createdAt).getTime();
	const nowMs = typeof now === 'number' ? now : now.getTime();
	return nowMs - createdMs <= maxEditWindowMs;
}

export function canDeleteMessage(message: ChatMessageLike, member: ChatMemberLike): boolean {
	if (message.deletedAt) return false;
	if (message.kind === SYSTEM_MESSAGE_KIND) return member.role === 'admin';
	if (message.senderMemberId === member.id) return true;
	return member.role === 'admin';
}

export interface AppendSystemMessageInput {
	wgId: string;
	kind: ChatSystemKind;
	payload: Record<string, unknown>;
}

export { SYSTEM_MESSAGE_KIND };

export function isSingleEmoji(value: unknown): boolean {
	if (typeof value !== 'string') return false;
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > 16) return false;
	try {
		const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
		const segments = [...segmenter.segment(trimmed)];
		return segments.length === 1;
	} catch {
		return /^\p{Extended_Pictographic}$/u.test(trimmed);
	}
}

export function sanitizeMessageBody(body: unknown, maxLength = 4000): string | null {
	if (typeof body !== 'string') return null;
	const trimmed = body.trim();
	if (trimmed.length === 0) return null;
	return trimmed.length > maxLength ? null : trimmed;
}

export function previewBody(body: string, max = 120): string {
	const normalized = body.replace(/\s+/g, ' ').trim();
	return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

export function mergePagedMessagesById<T extends { id: string }>(
	older: readonly T[],
	existing: readonly T[],
): T[] {
	const seenIds = new Set(existing.map((m) => m.id));
	const fresh = older.filter((m) => !seenIds.has(m.id));
	return [...fresh, ...existing];
}

export function mergePagedReactions<
	T extends { messageId: string; memberId: string; emoji: string },
>(older: readonly T[], existing: readonly T[]): T[] {
	const key = (r: T): string => `${r.messageId}|${r.memberId}|${r.emoji}`;
	const seen = new Set(existing.map(key));
	const fresh = older.filter((r) => !seen.has(key(r)));
	return [...fresh, ...existing];
}
