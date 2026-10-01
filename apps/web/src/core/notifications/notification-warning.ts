/**
 * Mutation routes answer with `warning` when the write itself succeeded but
 * the push fan-out did not fully. Clients must still treat the write as saved
 * and only add a hint. Keeping the type and the copy here stops every page
 * from re-deriving the same two messages.
 */
export type NotificationWarning =
	| 'notification_delivery_failed'
	| 'notification_delivery_unknown'
	| null;

export function notificationWarningMessage(
	warning: NotificationWarning,
	savedLabel = 'Gespeichert',
): string | null {
	if (warning === 'notification_delivery_failed') {
		return `${savedLabel}. Nicht alle Push-Benachrichtigungen konnten versendet werden.`;
	}
	if (warning === 'notification_delivery_unknown') {
		return `${savedLabel}. Push-Versand konnte nicht bestätigt werden.`;
	}
	return null;
}
