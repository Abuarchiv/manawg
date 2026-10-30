import { isRecord } from '@/core/utils/is-record';

/**
 * Audit metadata keys that stay with the person or the system. Every member can read the
 * activity feed, so details such as one person's quiet hours or a WG's creation-time share
 * code must not travel with the event.
 */
const PRIVATE_METADATA_KEYS: Readonly<Record<string, readonly string[]>> = {
	'notification.settings.updated': ['pushOptIn', 'quietStartHour', 'quietEndHour'],
	'wg.created': ['shareCode'],
};

/**
 * Events the shared feeds leave out entirely: one person's own notification choice, and
 * noticeboard reactions, which the post itself already shows and which would flood the feed.
 */
export const HIDDEN_FROM_FEED_EVENT_TYPES: readonly string[] = [
	'notification.push.subscribed',
	'notification.push.unsubscribed',
	'notification.settings.updated',
	'announcement.reaction.added',
	'announcement.reaction.removed',
];

/** The metadata JSON of an audit event as the whole WG may see it. */
export function publicAuditMetadata(
	eventType: string,
	metadataJson: string | null | undefined,
): string | null {
	if (!metadataJson) return metadataJson ?? null;
	const hidden = PRIVATE_METADATA_KEYS[eventType];
	if (!hidden) return metadataJson;
	try {
		const parsed: unknown = JSON.parse(metadataJson);
		if (!isRecord(parsed)) return metadataJson;
		const visible = Object.fromEntries(
			Object.entries(parsed).filter(([key]) => !hidden.includes(key)),
		);
		return JSON.stringify(visible);
	} catch {
		return null;
	}
}
