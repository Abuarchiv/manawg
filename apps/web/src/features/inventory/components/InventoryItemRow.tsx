'use client';

import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/button';
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroupEntry,
	ItemTitle,
} from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { useConfirmDelete } from '@/core/hooks/useConfirmDelete';
import { apiFetch } from '@/core/infra/api-client';
import { useInventoryQuantity } from '@/features/inventory/hooks/use-inventory-quantity';
import {
	type InventoryItemDto,
	type InventoryMutationItemDto,
	formatQuantity,
} from '@/features/inventory/inventory';
import { Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

interface InventoryItemRowProps {
	item: InventoryItemDto;
	shareCode: string;
	memberId: string;
	onChanged: (item?: InventoryMutationItemDto, deletedId?: string) => void;
	onEdit: (item: InventoryItemDto) => void;
	/** Deep-link hit (?highlight=<id>): ring around the row. */
	highlighted?: boolean;
}

// While a request runs, focus stays on the button (aria-disabled instead of disabled).
const BUSY_CLASS = 'aria-disabled:pointer-events-none aria-disabled:opacity-50';

export const InventoryItemRow = memo(function InventoryItemRow({
	item,
	highlighted = false,
	shareCode,
	memberId,
	onChanged,
	onEdit,
}: InventoryItemRowProps) {
	const toast = useToast();
	// One armed row per page and the shared timed fallback live in the hook.
	const confirmDelete = useConfirmDelete();
	const deleteArmed = confirmDelete.confirmId === item.id;
	const encodedShareCode = encodeURIComponent(shareCode);
	const [deleting, setDeleting] = useState(false);
	// Hide a deleted row right away; until the refetch lands it would stay tappable.
	const [removed, setRemoved] = useState(false);
	const rowRef = useRef<HTMLDivElement>(null);
	const trashRef = useRef<HTMLButtonElement>(null);
	const cancelRef = useRef<HTMLButtonElement | null>(null);
	const { quantity, action, tap } = useInventoryQuantity({
		item,
		shareCode,
		memberId,
		onChanged,
		onGone: markGone,
	});
	const pending = action !== null || deleting;
	const armed = deleteArmed || deleting;

	function markGone(): void {
		setRemoved(true);
		onChanged(undefined, item.id);
	}

	// Another member deleted the item meanwhile: drop the row instead of offering a retry that can never succeed.
	function dropIfGone(res: { status: number; error?: string }): boolean {
		if (res.status !== 404 || res.error !== 'item_not_found') return false;
		markGone();
		return true;
	}

	// The row disappears: focus moves to the neighboring row instead of BODY.
	function focusNeighborRow(): void {
		const rows = [...document.querySelectorAll<HTMLElement>('[data-inventory-row]')];
		const index = rows.findIndex((row) => row === rowRef.current);
		const neighbor = rows[index + 1] ?? rows[index - 1];
		const target = neighbor?.querySelector<HTMLElement>('button') ?? document.querySelector('h1');
		requestAnimationFrame(() => target?.focus());
	}

	async function remove(): Promise<void> {
		if (pending) return;
		setDeleting(true);
		try {
			const res = await apiFetch(
				`/api/wg/${encodedShareCode}/inventory/${encodeURIComponent(item.id)}`,
				{ method: 'DELETE', memberId },
			);
			if (res.ok) {
				focusNeighborRow();
				markGone();
			} else if (!dropIfGone(res)) {
				toast.error(`„${item.name}“ konnte nicht entfernt werden. Versuche es erneut.`);
			}
		} finally {
			setDeleting(false);
		}
	}

	function handleDelete(): void {
		if (pending) return;
		if (!confirmDelete.request(item.id)) {
			// The trash button is swapped out: focus moves to the safe choice.
			requestAnimationFrame(() => cancelRef.current?.focus());
			return;
		}
		void remove();
	}

	function handleCancel(): void {
		if (pending) return;
		confirmDelete.cancel();
	}

	// Cancel, another row arming and the timed fallback all swap the cancel button out.
	// The ref callback sees the focus before the node leaves the DOM; the effect then
	// moves it to the trash button instead of letting it fall back to BODY.
	const focusLost = useRef(false);
	const setCancelRef = useCallback((node: HTMLButtonElement | null) => {
		if (!node && document.activeElement === cancelRef.current) focusLost.current = true;
		cancelRef.current = node;
	}, []);
	useEffect(() => {
		if (armed || !focusLost.current) return;
		focusLost.current = false;
		trashRef.current?.focus();
	}, [armed]);

	if (removed) return null;

	return (
		// The wrapper is the group's list item (role=list); it also carries the divider
		// (the group's divide-y) and the jump target for ?highlight=.
		<ItemGroupEntry id={`inventory-${item.id}`} className="w-full min-w-0">
			<Item
				className={`flex-col items-stretch gap-2 ${highlighted ? 'ring-2 ring-inset ring-ring' : ''}`}
				aria-busy={pending}
			>
				<div
					ref={rowRef}
					data-inventory-row
					className="flex w-full min-w-0 flex-wrap items-center gap-2"
				>
					{/* In confirm mode a smaller base width, so Entfernen/Abbrechen stay in the row
					    and the list below does not jump. */}
					<ItemContent className={armed ? 'min-w-0 flex-[1_1_8rem]' : 'min-w-0 flex-[1_1_9rem]'}>
						<ItemTitle className="w-full min-w-0 gap-2 line-clamp-none">
							<span className="min-w-0 flex-1 break-words hyphens-auto" title={item.name}>
								{item.name}
							</span>
						</ItemTitle>
						<ItemDescription className="line-clamp-none tabular-nums">
							{formatQuantity(quantity, item.unit)} · Nachkaufen{'\u00a0'}ab{'\u00a0'}
							{item.threshold}
						</ItemDescription>
					</ItemContent>

					{/* pr-1.5: otherwise the 44 px hit area of the last button sticks out past the row edge. */}
					<ItemActions className="ml-auto flex-wrap justify-end gap-1.5 pr-1.5">
						{!armed && (
							<>
								<Button
									type="button"
									variant="outline"
									size="icon"
									onClick={() => tap(-1)}
									disabled={quantity === 0}
									focusableWhenDisabled
									className={BUSY_CLASS}
									aria-busy={action === 'decrement'}
									aria-label={
										quantity === 0
											? `${item.name} um eins verringern (Bestand 0)`
											: `${item.name} um eins verringern`
									}
								>
									{action === 'decrement' ? <Spinner aria-hidden /> : <Minus aria-hidden />}
								</Button>
								<Button
									type="button"
									variant="outline"
									size="icon"
									onClick={() => tap(1)}
									aria-busy={action === 'increment'}
									aria-label={`${item.name} um eins erhöhen`}
								>
									{action === 'increment' ? <Spinner aria-hidden /> : <Plus aria-hidden />}
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
									aria-busy={deleting}
									aria-label={`Endgültig entfernen: ${item.name}`}
									className={`px-3.5 ${BUSY_CLASS}`}
								>
									{deleting && <Spinner aria-hidden />}
									Entfernen
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									ref={setCancelRef}
									onClick={handleCancel}
									disabled={pending}
									focusableWhenDisabled
									className={BUSY_CLASS}
									aria-label={`Abbrechen: ${item.name} entfernen`}
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
			</Item>
		</ItemGroupEntry>
	);
});
