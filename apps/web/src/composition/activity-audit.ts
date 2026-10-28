import {
	auditFeedMessage,
	isPassiveAuditEvent,
	KEY_RENDER_CONTEXT,
	parseAuditMetadata,
	type RenderContext,
} from '@/core/audit-messages';
import { formatEuroCents } from '@/core/utils/money';
import { formatShortDate, formatShortDateRange } from '@/core/utils/time';
import { ANNOUNCEMENT_KINDS } from '@/features/pinnwand/announcement-workflow';
import type { Message, MessageKey } from '@/shared/i18n/message';
import { MEMBER_NAME_MAX_LENGTH } from '@/shared/lib/limits';

/** Chat audits carry no content worth a feed row and would crowd out real events. */
export const CHAT_AUDIT_EVENT_TYPES = [
	'chat.message.created',
	'chat.message.edited',
	'chat.message.deleted',
] as const;

/**
 * Audit events the chronicle never shows: chat noise, plus events whose raw
 * row (expense, shopping item, completion, ...) is already a timeline entry.
 */
export const ACTIVITY_HIDDEN_AUDIT_EVENT_TYPES = [
	...CHAT_AUDIT_EVENT_TYPES,
	'expense.created',
	'recurring.charged',
	'recurring.created',
	'recurring.advanced',
	'shopping.created',
	'shopping.bought',
	'chore.completed',
	'announcement.created',
	'absence.created',
] as const;

const NOTIFICATION_FIELD_KEYS: readonly string[] = [
	'pushOptIn',
	'notifyAnnouncements',
	'notifyChores',
	'notifyExpenses',
	'notifyShopping',
	'notifyInventory',
	'notifyReminders',
	'notifyChat',
	'notifyEvents',
	'notifyStatementEmail',
	'quietStartHour',
	'quietEndHour',
];

/** Short facts of an event ("Typ: Info · mit Bild"), rendered from its metadata in the reader's locale. */
export function auditDetail(
	metadataJson?: string | null,
	ctx: RenderContext = KEY_RENDER_CONTEXT,
): string | undefined {
	const metadata = parseAuditMetadata(metadataJson);
	if (!metadata) return undefined;
	const say = (key: MessageKey, values?: Message['values']) =>
		ctx.render(values ? { key, values } : { key });
	const { locale } = ctx;
	try {
		const parts: string[] = [];
		if (typeof metadata.description === 'string' && metadata.description.length > 0) {
			parts.push(metadata.description);
		}
		if (typeof metadata.title === 'string' && metadata.title.length > 0) {
			parts.push(metadata.title);
		}
		if (typeof metadata.quantity === 'string' && metadata.quantity.length > 0) {
			parts.push(metadata.quantity);
		}
		// Only known pinboard kinds: chat audits carry kind 'text'/'image', which is not user text.
		const kind = ANNOUNCEMENT_KINDS.find((known) => known === metadata.kind);
		if (kind) {
			parts.push(say('audit.detail.kind', { kind: { key: `pinnwand.kind.${kind}` } }));
		}
		if (metadata.hasImage === true) {
			parts.push(say('audit.detail.withImage'));
		}
		if (Array.isArray(metadata.notificationFields)) {
			const fields = metadata.notificationFields
				.filter((field): field is string => typeof field === 'string' && field.length > 0)
				.map((field) =>
					// New rows store field keys; rows written earlier hold the finished label.
					NOTIFICATION_FIELD_KEYS.includes(field)
						? say(`audit.detail.fields.${field}` as MessageKey)
						: field,
				);
			if (fields.length > 0) parts.push(fields.join(', '));
		}
		if (typeof metadata.pushOptIn === 'boolean') {
			parts.push(say(metadata.pushOptIn ? 'audit.detail.pushOn' : 'audit.detail.pushOff'));
		}
		if ('quietStartHour' in metadata || 'quietEndHour' in metadata) {
			const start = typeof metadata.quietStartHour === 'number' ? metadata.quietStartHour : null;
			const end = typeof metadata.quietEndHour === 'number' ? metadata.quietEndHour : null;
			if (start !== null || end !== null) {
				parts.push(say('audit.detail.quietHours', { start: start ?? '?', end: end ?? '?' }));
			} else {
				parts.push(say('audit.detail.quietHoursOff'));
			}
		}
		if (typeof metadata.reason === 'string' && metadata.reason.length > 0) {
			parts.push(metadata.reason);
		}
		if (typeof metadata.amountCents === 'number') {
			const currency = typeof metadata.currency === 'string' ? metadata.currency : 'EUR';
			parts.push(formatEuroCents(metadata.amountCents, currency, { locale }));
		}
		if (typeof metadata.splitCount === 'number') {
			parts.push(say('audit.detail.splitCount', { count: metadata.splitCount }));
		}
		if (typeof metadata.reaction === 'string') {
			parts.push(say('audit.detail.reaction', { reaction: metadata.reaction }));
		}
		if (typeof metadata.nameBefore === 'string' && typeof metadata.nameAfter === 'string') {
			if (metadata.nameBefore !== metadata.nameAfter) {
				parts.push(`${metadata.nameBefore} → ${metadata.nameAfter}`);
			}
		}
		if (typeof metadata.intervalDays === 'number') {
			parts.push(say('audit.detail.everyDays', { days: metadata.intervalDays }));
		}
		if (typeof metadata.intervalMonths === 'number') {
			parts.push(say('audit.detail.everyMonths', { months: metadata.intervalMonths }));
		}
		if (typeof metadata.startDate === 'string' && typeof metadata.endDate === 'string') {
			parts.push(
				say('audit.detail.away', {
					range: formatShortDateRange(metadata.startDate, metadata.endDate, locale),
				}),
			);
		}
		if (typeof metadata.nextDueAt === 'string') {
			parts.push(
				say('audit.detail.nextDue', {
					date: formatShortDate(metadata.nextDueAt, 'Europe/Berlin', locale),
				}),
			);
		}
		if (Array.isArray(metadata.splitIds)) {
			parts.push(say('audit.detail.shares', { count: metadata.splitIds.length }));
		}
		return parts.length > 0 ? parts.join(' · ') : undefined;
	} catch {
		return undefined;
	}
}

