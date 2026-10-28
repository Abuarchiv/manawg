import { deliveryWarning as warningFor } from '@/core/notifications/delivery-warning';
import type { NotificationWarning } from '@/core/notifications/notification-warning';
import type { Message } from '@/shared/i18n/message';

/** The hint for a saved write whose push fan-out did not fully go out; null when all went well. */
export function deliveryWarning(warning: NotificationWarning): Message | null {
	return warningFor(warning, {
		failed: 'pinboard.notices.deliveryFailed',
		unknown: 'pinboard.notices.deliveryUnknown',
	});
}
