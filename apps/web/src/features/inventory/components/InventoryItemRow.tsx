'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { useConfirmDelete } from '@/core/hooks/useConfirmDelete';
import { apiFetch } from '@/core/infra/api-client';
import {
	type NotificationWarning,
	notificationWarningMessage,
} from '@/core/notifications/notification-warning';
import { createOfflineIdempotencyKey } from '@/core/offline/offline-queue';
import {
	type InventoryItemDto,
	type InventoryMutationItemDto,
	isBelowThreshold,
} from '@/features/inventory/inventory';
import { AlertCircle, Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import { memo, useRef, useState } from 'react';

interface InventoryItemRowProps {
	item: InventoryItemDto;
	shareCode: string;
	memberId: string;
	memberToken?: string | undefined;
	onChanged: (item?: InventoryMutationItemDto, deletedId?: string) => void;
	onEdit: (item: InventoryItemDto) => void;
}

type PendingAction = 'decrement' | 'increment' | 'delete';
type ConsumeResponse = {
	item: InventoryMutationItemDto;
	clamped: boolean;
	warning: NotificationWarning;
};

export const InventoryItemRow = memo(function InventoryItemRow({
	item,
	shareCode,
	memberId,
	memberToken,
	onChanged,
	onEdit,
}: InventoryItemRowProps) {
	const encodedShareCode = encodeURIComponent(shareCode);
	const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
	const [error, setError] = useState<string | null>(null);
	// Hide a deleted row right away; until the refetch lands it would stay tappable.
	const [removed, setRemoved] = useState(false);
	const consumeIdempotencyKeyRef = useRef<string | null>(null);
	const restockIdempotencyKeyRef = useRef<string | null>(null);
	// Optimistisch: der Bestand ändert sich sofort beim Tippen; Erfolg ersetzt ihn durch den Serverwert,
	// Fehler setzen ihn im finally zurück (null = zeige den Serverstand).
	const [optimisticQuantity, setOptimisticQuantity] = useState<number | null>(null);
	const quantity = optimisticQuantity ?? item.quantity;
	const lowStock = isBelowThreshold({ ...item, quantity });
	const deleteConfirm = useConfirmDelete();
	const isDeleteArmed = deleteConfirm.confirmId === item.id;
	const pending = pendingAction !== null;

	// Another member deleted the item meanwhile: drop the row instead of offering a retry that can never succeed.
	function dropIfGone(res: { status: number; error?: string }): boolean {
		if (res.status !== 404 || res.error !== 'item_not_found') return false;
		setRemoved(true);
		onChanged(undefined, item.id);
		return true;
	}

	async function changeQuantity(delta: number): Promise<void> {
		if (pending) return;
		setPendingAction(delta < 0 ? 'decrement' : 'increment');
		setError(null);
		setOptimisticQuantity(Math.max(0, item.quantity + delta));
		try {
			if (delta < 0) {
				const idempotencyKey = consumeIdempotencyKeyRef.current ?? createOfflineIdempotencyKey();
				if (!idempotencyKey) {
					setError('Aktualisierung konnte nicht sicher gesendet werden. Versuche es erneut.');
					return;
				}
				consumeIdempotencyKeyRef.current = idempotencyKey;
				const res = await apiFetch<ConsumeResponse>(
					`/api/wg/${encodedShareCode}/inventory/${encodeURIComponent(item.id)}/consume`,
					{
						method: 'POST',
						memberId,
						memberToken,
						headers: { 'Idempotency-Key': idempotencyKey },
						body: JSON.stringify({ delta }),
					},
				);
				if (res.ok) {
					consumeIdempotencyKeyRef.current = null;
					const warningMessage = notificationWarningMessage(
						res.data.warning,
						'Bestand aktualisiert',
					);
					if (res.data.clamped && warningMessage) {
						setError(`Bestand kann nicht unter 0 fallen. ${warningMessage}`);
					} else if (res.data.clamped) {
						setError('Bestand kann nicht unter 0 fallen.');
					} else if (warningMessage) {
						setError(warningMessage);
					}
					onChanged(res.data.item);
				} else if (dropIfGone(res)) {
					// row is gone
				} else if (res.status === 429) {
					setError('Zu viele Änderungen in kurzer Zeit. Bitte versuche es später erneut.');
				} else {
					if (res.status > 0 && res.status < 500) consumeIdempotencyKeyRef.current = null;
					setError('Aktualisierung fehlgeschlagen. Versuche es erneut.');
				}
			} else {
				const idempotencyKey = restockIdempotencyKeyRef.current ?? createOfflineIdempotencyKey();
				if (!idempotencyKey) {
					setError('Aktualisierung konnte nicht sicher gesendet werden. Versuche es erneut.');
					return;
				}
				restockIdempotencyKeyRef.current = idempotencyKey;
				const res = await apiFetch<{ item: InventoryMutationItemDto }>(
					`/api/wg/${encodedShareCode}/inventory/${encodeURIComponent(item.id)}`,
					{
						method: 'PATCH',
						memberId,
						memberToken,
						headers: { 'Idempotency-Key': idempotencyKey },
						body: JSON.stringify({ quantityDelta: delta }),
					},
				);
				if (res.ok) {
					restockIdempotencyKeyRef.current = null;
					onChanged(res.data.item);
				} else if (dropIfGone(res)) {
					// row is gone
				} else if (res.status === 429) {
					setError('Zu viele Änderungen in kurzer Zeit. Bitte versuche es später erneut.');
				} else {
					if (res.status > 0 && res.status < 500) restockIdempotencyKeyRef.current = null;
					setError('Aktualisierung fehlgeschlagen. Versuche es erneut.');
				}
			}
		} finally {
			setPendingAction(null);
			setOptimisticQuantity(null);
		}
	}

	async function remove(): Promise<void> {
		if (pending) return;
		setPendingAction('delete');
		setError(null);
		try {
			const res = await apiFetch(
				`/api/wg/${encodedShareCode}/inventory/${encodeURIComponent(item.id)}`,
				{ method: 'DELETE', memberId, memberToken },
			);
			if (res.ok) {
				setRemoved(true);
				onChanged(undefined, item.id);
			} else if (!dropIfGone(res)) {
				setError('Löschen fehlgeschlagen. Versuche es erneut.');
			}
		} finally {
			setPendingAction(null);
		}
	}

	function handleDelete(): void {
		if (pending) return;
		if (!deleteConfirm.request(item.id)) return;
		deleteConfirm.cancel();
		void remove();
	}

	if (removed) return null;

	return (
		<Item
			className="flex-col items-stretch gap-2 [contain-intrinsic-size:auto_4.5rem] [content-visibility:auto]"
			aria-busy={pending}
		>
			<div className="flex w-full min-w-0 flex-wrap items-center gap-2">
				<ItemContent className="min-w-0 flex-[1_1_9rem]">
					<ItemTitle className="w-full min-w-0 gap-2 line-clamp-none">
						<span className="min-w-0 flex-1 break-words" title={item.name}>
							{item.name}
						</span>
						{lowStock && (
							<Badge variant="destructive">
								<AlertCircle aria-hidden />
								Bald leer
							</Badge>
						)}
					</ItemTitle>
					<ItemDescription className="line-clamp-none tabular-nums">
						{quantity} {item.unit} · Nachkaufen ab{'\u00a0'}
						{item.threshold}
					</ItemDescription>
				</ItemContent>

				<ItemActions className="ml-auto flex-wrap gap-2">
					<Button
						type="button"
						variant="outline"
						size="icon"
						onClick={() => void changeQuantity(-1)}
						disabled={pending || quantity === 0}
						aria-busy={pendingAction === 'decrement'}
						aria-label={
							quantity === 0
								? `${item.name} um eins verringern (Bestand 0)`
								: `${item.name} um eins verringern`
						}
					>
						{pendingAction === 'decrement' ? <Spinner aria-hidden /> : <Minus aria-hidden />}
					</Button>
					<Button
						type="button"
						variant="outline"
						size="icon"
						onClick={() => void changeQuantity(1)}
						disabled={pending}
						aria-busy={pendingAction === 'increment'}
						aria-label={`${item.name} um eins erhöhen`}
					>
						{pendingAction === 'increment' ? <Spinner aria-hidden /> : <Plus aria-hidden />}
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onClick={() => onEdit(item)}
						disabled={pending}
						aria-label={`${item.name} bearbeiten`}
						className="text-muted-foreground"
					>
						<Pencil aria-hidden />
					</Button>
					{isDeleteArmed || pendingAction === 'delete' ? (
						<>
							<Button
								type="button"
								variant="destructive"
								size="sm"
								onClick={handleDelete}
								disabled={pending}
								aria-busy={pendingAction === 'delete'}
								aria-label={`Endgültig entfernen: ${item.name}`}
								className="px-3.5"
							>
								{pendingAction === 'delete' ? <Spinner aria-hidden /> : <Trash2 aria-hidden />}
								Endgültig entfernen
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => deleteConfirm.cancel()}
								disabled={pending}
								aria-label={`Abbrechen: Löschen von ${item.name}`}
							>
								Abbrechen
							</Button>
						</>
					) : (
						<Button
							type="button"
							variant="ghost"
							size="icon"
							onClick={handleDelete}
							disabled={pending}
							aria-label={`${item.name} entfernen`}
							className="text-muted-foreground hover:text-destructive active:text-destructive"
						>
							<Trash2 aria-hidden />
						</Button>
					)}
				</ItemActions>
			</div>
			{error && (
				<Alert variant="destructive">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}
		</Item>
	);
});
