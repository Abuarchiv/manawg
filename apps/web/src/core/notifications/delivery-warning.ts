import type { Message, MessageKey } from '@/shared/i18n/message';
import type { NotificationWarning } from './notification-warning';

/**
 * The hint for a saved write whose push fan-out did not fully go out, with the
 * feature's own copy; null when all went well.
 */
export function deliveryWarning(
	warning: NotificationWarning,
	keys: { failed: MessageKey; unknown: MessageKey },
): Message | null {
	if (warning === 'notification_delivery_failed') return { key: keys.failed };
	if (warning === 'notification_delivery_unknown') return { key: keys.unknown };
	return null;
}
