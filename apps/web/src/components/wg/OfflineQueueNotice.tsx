'use client';

import { formatQueuedOfflineActions } from '@/lib/wg/offline-copy';

/**
 * "N Änderungen warten auf Synchronisierung" — shown while the offline queue
 * is not empty. Ausgaben, Pinnwand and Putzen each inlined it identically.
 */
export function OfflineQueueNotice({ queuedCount }: { queuedCount: number }) {
	if (queuedCount <= 0) return null;
	return (
		<output
			className="block rounded-md border border-[var(--accent)]/25 bg-[var(--accent)]/5 px-3 py-2 text-[13px] text-[var(--accent)]"
			aria-live="polite"
		>
			{formatQueuedOfflineActions(queuedCount)}
		</output>
	);
}
