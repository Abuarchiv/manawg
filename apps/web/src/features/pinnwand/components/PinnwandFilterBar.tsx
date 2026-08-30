'use client';
import type { AnnouncementFilter } from '@/features/pinnwand/announcement-workflow';
import { KIND_OPTIONS, STATUS_FILTERS } from '@/features/pinnwand/components/constants';
import { Pin } from 'lucide-react';
import type React from 'react';

interface PinnwandFilterBarProps {
	filter: AnnouncementFilter;
	onFilterChange: React.Dispatch<React.SetStateAction<AnnouncementFilter>>;
}

export function PinnwandFilterBar({
	filter,
	onFilterChange,
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
		</div>
	);
}
