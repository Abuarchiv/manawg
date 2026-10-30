'use client';

import { Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogMedia,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { ItemGroup } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { Section } from '@/components/wg/settings/Section';
import { apiFetch } from '@/core/infra/api-client';
import {
	buildDraftKey,
	buildQueueEditHref,
	isEmptyModuleDraft,
	type QueueEditDraft,
	readDraft,
	writeDraft,
} from '@/core/offline/drafts';
import {
	editQueuedPayload,
	needsManualOfflineResolution,
	readOfflineQueue,
	subscribeOfflineQueueChanges,
	syncOfflineActions,
	updateOfflineQueue,
} from '@/core/offline/offline-client';
import { offlineQueueCountMessage } from '@/core/offline/offline-copy';
import { titled } from '@/core/offline/offline-failure-copy';
import { isPendingImageToken, removePendingImage } from '@/core/offline/offline-images';
import {
	explainOfflineActionFailure,
	getOfflineActionSummary,
	type OfflineAction,
} from '@/core/offline/offline-queue';
import type { Locale } from '@/shared/i18n/locale';
import { type Message, useMessage } from '@/shared/i18n/message';
import { cn } from '@/shared/lib/cn';
import { OfflineQueueItem } from './OfflineQueueItem';
import { offlineActionInspectHref, SERVER_CHECKS } from './offline-queue-server-checks';

export function OfflineQueueSection({
	shareCode,
	memberId,
}: {
	shareCode: string;
	memberId: string;
}) {
	const t = useTranslations('offline.queue');
	const message = useMessage();
	const locale = useLocale() as Locale;
	const [items, setItems] = useState<OfflineAction[]>([]);
	const [syncing, setSyncing] = useState(false);
	const [conflictNotes, setConflictNotes] = useState<Record<string, Message>>({});
	const [checkingServerIds, setCheckingServerIds] = useState<Set<string>>(new Set());
	const [itemToDiscard, setItemToDiscard] = useState<OfflineAction | null>(null);
	const syncingRef = useRef(false);
	const checkingServerIdsRef = useRef<Set<string>>(new Set());
	const encodedShareCode = encodeURIComponent(shareCode);
	const isActiveMemberItem = useCallback(
		(item: OfflineAction): boolean => item.shareCode === shareCode && item.memberId === memberId,
		[memberId, shareCode],
	);
	const hasRetryableItems = items.some((item) => !needsManualOfflineResolution(item));

	const refresh = useCallback((): void => {
		setItems(readOfflineQueue().filter(isActiveMemberItem));
	}, [isActiveMemberItem]);

	useEffect(() => {
		refresh();
		return subscribeOfflineQueueChanges(refresh);
	}, [refresh]);

	function discardSummary(item: OfflineAction): string {
		const summary = getOfflineActionSummary(item);
		return message(summary.detail) || message(summary.title);
	}

	async function remove(item: OfflineAction): Promise<void> {
		const id = item.id;
		const saved = await updateOfflineQueue((actions) =>
			actions.filter((item) => item.id !== id || !isActiveMemberItem(item)),
		);
		if (!saved) {
			setConflictNotes((current) => ({
				...current,
				[id]: { key: 'offline.queue.storageBlockedDiscard' },
			}));
			return;
		}
		// The queued photo only lives in IndexedDB; drop it with its action.
		dropPendingImage(item.payload.imageUrl);
		refresh();
	}

	function dropPendingImage(imageUrl: unknown): void {
		if (typeof imageUrl === 'string' && isPendingImageToken(imageUrl)) {
			void removePendingImage(imageUrl, memberId).catch(() => undefined);
		}
	}

	async function removeAttachment(id: string): Promise<void> {
		const imageUrl = items.find((item) => item.id === id)?.payload.imageUrl;
		const saved = await updateOfflineQueue((actions) =>
			actions.map((item) =>
				item.id === id && isActiveMemberItem(item)
					? editQueuedPayload(item, { imageUrl: null })
					: item,
			),
		);
		if (!saved) {
			setConflictNotes((current) => ({
				...current,
				[id]: { key: 'offline.queue.storageBlockedAttachment' },
			}));
			return;
		}
		dropPendingImage(imageUrl);
		setConflictNotes((current) => ({
			...current,
			[id]: { key: 'offline.queue.attachmentRemoved' },
		}));
		refresh();
	}

	// The page that reads the draft is derived from the draft's own module, so
	// the draft key and the opened form can never disagree.
	function editHref(item: OfflineAction, draft: QueueEditDraft): string {
		return buildQueueEditHref(shareCode, draft.module, {
			openAbsencesPanel: item.type === 'absence.create',
		});
	}

	function edit(item: OfflineAction, draft: QueueEditDraft): void {
		const key = buildDraftKey(shareCode, memberId, draft.module);
		// Never clobber an unsaved form draft with queue-edit data — it would
		// be lost without any hint. Ask the user to resolve the form first.
		const existing = readDraft<Record<string, unknown>>(key);
		if (
			existing &&
			!isEmptyModuleDraft(draft.module, existing, memberId) &&
			JSON.stringify(existing) !== JSON.stringify(draft.draft)
		) {
			setConflictNotes((current) => ({
				...current,
				[item.id]: { key: 'offline.queue.draftExists' },
			}));
			return;
		}
		const saved = writeDraft(key, draft.draft);
		if (!saved) {
			setConflictNotes((current) => ({
				...current,
				[item.id]: { key: 'offline.queue.storageBlockedDraft' },
			}));
			return;
		}
		window.location.assign(editHref(item, draft));
	}

	function setConflictNote(id: string, note: Message): void {
		setConflictNotes((current) => ({ ...current, [id]: note }));
	}

	function setServerCheckError(id: string, status: number, error: string): void {
		if (error === 'not_a_member' || error === 'wg_not_found' || error === 'invalid_share_code') {
			setConflictNote(id, titled(explainOfflineActionFailure(status, error)));
			return;
		}
		setConflictNote(id, { key: 'offline.queue.compareFailed' });
	}

	async function checkServer(item: OfflineAction): Promise<void> {
		if (checkingServerIdsRef.current.has(item.id)) return;
		checkingServerIdsRef.current = new Set(checkingServerIdsRef.current).add(item.id);
		setCheckingServerIds(new Set(checkingServerIdsRef.current));
		try {
			await checkServerInner(item);
		} finally {
			const next = new Set(checkingServerIdsRef.current);
			next.delete(item.id);
			checkingServerIdsRef.current = next;
			setCheckingServerIds(next);
		}
	}

	async function checkServerInner(item: OfflineAction): Promise<void> {
		const check = SERVER_CHECKS[item.type];
		if (!check) {
			setConflictNote(item.id, { key: 'offline.queue.compareReady' });
			return;
		}
		const res = await apiFetch<unknown>(`/api/wg/${encodedShareCode}/${check.path}`, { memberId });
		if (!res.ok) {
			setServerCheckError(item.id, res.status, res.error);
			return;
		}
		setConflictNote(item.id, check.note(item.payload, res.data as never, locale));
	}

	async function retry(): Promise<void> {
		if (syncingRef.current || !hasRetryableItems) return;
		syncingRef.current = true;
		setSyncing(true);
		try {
			await syncOfflineActions(shareCode, { force: true, memberId });
			refresh();
		} finally {
			syncingRef.current = false;
			setSyncing(false);
		}
	}

	return (
		<Section title={t('title')}>
			<div className="grid gap-2 p-3">
				<div
					className={cn(
						'flex flex-wrap items-center justify-between gap-3',
						hasRetryableItems && 'min-h-11',
					)}
				>
					<p className="text-muted-foreground text-xs">
						{message(offlineQueueCountMessage(items.length))}
					</p>
					{hasRetryableItems && (
						<Button
							type="button"
							variant="outline"
							onClick={() => void retry()}
							disabled={syncing}
							aria-label={syncing ? t('syncingLabel') : t('retryLabel')}
						>
							{syncing && <Spinner aria-hidden />}
							{t('retry')}
						</Button>
					)}
				</div>
				{items.length > 0 && (
					<ItemGroup className="gap-2">
						{items.map((item) => (
							<OfflineQueueItem
								key={item.id}
								item={item}
								inspectHref={offlineActionInspectHref(shareCode, item)}
								conflictNote={conflictNotes[item.id]}
								syncing={syncing}
								checkingServer={checkingServerIds.has(item.id)}
								onCheckServer={() => void checkServer(item)}
								onEdit={(draft) => edit(item, draft)}
								onRemoveAttachment={() => void removeAttachment(item.id)}
								onRemove={() => setItemToDiscard(item)}
							/>
						))}
					</ItemGroup>
				)}
			</div>
			<AlertDialog
				open={itemToDiscard !== null}
				onOpenChange={(open) => {
					if (!open) setItemToDiscard(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogMedia>
							<Trash2 aria-hidden />
						</AlertDialogMedia>
						<AlertDialogTitle>{t('discardTitle')}</AlertDialogTitle>
						<AlertDialogDescription>
							{itemToDiscard && t('discardBody', { summary: discardSummary(itemToDiscard) })}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel autoFocus>{t('keep')}</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => {
								if (itemToDiscard) void remove(itemToDiscard);
								setItemToDiscard(null);
							}}
						>
							{t('discard')}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Section>
	);
}
