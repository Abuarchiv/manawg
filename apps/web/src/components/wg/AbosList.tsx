'use client';

import { AboRow } from '@/components/wg/AboRow';
import type { Abo, AboFilter, MemberOption } from '@/components/wg/abos-types';
import { RefreshCw } from 'lucide-react';

interface AbosListProps {
	abos: Abo[];
	members: MemberOption[];
	filter: AboFilter;
	pendingId: string | null;
	onFilterChange: (next: AboFilter) => void;
	onEdit: (abo: Abo) => void;
	onTogglePause: (abo: Abo) => void;
	onDelete: (abo: Abo) => void;
}

const FILTER_OPTIONS: ReadonlyArray<{ value: AboFilter; label: string }> = [
	{ value: 'active', label: 'Aktiv' },
	{ value: 'paused', label: 'Pausiert' },
	{ value: 'all', label: 'Alle' },
];

function applyFilter(abos: Abo[], filter: AboFilter): Abo[] {
	if (filter === 'all') return abos;
	if (filter === 'paused') return abos.filter((abo) => abo.pausedAt !== null);
	return abos.filter((abo) => abo.pausedAt === null);
}

export function AbosList({
	abos,
	members,
	filter,
	pendingId,
	onFilterChange,
	onEdit,
	onTogglePause,
	onDelete,
}: AbosListProps) {
	const filtered = applyFilter(abos, filter);

	return (
		<section className="space-y-3">
			{/* biome-ignore lint/a11y/useSemanticElements: button toolbar group; <fieldset> would change layout semantics */}
			<div className="flex items-center gap-1.5" role="group" aria-label="Abos filtern">
				{FILTER_OPTIONS.map((option) => {
					const isActive = option.value === filter;
					return (
						<button
							key={option.value}
							type="button"
							onClick={() => onFilterChange(option.value)}
							aria-pressed={isActive}
							className={`inline-flex h-11 items-center rounded-md border px-3 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${isActive ? 'border-[var(--text-1)] bg-[var(--surface)] text-[var(--text-1)]' : 'border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--text-1)]'}`}
						>
							{option.label}
						</button>
					);
				})}
			</div>
			<output aria-live="polite" className="sr-only">
				{filtered.length === 1 ? '1 Abo sichtbar' : `${filtered.length} Abos sichtbar`}
			</output>
			{filtered.length === 0 ? (
				<output
					aria-live="polite"
					className="block rounded-lg border border-dashed border-[var(--border)] p-8 text-center"
				>
					{abos.length === 0 ? (
						<>
							<RefreshCw className="mx-auto mb-3 h-8 w-8 text-[var(--text-3)]" strokeWidth={1.5} />
							<p className="text-[13px] font-medium text-[var(--text-2)]">
								Noch keine Abos angelegt.
							</p>
							<p className="mt-1 text-[12px] text-[var(--text-3)]">
								Tippe + Neues Abo um regelmäßige Ausgaben zu verfolgen.
							</p>
						</>
					) : (
						<p className="text-[13px] text-[var(--text-3)]">
							Keine {filter === 'paused' ? 'pausierten' : 'aktiven'} Abos.
						</p>
					)}
				</output>
			) : (
				<ul className="space-y-3">
					{filtered.map((abo) => (
						<AboRow
							key={abo.id}
							abo={abo}
							members={members}
							pending={pendingId === abo.id}
							onEdit={onEdit}
							onTogglePause={onTogglePause}
							onDelete={onDelete}
						/>
					))}
				</ul>
			)}
		</section>
	);
}
