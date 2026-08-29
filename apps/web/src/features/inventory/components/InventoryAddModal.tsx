'use client';

import { ICON_BUTTON } from '@/components/ui/styles';
import { apiFetch } from '@/core/infra/api-client';
import {
	INVENTORY_CATEGORIES,
	INVENTORY_CATEGORY_LABELS,
	INVENTORY_LIMITS,
	INVENTORY_UNITS,
	type InventoryCategory,
	type InventoryUnit,
} from '@/features/inventory/inventory';
import { useFocusTrap } from '@/shared/lib/hooks/useFocusTrap';
import { Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface InventoryAddModalProps {
	open: boolean;
	shareCode: string;
	memberId: string;
	mode: 'create' | 'edit';
	initial?: {
		id: string;
		name: string;
		quantity: number;
		unit: string;
		threshold: number;
		category: string;
	} | null;
	onClose: () => void;
	onSaved: () => void;
}

const DEFAULT_UNIT: InventoryUnit = 'Stück';
const DEFAULT_CATEGORY: InventoryCategory = 'sonstiges';

function coerceUnit(unit: string | undefined): InventoryUnit {
	if (unit && (INVENTORY_UNITS as readonly string[]).includes(unit)) {
		return unit as InventoryUnit;
	}
	return DEFAULT_UNIT;
}

function coerceCategory(category: string | undefined): InventoryCategory {
	if (category && (INVENTORY_CATEGORIES as readonly string[]).includes(category)) {
		return category as InventoryCategory;
	}
	return DEFAULT_CATEGORY;
}

export function InventoryAddModal({
	open,
	shareCode,
	memberId,
	mode,
	initial,
	onClose,
	onSaved,
}: InventoryAddModalProps) {
	const encodedShareCode = encodeURIComponent(shareCode);
	const trapRef = useFocusTrap<HTMLDivElement>(open);
	const [name, setName] = useState('');
	const [quantity, setQuantity] = useState(0);
	const [unit, setUnit] = useState<InventoryUnit>(DEFAULT_UNIT);
	const [threshold, setThreshold] = useState(1);
	const [category, setCategory] = useState<InventoryCategory>(DEFAULT_CATEGORY);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		setName(initial?.name ?? '');
		setQuantity(initial?.quantity ?? 0);
		setUnit(coerceUnit(initial?.unit));
		setThreshold(initial?.threshold ?? 1);
		setCategory(coerceCategory(initial?.category));
		setError(null);
	}, [open, initial]);

	useEffect(() => {
		if (!open) return;
		const handleKey = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') onClose();
		};
		document.addEventListener('keydown', handleKey);
		return () => document.removeEventListener('keydown', handleKey);
	}, [open, onClose]);

	if (!open) return null;

	async function save(): Promise<void> {
		const trimmedName = name.trim();
		if (trimmedName.length === 0) {
			setError('Bitte gib einen Namen ein.');
			return;
		}
		setSaving(true);
		setError(null);
		const body = {
			name: trimmedName,
			quantity,
			unit,
			threshold,
			category,
		};
		const res =
			mode === 'edit' && initial
				? await apiFetch(
						`/api/wg/${encodedShareCode}/inventory/${encodeURIComponent(initial.id)}`,
						{ method: 'PATCH', memberId, body: JSON.stringify(body) },
					)
				: await apiFetch(`/api/wg/${encodedShareCode}/inventory`, {
						method: 'POST',
						memberId,
						body: JSON.stringify(body),
					});
		setSaving(false);
		if (res.ok) {
			onSaved();
			onClose();
		} else {
			setError('Speichern fehlgeschlagen.');
		}
	}

	return (
		<div
			ref={trapRef}
			// biome-ignore lint/a11y/useSemanticElements: native <dialog> UA display:none kills CSS exit animations on iOS Safari; use <div role="dialog"> (see native-dialog-css-transition-kill skill).
			role="dialog"
			aria-modal="true"
			aria-labelledby="inventory-add-title"
			className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6"
		>
			<div
				className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-[var(--bg-base)] p-5 shadow-xl sm:rounded-2xl"
				style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
			>
				<span className="sheet-handle" aria-hidden />
				<div className="flex items-start justify-between gap-3">
					<h2 id="inventory-add-title" className="text-base font-semibold text-[var(--text-1)]">
						{mode === 'edit' ? 'Vorrat bearbeiten' : 'Neuer Vorrat'}
					</h2>
					<button type="button" onClick={onClose} aria-label="Schließen" className={ICON_BUTTON}>
						<X className="h-4 w-4" aria-hidden />
					</button>
				</div>

				<form
					onSubmit={(event) => {
						event.preventDefault();
						void save();
					}}
					className="mt-4 space-y-3"
				>
					<label className="block text-[13px] font-medium text-[var(--text-1)]">
						Name
						<input
							type="text"
							value={name}
							onChange={(event) => setName(event.target.value)}
							maxLength={INVENTORY_LIMITS.NAME_MAX}
							required
							aria-required="true"
							aria-invalid={Boolean(error)}
							aria-describedby={error ? 'inventory-add-error' : undefined}
							className="mt-1 block h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-base text-[var(--text-1)] outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						/>
					</label>
					<div className="flex gap-2">
						<label className="block flex-1 text-[13px] font-medium text-[var(--text-1)]">
							Menge
							<input
								type="number"
								inputMode="numeric"
								value={quantity}
								min={INVENTORY_LIMITS.QUANTITY_MIN}
								max={INVENTORY_LIMITS.QUANTITY_MAX}
								onChange={(event) => setQuantity(Number(event.target.value) || 0)}
								className="mt-1 block h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-base text-[var(--text-1)] outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
							/>
						</label>
						<label className="block flex-1 text-[13px] font-medium text-[var(--text-1)]">
							Schwelle
							<input
								type="number"
								inputMode="numeric"
								value={threshold}
								min={INVENTORY_LIMITS.THRESHOLD_MIN}
								max={INVENTORY_LIMITS.THRESHOLD_MAX}
								onChange={(event) => setThreshold(Number(event.target.value) || 0)}
								className="mt-1 block h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-base text-[var(--text-1)] outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
							/>
						</label>
					</div>
					<div className="flex gap-2">
						<label className="block flex-1 text-[13px] font-medium text-[var(--text-1)]">
							Einheit
							<select
								value={unit}
								onChange={(event) => setUnit(event.target.value as InventoryUnit)}
								className="mt-1 block h-11 w-full appearance-none rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-base text-[var(--text-1)] outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
							>
								{INVENTORY_UNITS.map((u) => (
									<option key={u} value={u}>
										{u}
									</option>
								))}
							</select>
						</label>
						<label className="block flex-1 text-[13px] font-medium text-[var(--text-1)]">
							Kategorie
							<select
								value={category}
								onChange={(event) => setCategory(event.target.value as InventoryCategory)}
								className="mt-1 block h-11 w-full appearance-none rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-base text-[var(--text-1)] outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
							>
								{INVENTORY_CATEGORIES.map((cat) => (
									<option key={cat} value={cat}>
										{INVENTORY_CATEGORY_LABELS[cat]}
									</option>
								))}
							</select>
						</label>
					</div>
					{error && (
						<p
							id="inventory-add-error"
							role="alert"
							className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-2.5 py-1.5 text-[12.5px] text-[var(--danger)]"
						>
							{error}
						</p>
					)}
					<div className="flex justify-end gap-2 pt-2">
						<button
							type="button"
							onClick={onClose}
							className="inline-flex h-11 items-center rounded-xl border border-[var(--border)] px-4 text-[13px] font-medium text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						>
							Abbrechen
						</button>
						<button
							type="submit"
							disabled={saving}
							className="inline-flex h-11 items-center gap-2 rounded-xl bg-[var(--text-1)] px-4 text-[13px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
						>
							{saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
							Speichern
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
