'use client';

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
	formatQuantity,
} from '@/features/inventory/inventory';
import { Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import { memo, useRef, useState } from 'react';

interface InventoryItemRowProps {
	item: InventoryItemDto;
	shareCode: string;
	memberId: string;
	onChanged: (item?: InventoryMutationItemDto, deletedId?: string) => void;
	onEdit: (item: InventoryItemDto) => void;
}

// Während einer Anfrage bleibt der Fokus auf dem Knopf (aria-disabled statt disabled).
const BUSY_CLASS = 'aria-disabled:pointer-events-none aria-disabled:opacity-50';

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
	onChanged,
	onEdit,
}: InventoryItemRowProps) {
	const encodedShareCode = encodeURIComponent(shareCode);
	const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
	const [error, setError] = useState<string | null>(null);
	// Hide a deleted row right away; until the refetch lands it would stay tappable.
	const [removed, setRemoved] = useState(false);
	const rowRef = useRef<HTMLDivElement>(null);
	const trashRef = useRef<HTMLButtonElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);
	const consumeIdempotencyKeyRef = useRef<string | null>(null);
	const restockIdempotencyKeyRef = useRef<string | null>(null);
	// Optimistisch: der Bestand ändert sich sofort beim Tippen; Erfolg ersetzt ihn durch den Serverwert,
	// Fehler setzen ihn im finally zurück (null = zeige den Serverstand).
	const [optimisticQuantity, setOptimisticQuantity] = useState<number | null>(null);
	const quantity = optimisticQuantity ?? item.quantity;
	const deleteConfirm = useConfirmDelete();
	const isDeleteArmed = deleteConfirm.confirmId === item.id;
	const pending = pendingAction !== null;
	const armed = isDeleteArmed || pendingAction === 'delete';

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

	// Die Zeile verschwindet: der Fokus geht an die Nachbarzeile statt auf BODY.
	function focusNeighborRow(): void {
		const rows = [...document.querySelectorAll<HTMLElement>('[data-inventory-row]')];
		const index = rows.findIndex((row) => row === rowRef.current);
		const neighbor = rows[index + 1] ?? rows[index - 1];
		const target = neighbor?.querySelector<HTMLElement>('button') ?? document.querySelector('h1');
		requestAnimationFrame(() => target?.focus());
	}

	async function remove(): Promise<void> {
		if (pending) return;
		setPendingAction('delete');
		setError(null);
		try {
			const res = await apiFetch(
				`/api/wg/${encodedShareCode}/inventory/${encodeURIComponent(item.id)}`,
				{ method: 'DELETE', memberId },
			);
			if (res.ok) {
				focusNeighborRow();
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
		if (!deleteConfirm.request(item.id)) {
			// Der Papierkorb wird ausgetauscht: der Fokus wandert auf die sichere Wahl.
			requestAnimationFrame(() => cancelRef.current?.focus());
			return;
		}
		deleteConfirm.cancel();
		void remove();
	}

	function handleCancel(): void {
		if (pending) return;
		deleteConfirm.cancel();
		requestAnimationFrame(() => trashRef.current?.focus());
	}

	if (removed) return null;

	return (
		<Item className="flex-col items-stretch gap-2" aria-busy={pending}>
			<div
				ref={rowRef}
				data-inventory-row
				className="flex w-full min-w-0 flex-wrap items-center gap-2"
			>
				{/* Im Bestätigungsmodus weniger Basisbreite, damit Entfernen/Abbrechen in der Zeile
				    bleiben und die Liste darunter nicht springt. */}
				<ItemContent className={armed ? 'min-w-0 flex-[1_1_7rem]' : 'min-w-0 flex-[1_1_9rem]'}>
					<ItemTitle className="w-full min-w-0 gap-2 line-clamp-none">
						<span className="min-w-0 flex-1 break-words" title={item.name}>
							{item.name}
						</span>
					</ItemTitle>
					<ItemDescription className="line-clamp-none tabular-nums">
						{formatQuantity(quantity, item.unit)} · Nachkaufen{'\u00a0'}ab{'\u00a0'}
						{item.threshold}
					</ItemDescription>
				</ItemContent>

				<ItemActions className="ml-auto flex-wrap gap-2">
					{!armed && (
						<>
							<Button
								type="button"
								variant="outline"
								size="icon"
								onClick={() => void changeQuantity(-1)}
								disabled={pending || quantity === 0}
								focusableWhenDisabled
								className={BUSY_CLASS}
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
								focusableWhenDisabled
								className={BUSY_CLASS}
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
						</>
					)}
					{armed ? (
						<>
							<Button
								type="button"
								variant="destructive"
								size="sm"
								onClick={handleDelete}
								disabled={pending}
								focusableWhenDisabled
								aria-busy={pendingAction === 'delete'}
								aria-label={`Endgültig entfernen: ${item.name}`}
								className={`px-3.5 ${BUSY_CLASS}`}
							>
								{pendingAction === 'delete' && <Spinner aria-hidden />}
								Entfernen
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								ref={cancelRef}
								onClick={handleCancel}
								disabled={pending}
								focusableWhenDisabled
								className={BUSY_CLASS}
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
							ref={trashRef}
							onClick={handleDelete}
							disabled={pending}
							focusableWhenDisabled
							aria-label={`${item.name} entfernen`}
							className={`text-muted-foreground hover:text-destructive active:text-destructive ${BUSY_CLASS}`}
						>
							<Trash2 aria-hidden />
						</Button>
					)}
				</ItemActions>
			</div>
			{error && (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			)}
		</Item>
	);
});
