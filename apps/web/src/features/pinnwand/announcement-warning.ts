import type { NotificationWarning } from '@/core/notifications/notification-warning';
import type { Message } from '@/shared/i18n/message';

/** The hint for a saved write whose push fan-out did not fully go out; null when all went well. */
export function deliveryWarning(warning: NotificationWarning): Message | null {
	if (warning === 'notification_delivery_failed') return { key: 'pinnwand.notices.deliveryFailed' };
	if (warning === 'notification_delivery_unknown')
		return { key: 'pinnwand.notices.deliveryUnknown' };
	return null;
}
