'use client';

import { useWg } from '@/components/wg/WgContextProvider';
import { countOfflineActions, syncOfflineActions } from '@/lib/wg/offline-client';
import {
	formatManualOfflineSyncResult,
	formatQueuedOfflineActions,
	getOfflineSyncFailureMessage,
} from '@/lib/wg/offline-copy';
import { AlertCircle, CheckCircle2, Loader2, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

function formatQueuedActions(count: number): string {
	if (count === 1) return '1 Aktion wartet.';
	return `${count} Aktionen warten.`;
}

function getSyncedCountForWg(event: Event, shareCode: string): number {
	if (!(event instanceof CustomEvent)) return 0;
	const syncedByShareCode = event.detail?.syncedByShareCode;
	if (syncedByShareCode && typeof syncedByShareCode === 'object') {
		const scoped = syncedByShareCode[shareCode];
		return typeof scoped === 'number' ? scoped : 0;
	}
	return typeof event.detail?.synced === 'number' ? event.detail.synced : 0;
}

function isScopedSyncEventForOtherWg(event: Event, shareCode: string): boolean {
	if (!(event instanceof CustomEvent)) return false;
	const syncedByShareCode = event.detail?.syncedByShareCode;
	if (!syncedByShareCode || typeof syncedByShareCode !== 'object') return false;
	const scoped = syncedByShareCode[shareCode];
	return typeof scoped !== 'number' || scoped <= 0;
}

export function OfflineBanner() {
	const { wg, identity } = useWg();
	const settingsDataHref = `/wg/${encodeURIComponent(wg.shareCode)}/einstellungen#daten`;
	const [online, setOnline] = useState(true);
	const [queueCount, setQueueCount] = useState(0);
	const [syncing, setSyncing] = useState(false);
	const [notice, setNotice] = useState<{
		type: 'success' | 'warning';
		text: string;
	} | null>(null);
	const syncingRef = useRef(false);

	useEffect(() => {
		setOnline(navigator.onLine);
		const update = (options?: { clearNotice?: boolean }) => {
			setOnline(navigator.onLine);
			const nextCount = countOfflineActions(wg.shareCode, { memberId: identity.memberId });
			setQueueCount(nextCount);
			if (options?.clearNotice !== false) setNotice(null);
		};
		const updateFromEvent = () => update();
		const onSynced = (event: Event) => {
			if (isScopedSyncEventForOtherWg(event, wg.shareCode)) return;
			const synced = getSyncedCountForWg(event, wg.shareCode);
			if (synced > 0) {
				const remaining = countOfflineActions(wg.shareCode, { memberId: identity.memberId });
				setNotice({
					type: 'success',
					text: formatManualOfflineSyncResult(synced, remaining),
				});
			}
			update({ clearNotice: synced <= 0 });
		};
		update();
		window.addEventListener('online', updateFromEvent);
		window.addEventListener('offline', updateFromEvent);
		window.addEventListener('manawg:offline-queue', updateFromEvent);
		window.addEventListener('manawg:offline-synced', onSynced);
		return () => {
			window.removeEventListener('online', updateFromEvent);
			window.removeEventListener('offline', updateFromEvent);
			window.removeEventListener('manawg:offline-queue', updateFromEvent);
			window.removeEventListener('manawg:offline-synced', onSynced);
		};
	}, [identity.memberId, wg.shareCode]);

	async function retry(): Promise<void> {
		if (syncingRef.current) return;
		syncingRef.current = true;
		setSyncing(true);
		try {
			const before = countOfflineActions(wg.shareCode, { memberId: identity.memberId });
			const synced = await syncOfflineActions(wg.shareCode, {
				force: true,
				memberId: identity.memberId,
			});
			const after = countOfflineActions(wg.shareCode, { memberId: identity.memberId });
			setQueueCount(after);
			if (synced > 0) {
				setNotice({
					type: 'success',
					text: formatManualOfflineSyncResult(synced, after),
				});
			} else if (before > 0 && after > 0) {
				setNotice({
					type: 'warning',
					text: 'Noch nicht gesendet. Die Aktionen bleiben gespeichert.',
				});
			}
		} catch {
			setQueueCount(countOfflineActions(wg.shareCode, { memberId: identity.memberId }));
			setNotice({
				type: 'warning',
				text: getOfflineSyncFailureMessage(),
			});
		} finally {
			syncingRef.current = false;
			setSyncing(false);
		}
	}

	if (!online) {
		return (
			<output
				className="sticky top-0 z-20 border-b border-[var(--warning-border)] bg-[var(--warning-bg)] px-4 py-2 text-[12.5px] font-medium text-[var(--warning-fg)]"
				aria-live="polite"
			>
				<div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
					<div className="flex min-w-0 items-center gap-2">
						<WifiOff className="h-4 w-4 shrink-0" aria-hidden />
						<span className="truncate">
							Offline.{' '}
							{queueCount > 0 ? formatQueuedActions(queueCount) : 'Änderungen werden vorgemerkt.'}
						</span>
					</div>
					<Link
						href="/offline"
						aria-label="Offline-Übersicht prüfen"
						className="inline-flex min-h-11 shrink-0 items-center rounded-md px-2 underline underline-offset-2 transition-colors hover:bg-[var(--warning-fg)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--warning-fg)] focus-visible:ring-offset-2"
					>
						Prüfen
					</Link>
				</div>
			</output>
		);
	}

	if (queueCount === 0 && !notice) return null;

	if (notice && queueCount === 0) {
		return (
			<output
				className="sticky top-0 z-20 border-b border-[var(--success-border)] bg-[var(--success-bg)] px-4 py-2 text-[12.5px] font-medium text-[var(--success-fg)]"
				aria-live="polite"
			>
				<div className="mx-auto flex max-w-2xl items-center gap-2">
					<CheckCircle2 className="h-4 w-4" aria-hidden />
					{notice.text}
				</div>
			</output>
		);
	}

	return (
		<output
			className="sticky top-0 z-20 border-b border-[var(--accent)]/25 bg-[var(--accent)]/10 px-4 py-2 text-[12.5px] font-medium text-[var(--accent)]"
			aria-live="polite"
		>
			<div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
				<Link href={settingsDataHref} className="min-w-0 truncate">
					{notice ? notice.text : formatQueuedOfflineActions(queueCount)}
				</Link>
				<button
					type="button"
					onClick={() => void retry()}
					disabled={syncing}
					aria-label={
						syncing ? 'Offline-Aktionen werden gesendet' : 'Offline-Aktionen jetzt senden'
					}
					className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-[var(--accent)]/30 px-3 text-[12px] transition-colors hover:border-[var(--accent)] hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
				>
					{syncing ? (
						<Loader2 className="h-3 w-3 animate-spin" aria-hidden />
					) : notice?.type === 'warning' ? (
						<AlertCircle className="h-3 w-3" aria-hidden />
					) : null}
					Jetzt senden
				</button>
			</div>
		</output>
	);
}
