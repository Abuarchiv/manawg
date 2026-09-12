'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatQueuedOfflineActions } from '@/core/offline/offline-copy';

/**
 * "N Änderungen warten auf Synchronisierung" — shown while the offline queue
 * is not empty. Ausgaben, Pinnwand and Putzen each inlined it identically.
 */
export function OfflineQueueNotice({ queuedCount }: { queuedCount: number }) {
	if (queuedCount <= 0) return null;
	return (
		<Alert>
			<AlertDescription>{formatQueuedOfflineActions(queuedCount)}</AlertDescription>
		</Alert>
	);
}
