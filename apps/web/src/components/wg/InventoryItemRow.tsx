'use client';

import { DeleteConfirmButton } from '@/components/ui/DeleteConfirmButton';
import { ICON_BUTTON } from '@/components/ui/styles';
import { apiFetch } from '@/core/infra/api-client';
import { type InventoryItemDto, isBelowThreshold } from '@/lib/wg/inventory';
import { AlertCircle, Loader2, Minus, Pencil, Plus } from 'lucide-react';
import { memo, useState } from 'react';

interface InventoryItemRowProps {
	item: InventoryItemDto;
	shareCode: string;
	memberId: string;
	onChanged: () => void;
	onEdit: (item: InventoryItemDto) => void;
}

export const InventoryItemRow = memo(function InventoryItemRow({
	item,
	shareCode,
	memberId,
	onChanged,
	onEdit,
}: InventoryItemRowProps) {
	const encodedShareCode = encodeURIComponent(shareCode);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const lowStock = isBelowThreshold(item);

	async function changeQuantity(delta: number): Promise<void> {
		if (pending) return;
		setPending(true);
		setError(null);
		if (delta < 0) {
			const res = await apiFetch<{ item: InventoryItemDto; clamped: boolean }>(
				`/api/wg/${encodedShareCode}/inventory/${encodeURIComponent(item.id)}/consume`,
				{
					method: 'POST',
					memberId,
					body: JSON.stringify({ delta }),
				},
			);
			if (res.ok) {
				if (res.data.clamped) setError('Bestand kann nicht unter 0 fallen.');
				onChanged();
			} else if (res.status === 429) {
				setError('Zu viele Änderungen in kurzer Zeit. Bitte später erneut versuchen.');
			} else {
				setError('Aktualisierung fehlgeschlagen.');
			}
		} else {
			const res = await apiFetch<{ item: InventoryItemDto }>(
				`/api/wg/${encodedShareCode}/inventory/${encodeURIComponent(item.id)}`,
				{
					method: 'PATCH',
					memberId,
					body: JSON.stringify({ quantityDelta: delta }),
				},
			);
			if (res.ok) {
				onChanged();
			} else if (res.status === 429) {
				setError('Zu viele Änderungen in kurzer Zeit. Bitte später erneut versuchen.');
			} else {
				setError('Aktualisierung fehlgeschlagen.');
			}
		}
		setPending(false);
	}

	async function remove(): Promise<void> {
		if (pending) return;
		setPending(true);
		setError(null);
		const res = await apiFetch(
			`/api/wg/${encodedShareCode}/inventory/${encodeURIComponent(item.id)}`,
			{ method: 'DELETE', memberId },
		);
		if (res.ok) {
			onChanged();
		} else {
			setError('Löschen fehlgeschlagen.');
			setPending(false);
		}
	}

	return (
		<li className="flex flex-col gap-2 px-3 py-3 sm:px-4" aria-busy={pending}>
			<div className="flex items-center gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 items-baseline gap-2">
						<span
							className="truncate text-[14px] font-medium text-[var(--text-1)]"
							title={item.name}
						>
							{item.name}
						</span>
						{lowStock && (
							<span className="inline-flex items-center gap-1 rounded-full bg-[var(--danger)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--danger)]">
								<AlertCircle className="h-3 w-3" aria-hidden />
								niedrig
							</span>
						)}
					</div>
					<p className="mt-0.5 text-[12px] text-[var(--text-3)]">
						{item.quantity} {item.unit} · Schwelle {item.threshold}
					</p>
				</div>

				<div className="flex shrink-0 items-center gap-1">
					<button
						type="button"
						onClick={() => void changeQuantity(-1)}
						disabled={pending || item.quantity === 0}
						aria-label={
							item.quantity === 0
								? `${item.name} um eins verringern (Bestand 0)`
								: `${item.name} um eins verringern`
						}
						className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
					>
						{pending ? (
							<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
						) : (
							<Minus className="h-4 w-4" aria-hidden />
						)}
					</button>
					<button
						type="button"
						onClick={() => void changeQuantity(1)}
						disabled={pending}
						aria-label={`${item.name} um eins erhöhen`}
						className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
					>
						<Plus className="h-4 w-4" aria-hidden />
					</button>
					<button
						type="button"
						onClick={() => onEdit(item)}
						aria-label={`${item.name} bearbeiten`}
						className={ICON_BUTTON}
					>
						<Pencil className="h-4 w-4" aria-hidden />
					</button>
					<DeleteConfirmButton
						id={item.id}
						onConfirm={() => void remove()}
						pending={pending}
						ariaLabel={`${item.name} entfernen`}
						ariaLabelConfirm={`${item.name} entfernen bestätigen`}
					/>
				</div>
			</div>
			{error && (
				<p
					role="alert"
					className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-2.5 py-1.5 text-[12.5px] text-[var(--danger)]"
				>
					{error}
				</p>
			)}
		</li>
	);
});
