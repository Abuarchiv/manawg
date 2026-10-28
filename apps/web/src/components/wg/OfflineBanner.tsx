'use client';

import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useWg } from '@/components/wg/WgContextProvider';
import { subscribeConnectivity, useOnlineStatus } from '@/core/hooks/use-online-status';
import {
	OFFLINE_QUEUE_EVENT,
	OFFLINE_SYNCED_EVENT,
	countOfflineActions,
	getSyncedCountForWg,
	needsManualOfflineResolution,
	offlineQueueReplaySupported,
	readOfflineQueue,
	syncOfflineActions,
} from '@/core/offline/offline-client';
import {
	OFFLINE_REPLAY_UNSUPPORTED_NOTICE,
	formatManualOfflineSyncResult,
	formatOfflineQueueCount,
	formatOfflineReviewNeeded,
	formatQueuedOfflineActions,
	getOfflineSyncFailureMessage,
} from '@/core/offline/offline-copy';
import { AlertCircle, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

function isScopedSyncEventForOtherWg(event: Event, shareCode: string): boolean {
	if (!(event instanceof CustomEvent)) return false;
	const syncedByShareCode = event.detail?.syncedByShareCode;
	if (!syncedByShareCode || typeof syncedByShareCode !== 'object') return false;
	const scoped = syncedByShareCode[shareCode];
	return typeof scoped !== 'number' || scoped <= 0;
}

export function OfflineBanner() {
	const t = useTranslations('shell.offlineBanner');
	const { wg, identity } = useWg();
	const settingsDataHref = `/wg/${encodeURIComponent(wg.shareCode)}/einstellungen#daten`;
	const online = useOnlineStatus();
	const [queueCount, setQueueCount] = useState(0);
	// Actions sync will not retry; "Jetzt senden" cannot help with them.
	const [reviewCount, setReviewCount] = useState(0);
	const [syncing, setSyncing] = useState(false);
	// Only a warning stays in the bar; a finished sync is a toast so the page below never shifts.
	const [notice, setNotice] = useState<string | null>(null);
	const toast = useToast();
	const syncingRef = useRef(false);

	// The bar wraps instead of truncating, so its real height (small phones, large text) feeds
	// the sticky offsets of settings tabs and the chat frame via --offline-banner-height.
	const observerRef = useRef<ResizeObserver | null>(null);
	const bannerRef = useCallback((el: HTMLOutputElement | null) => {
		observerRef.current?.disconnect();
		observerRef.current = null;
		const root = document.documentElement;
		if (!el) {
			root.style.removeProperty('--offline-banner-height');
			return;
		}
		const measure = () =>
			root.style.setProperty('--offline-banner-height', `${el.getBoundingClientRect().height}px`);
		measure();
		observerRef.current = new ResizeObserver(measure);
		observerRef.current.observe(el);
	}, []);

	useEffect(() => {
		const update = (options?: { clearNotice?: boolean }) => {
			const nextCount = countOfflineActions(wg.shareCode, { memberId: identity.memberId });
			setQueueCount(nextCount);
			setReviewCount(
				readOfflineQueue().filter(
					(item) =>
						item.shareCode === wg.shareCode &&
						item.memberId === identity.memberId &&
						needsManualOfflineResolution(item),
				).length,
			);
			if (options?.clearNotice !== false) setNotice(null);
		};
		const updateFromEvent = () => update();
		const onSynced = (event: Event) => {
			if (isScopedSyncEventForOtherWg(event, wg.shareCode)) return;
			const synced = getSyncedCountForWg(event, wg.shareCode);
			if (synced > 0) {
				const remaining = countOfflineActions(wg.shareCode, { memberId: identity.memberId });
				toast.success(formatManualOfflineSyncResult(synced, remaining));
			}
			update({ clearNotice: synced <= 0 });
		};
		update();
		const unsubscribeConnectivity = subscribeConnectivity(updateFromEvent);
		window.addEventListener(OFFLINE_QUEUE_EVENT, updateFromEvent);
		window.addEventListener(OFFLINE_SYNCED_EVENT, onSynced);
		return () => {
			unsubscribeConnectivity();
			window.removeEventListener(OFFLINE_QUEUE_EVENT, updateFromEvent);
			window.removeEventListener(OFFLINE_SYNCED_EVENT, onSynced);
		};
	}, [identity, wg.shareCode, toast]);

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
				toast.success(formatManualOfflineSyncResult(synced, after));
			} else if (before > 0 && after > 0) {
				setNotice(t('notSent'));
			}
		} catch {
			setQueueCount(countOfflineActions(wg.shareCode, { memberId: identity.memberId }));
			setNotice(getOfflineSyncFailureMessage());
		} finally {
			syncingRef.current = false;
			setSyncing(false);
		}
	}

	if (!online) {
		return (
			<output
				ref={bannerRef}
				data-offline-banner
				className="bg-muted text-foreground border-border sticky top-0 z-20 grid min-h-[calc(44px+1rem+1px)] grid-cols-[minmax(0,1fr)] content-center border-b px-4 py-2 text-meta font-medium"
				aria-live="polite"
			>
				<div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-x-3">
					<div className="flex min-w-0 flex-[1_1_8rem] items-center gap-2">
						<WifiOff className="h-4 w-4 shrink-0" aria-hidden />
						<span>
							{t('offline', {
								detail: queueCount > 0 ? formatOfflineQueueCount(queueCount) : t('pending'),
							})}
						</span>
					</div>
					<Link
						href="/offline"
						aria-label={t('reviewLabel')}
						className="focus-visible:ring-ring inline-flex min-h-11 shrink-0 items-center rounded-md px-2 underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
					>
						{t('review')}
					</Link>
				</div>
			</output>
		);
	}

	if (queueCount === 0) return null;
	const replayUnsupported = !offlineQueueReplaySupported();
	const nothingToRetry = replayUnsupported || reviewCount >= queueCount;

	return (
		<output
			ref={bannerRef}
			data-offline-banner
			className="bg-card text-foreground border-border sticky top-0 z-20 grid min-h-[calc(44px+1rem+1px)] grid-cols-[minmax(0,1fr)] content-center border-b px-4 py-2 text-meta font-medium"
			aria-live="polite"
		>
			<div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-x-3">
				<Link
					href={settingsDataHref}
					className="flex min-h-11 min-w-0 flex-[1_1_8rem] items-center leading-snug text-pretty"
				>
					{notice ??
						(replayUnsupported
							? OFFLINE_REPLAY_UNSUPPORTED_NOTICE
							: nothingToRetry
								? formatOfflineReviewNeeded(reviewCount)
								: formatQueuedOfflineActions(queueCount))}
				</Link>
				{nothingToRetry ? null : (
					<Button
						type="button"
						variant="outline"
						onClick={() => void retry()}
						disabled={syncing}
						aria-label={syncing ? t('sendingLabel') : t('sendNowLabel')}
						className="min-h-11 shrink-0 text-meta"
					>
						{syncing ? <Spinner aria-hidden /> : notice ? <AlertCircle aria-hidden /> : null}
						{t('sendNow')}
					</Button>
				)}
			</div>
		</output>
	);
}
