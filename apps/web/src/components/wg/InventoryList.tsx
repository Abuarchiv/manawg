'use client';

import { LIST_CARD } from '@/components/ui/styles';
import { InventoryAddModal } from '@/components/wg/InventoryAddModal';
import { InventoryItemRow } from '@/components/wg/InventoryItemRow';
import { QuickRestockSheet } from '@/components/wg/QuickRestockSheet';
import {
	INVENTORY_CATEGORIES,
	INVENTORY_CATEGORY_LABELS,
	type InventoryCategory,
	type InventoryItemDto,
	groupItemsByCategory,
} from '@/lib/wg/inventory';
import { Package, Plus, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';

interface InventoryListProps {
	items: InventoryItemDto[];
	shareCode: string;
	memberId: string;
	onChanged: () => void;
}

export function InventoryList({ items, shareCode, memberId, onChanged }: InventoryListProps) {
	const [addOpen, setAddOpen] = useState(false);
	const [quickOpen, setQuickOpen] = useState(false);
	const [editing, setEditing] = useState<InventoryItemDto | null>(null);
	const grouped = useMemo(() => groupItemsByCategory(items), [items]);
	const isEmpty = items.length === 0;

	function openEdit(item: InventoryItemDto): void {
		setEditing(item);
	}

	return (
		<div className="space-y-6">
			{isEmpty ? (
				<div className="rounded-lg border border-dashed border-[var(--border)] px-6 py-10 text-center">
					<Package
						className="mx-auto mb-3 h-7 w-7 text-[var(--text-3)]"
						strokeWidth={1.5}
						aria-hidden
					/>
					<p className="mx-auto max-w-[28ch] text-[13.5px] leading-relaxed text-[var(--text-2)]">
						Noch keine Vorräte erfasst. Beginne mit Klopapier, Spülmittel oder Nudeln.
					</p>
					<button
						type="button"
						onClick={() => setAddOpen(true)}
						className="mt-4 inline-flex h-11 items-center gap-2 rounded-md bg-[var(--text-1)] px-4 text-[13px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
					>
						<Plus className="h-4 w-4" aria-hidden />
						Ersten Vorrat anlegen
					</button>
				</div>
			) : (
				<div className="space-y-5">
					{INVENTORY_CATEGORIES.filter(
						(category): category is InventoryCategory => grouped[category].length > 0,
					).map((category) => (
						<section key={category} aria-labelledby={`inventory-${category}`} className="space-y-2">
							<h2
								id={`inventory-${category}`}
								className="text-[11.5px] font-medium uppercase tracking-[0.14em] text-[var(--text-3)]"
							>
								{INVENTORY_CATEGORY_LABELS[category]}
							</h2>
							<ul className={LIST_CARD}>
								{grouped[category].map((item) => (
									<InventoryItemRow
										key={item.id}
										item={item}
										shareCode={shareCode}
										memberId={memberId}
										onChanged={onChanged}
										onEdit={openEdit}
									/>
								))}
							</ul>
						</section>
					))}
				</div>
			)}

			{!isEmpty && (
				<div
					className="fixed right-4 z-30 flex flex-col gap-2 sm:right-6"
					style={{ bottom: 'calc(4.75rem + env(safe-area-inset-bottom, 0px))' }}
				>
					<button
						type="button"
						onClick={() => setQuickOpen(true)}
						aria-label="Klopapier-Quick-Add öffnen"
						className="inline-flex h-12 items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--accent-fg)] shadow-lg shadow-[var(--accent)]/30 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
					>
						<Zap className="h-4 w-4" aria-hidden />
						Quick-Add
					</button>
					<button
						type="button"
						onClick={() => setAddOpen(true)}
						aria-label="Vorrat hinzufügen"
						className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--text-1)] text-[var(--bg-base)] shadow-lg transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
					>
						<Plus className="h-5 w-5" aria-hidden />
					</button>
				</div>
			)}

			<InventoryAddModal
				open={addOpen || editing !== null}
				shareCode={shareCode}
				memberId={memberId}
				mode={editing ? 'edit' : 'create'}
				initial={editing}
				onClose={() => {
					setAddOpen(false);
					setEditing(null);
				}}
				onSaved={onChanged}
			/>
			<QuickRestockSheet
				open={quickOpen}
				items={items}
				shareCode={shareCode}
				memberId={memberId}
				onClose={() => setQuickOpen(false)}
				onChanged={onChanged}
			/>
		</div>
	);
}
