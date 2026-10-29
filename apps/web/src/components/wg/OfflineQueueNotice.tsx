'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { queuedOfflineActionsMessage } from '@/core/offline/offline-copy';
import { useMessage } from '@/shared/i18n/message';

/** Notice that queued changes are waiting to sync; renders nothing while the offline queue is empty. */
export function OfflineQueueNotice({ queuedCount }: { queuedCount: number }) {
	const render = useMessage();
	if (queuedCount <= 0) return null;
	return (
		<Alert>
			<AlertDescription>{render(queuedOfflineActionsMessage(queuedCount))}</AlertDescription>
		</Alert>
	);
}
