'use client';

import { ICON_BUTTON } from '@/components/ui/styles';
import { apiFetch } from '@/core/infra/api-client';
import type { InventoryItemDto } from '@/features/inventory/inventory';
import { useFocusTrap } from '@/shared/lib/hooks/useFocusTrap';
import { Loader2, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface QuickRestockSheetProps {
	open: boolean;
	items: InventoryItemDto[];
	shareCode: string;
	memberId: string;
	onClose: () => void;
	onChanged: () => void;
}

const QUICK_RESTOCK_LIMIT = 5;

export function QuickRestockSheet({
	open,
	items,
	shareCode,
	memberId,
	onClose,
	onChanged,
}: QuickRestockSheetProps) {
	const encodedShareCode = encodeURIComponent(shareCode);
	const trapRef = useFocusTrap<HTMLDivElement>(open);
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		const handleKey = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') onClose();
		};
		document.addEventListener('keydown', handleKey);
		return () => document.removeEventListener('keydown', handleKey);
	}, [open, onClose]);

	if (!open) return null;

	const sorted = [...items]
		.filter((item) => item.decrementCount30d > 0 || item.lastDecrementedAt !== null)
		.sort((a, b) => b.decrementCount30d - a.decrementCount30d)
		.slice(0, QUICK_RESTOCK_LIMIT);

	async function quickRestock(item: InventoryItemDto): Promise<void> {
		setPendingId(item.id);
		setError(null);
		const res = await apiFetch(
			`/api/wg/${encodedShareCode}/inventory/${encodeURIComponent(item.id)}`,
			{
				method: 'PATCH',
				memberId,
				body: JSON.stringify({ quantityDelta: 1 }),
			},
		);
		setPendingId(null);
		if (res.ok) {
			onChanged();
		} else {
			setError('Aktualisierung fehlgeschlagen.');
		}
	}

	return (
		<div
			ref={trapRef}
			// biome-ignore lint/a11y/useSemanticElements: native <dialog> UA display:none kills CSS exit animations on iOS Safari; use <div role="dialog"> (see native-dialog-css-transition-kill skill).
			role="dialog"
			aria-modal="true"
			aria-labelledby="quick-restock-title"
			className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
		>
			<div
				className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-[var(--bg-base)] p-5 shadow-xl sm:rounded-2xl"
				style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
			>
				<span className="sheet-handle" aria-hidden />
				<div className="flex items-start justify-between gap-3">
					<div>
						<h2 id="quick-restock-title" className="text-base font-semibold text-[var(--text-1)]">
							Schnell nachfüllen
						</h2>
						<p className="mt-0.5 text-[12.5px] text-[var(--text-3)]">
							Die fünf am häufigsten verbrauchten Vorräte der letzten 30 Tage.
						</p>
					</div>
					<button type="button" onClick={onClose} aria-label="Schließen" className={ICON_BUTTON}>
						<X className="h-4 w-4" aria-hidden />
					</button>
				</div>
				{error && (
					<p
						role="alert"
						className="mt-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-2.5 py-1.5 text-[12.5px] text-[var(--danger)]"
					>
						{error}
					</p>
				)}
				{sorted.length === 0 ? (
					<p className="mt-4 rounded-md border border-dashed border-[var(--border)] px-4 py-6 text-center text-[13px] text-[var(--text-3)]">
						Noch keine Verbrauchs-Daten vorhanden.
					</p>
				) : (
					<ul className="mt-4 space-y-2">
						{sorted.map((item) => (
							<li
								key={item.id}
								className="flex items-center gap-3 rounded-md border border-[var(--border)] px-3 py-2"
							>
								<div className="min-w-0 flex-1">
									<p className="truncate text-[14px] font-medium text-[var(--text-1)]">
										{item.name}
									</p>
									<p className="mt-0.5 text-[12px] text-[var(--text-3)]">
										{item.quantity} {item.unit} · {item.decrementCount30d}× in 30 Tagen
									</p>
								</div>
								<button
									type="button"
									onClick={() => void quickRestock(item)}
									disabled={pendingId === item.id}
									aria-label={`${item.name} um eins erhöhen`}
									className="inline-flex h-11 items-center gap-2 rounded-xl bg-[var(--text-1)] px-3 text-[13px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
								>
									{pendingId === item.id ? (
										<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
									) : (
										<Plus className="h-4 w-4" aria-hidden />
									)}
									+1
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
