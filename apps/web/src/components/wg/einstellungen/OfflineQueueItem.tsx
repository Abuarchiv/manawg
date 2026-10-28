'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { buildQueueEditDraft, type QueueEditDraft } from '@/core/offline/drafts';
import { needsManualOfflineResolution } from '@/core/offline/offline-client';
import {
	explainOfflineActionFailure,
	getOfflineActionRisk,
	getOfflineActionSummary,
	type OfflineAction,
} from '@/core/offline/offline-queue';
import { cn } from '@/shared/lib/cn';

interface OfflineQueueItemProps {
	item: OfflineAction;
	inspectHref: string;
	conflictNote: string | undefined;
	syncing: boolean;
	checkingServer: boolean;
	onCheckServer: () => void;
	onEdit: (draft: QueueEditDraft) => void;
	onRemoveAttachment: () => void;
	onRemove: () => void;
}

/** One queued offline action with its status, risk, server comparison and actions. */
export function OfflineQueueItem({
	item,
	inspectHref,
	conflictNote,
	syncing,
	checkingServer,
	onCheckServer,
	onEdit,
	onRemoveAttachment,
	onRemove,
}: OfflineQueueItemProps) {
	const summary = getOfflineActionSummary(item);
	const fallback = explainOfflineActionFailure(0);
	const risk = getOfflineActionRisk(item);
	const editDraft = buildQueueEditDraft(item);
	const requiresManualReview = item.lastError?.startsWith('Server prüfen:') === true;
	const requiresManualResolution = needsManualOfflineResolution(item);
	const serverCheckLabel = `Server prüfen: ${summary.detail || summary.title}`;
	const actionLabel = summary.detail || summary.title;
	const rowBusy = syncing || checkingServer;
	return (
		<Item key={item.id} variant="outline" className="items-start">
			<ItemContent className="min-w-0">
				<ItemTitle>
					<span className="min-w-0 flex-1 truncate">{summary.title}</span>
					{item.attempts ? <Badge variant="destructive">{item.attempts}x</Badge> : null}
				</ItemTitle>
				<ItemDescription className="line-clamp-none">{summary.detail}</ItemDescription>
				{requiresManualResolution ? (
					<Alert className="mt-1" variant="destructive">
						<AlertDescription>{item.lastError}</AlertDescription>
					</Alert>
				) : (
					<p className="text-muted-foreground line-clamp-2 text-xs">
						{item.lastError ?? fallback.detail}
					</p>
				)}
				{risk && (
					<Alert className="mt-1">
						<AlertDescription>
							{risk.title}: {risk.detail}
						</AlertDescription>
					</Alert>
				)}
				{conflictNote && (
					<Alert className="mt-1">
						<AlertDescription>{conflictNote}</AlertDescription>
					</Alert>
				)}
				<div className="mt-2 flex flex-wrap gap-2">
					{requiresManualReview ? (
						<a
							href={inspectHref}
							className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'min-h-11')}
							aria-label={`WG-Eintrag prüfen: ${actionLabel}`}
						>
							WG-Eintrag prüfen
						</a>
					) : (
						<>
							<Button
								type="button"
								variant="outline"
								size="sm"
								aria-label={serverCheckLabel}
								onClick={onCheckServer}
								disabled={rowBusy}
							>
								{checkingServer && <Spinner aria-hidden />}
								{checkingServer ? 'Prüft…' : 'Server prüfen'}
							</Button>
							{editDraft ? (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									aria-label={`Offline-Aktion bearbeiten: ${actionLabel}`}
									onClick={() => onEdit(editDraft)}
									disabled={rowBusy}
								>
									Bearbeiten
								</Button>
							) : null}
							{item.payload.imageUrl ? (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									aria-label={`Anhang entfernen: ${actionLabel}`}
									onClick={onRemoveAttachment}
									disabled={rowBusy}
								>
									Anhang entfernen
								</Button>
							) : null}
						</>
					)}
					<Button
						type="button"
						variant="destructive"
						size="sm"
						aria-label={`Offline-Aktion verwerfen: ${actionLabel}`}
						onClick={onRemove}
						disabled={rowBusy}
					>
						Verwerfen
					</Button>
				</div>
			</ItemContent>
		</Item>
	);
}
