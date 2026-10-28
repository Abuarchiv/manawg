'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { queuedOfflineActionsMessage } from '@/core/offline/offline-copy';
import { useMessage } from '@/shared/i18n/message';

/**
 * "N Änderungen warten auf Synchronisierung" — shown while the offline queue
 * is not empty. Ausgaben, Pinnwand and Putzen each inlined it identically.
 */
export function OfflineQueueNotice({ queuedCount }: { queuedCount: number }) {
	const render = useMessage();
	if (queuedCount <= 0) return null;
	return (
		<Alert>
			<AlertDescription>{render(queuedOfflineActionsMessage(queuedCount))}</AlertDescription>
		</Alert>
	);
}