export function getAuditHref(event: {
	eventType: string;
	entityType?: string;
	entityId?: string | null;
	metadataJson?: string | null;
}): string | undefined {
	const metadata = parseAuditMetadata(event.metadataJson);
	const announcementId =
		typeof metadata?.announcementId === 'string' && metadata.announcementId.length > 0
			? metadata.announcementId
			: event.entityType === 'announcement' && event.entityId
				? event.entityId
				: null;

	if (announcementId) return announcementHref(announcementId);
	if (event.entityType === 'shopping_item' && event.entityId) {
		return `/einkauf?highlight=${encodeURIComponent(event.entityId)}`;
	}
	if (event.entityType === 'chore' && event.entityId) {
		return `/putzen?highlight=${encodeURIComponent(event.entityId)}`;
	}
	if ((event.entityType === 'absence' || event.entityType === 'member_absence') && event.entityId) {
		return `/putzen?panel=absences&absence=${encodeURIComponent(event.entityId)}`;
	}
	if (event.entityType === 'recurring_expense' && event.eventType === 'recurring.deleted') {
		return '/ausgaben?filter=recurring';
	}
	if (event.entityType === 'recurring_expense' && event.entityId) {
		return recurringExpenseHref(event.entityId);
	}
	if (
		event.entityType === 'expense' ||
		event.entityType === 'expense_split' ||
		event.entityType === 'expense_debt'
	) {
		return event.entityType === 'expense' && event.entityId
			? `/ausgaben?highlight=${encodeURIComponent(event.entityId)}`
			: '/ausgaben';
	}
	if (event.entityType === 'member' && event.eventType.startsWith('notification.')) {
		return '/einstellungen#benachrichtigungen';
	}
	if (event.entityType === 'wg') return '/einstellungen#zugang';
	return undefined;
}

/**
 * The feed puts the actor's current name in front, so the summary loses the name it was written
 * with ("Anna hat …" → "hat …"). After a rename that stored name differs; summaries are written as
 * "<Name> hat/ist …", so the part before the first " hat "/" ist " is the old name.
 */
export function formatAuditActivityText(summary: string, actorName: string): string {
	const trimmed = summary.trim();
	const prefix = `${actorName} `;
	if (trimmed.toLocaleLowerCase('de-DE').startsWith(prefix.toLocaleLowerCase('de-DE'))) {
		return trimmed.slice(prefix.length);
	}
	// Passive summaries ("<Beschreibung> wurde …") never start with a name; a description may
	// itself contain "hat"/"ist", so only an actor-style summary loses its first words.
	if (actorName === 'System' || / wurde /u.test(trimmed)) return trimmed;
	const verb = /^\S.*? (?=(?:hat|ist) )/u.exec(trimmed);
	return verb && verb[0].length <= MEMBER_NAME_MAX_LENGTH + 1
		? trimmed.slice(verb[0].length)
		: trimmed;
}

/**
 * The sentence of an audit row for the reader. Rows that carry their sentence parameters render
 * from the catalog in the reader's locale, with `selfText` for the reader's own rows. Older rows
 * (and calls without a translator) show the stored German summary.
 */
export function auditActivitySentence(
	event: { eventType: string; summary: string; metadataJson?: string | null },
	actorName: string,
	ctx?: RenderContext,
): { text: string; selfText?: string } {
	const metadata = parseAuditMetadata(event.metadataJson);
	const feed = ctx && auditFeedMessage(event.eventType, metadata, ctx.locale, false);
	if (ctx && feed) {
		const text = ctx.render(feed);
		const own = auditFeedMessage(event.eventType, metadata, ctx.locale, true);
		const selfText = own && !isPassiveAuditEvent(event.eventType) ? ctx.render(own) : text;
		return selfText === text ? { text } : { text, selfText };
	}
	const text = formatAuditActivityText(event.summary, actorName);
	// i18n-ignore German verb agreement for stored rows
	const selfText = text.replace(/^hat\b/u, 'hast').replace(/^ist\b/u, 'bist');
	return selfText === text ? { text } : { text, selfText };
}

function announcementHref(announcementId: string): string {
	return `/pinnwand#announcement-${encodeURIComponent(announcementId)}`;
}

function recurringExpenseHref(recurringId: string): string {
	return `/ausgaben?recurring=${encodeURIComponent(recurringId)}`;
}
