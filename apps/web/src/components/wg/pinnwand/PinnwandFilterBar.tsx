'use client';
import { KIND_OPTIONS, STATUS_FILTERS } from '@/components/wg/pinnwand/constants';
import type { AnnouncementFilter } from '@/lib/announcement-workflow';
import { Pin, RefreshCw, SlidersHorizontal } from 'lucide-react';
import type React from 'react';

interface PinnwandFilterBarProps {
	filter: AnnouncementFilter;
	onFilterChange: React.Dispatch<React.SetStateAction<AnnouncementFilter>>;
	compact: boolean;
	onToggleCompact: () => void;
	refreshing: boolean;
	onRefresh: () => void;
}

export function PinnwandFilterBar({
	filter,
	onFilterChange,
	compact,
	onToggleCompact,
	refreshing,
	onRefresh,
}: PinnwandFilterBarProps): React.ReactElement {
	return (
		<div className="flex flex-wrap items-center justify-between gap-2">
			<div className="flex flex-wrap items-center gap-1.5">
				{STATUS_FILTERS.map((option) => (
					<button
						key={option.value}
						type="button"
						onClick={() => onFilterChange((current) => ({ ...current, status: option.value }))}
						aria-pressed={filter.status === option.value}
						className={`inline-flex h-11 items-center rounded-full border px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
							filter.status === option.value
								? 'border-[var(--text-1)] bg-[var(--text-1)] text-[var(--bg-base)]'
								: 'border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--text-1)]'
						}`}
					>
						{option.label}
					</button>
				))}
				<select
					value={filter.kind}
					onChange={(e) =>
						onFilterChange((current) => ({
							...current,
							kind: e.target.value as AnnouncementFilter['kind'],
						}))
					}
					aria-label="Typ filtern"
					className="h-11 min-w-0 max-w-full rounded-full border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12px] font-medium text-[var(--text-2)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
				>
					<option value="all">Alle Typen</option>
					{KIND_OPTIONS.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
				<select
					value={filter.ownership ?? 'all'}
					onChange={(e) =>
						onFilterChange((current) => ({
							...current,
							ownership: e.target.value as NonNullable<AnnouncementFilter['ownership']>,
						}))
					}
					aria-label="Verantwortlichkeit filtern"
					className="h-11 min-w-0 max-w-full rounded-full border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12px] font-medium text-[var(--text-2)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
				>
					<option value="all">Alle Zuständigkeiten</option>
					<option value="mine">Von mir übernommen</option>
					<option value="untaken">Noch niemand</option>
				</select>
				<button
					type="button"
					onClick={() =>
						onFilterChange((current) => ({ ...current, pinnedOnly: !current.pinnedOnly }))
					}
					aria-pressed={filter.pinnedOnly}
					className={`inline-flex h-11 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
						filter.pinnedOnly
							? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
							: 'border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--text-1)]'
					}`}
				>
					<Pin className="h-3.5 w-3.5" aria-hidden />
					Fixiert
				</button>
			</div>
			<div className="flex items-center gap-1.5">
				<button
					type="button"
					onClick={onToggleCompact}
					aria-pressed={compact}
					aria-label="Kompakte Ansicht"
					className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
						compact
							? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
							: 'border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-2)] hover:text-[var(--text-1)]'
					}`}
				>
					<SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
				</button>
				<button
					type="button"
					onClick={onRefresh}
					disabled={refreshing}
					aria-label="Pinnwand aktualisieren"
					className="inline-flex h-11 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12px] font-medium text-[var(--text-2)] shadow-sm transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-60"
				>
					<RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
					Aktualisieren
				</button>
			</div>
		</div>
	);
}
