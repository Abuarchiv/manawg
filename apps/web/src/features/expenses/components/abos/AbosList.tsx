'use client';

import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { AboRow } from '@/features/expenses/components/abos/AboRow';
import type { Abo, AboFilter, MemberOption } from '@/features/expenses/components/abos/abos-types';
import { Repeat2 } from 'lucide-react';
import type { Ref } from 'react';

interface AbosListProps {
	abos: Abo[];
	members: MemberOption[];
	filter: AboFilter;
	pendingId: string | null;
	loadError?: string | null;
	/** Focus target after deleting a row; the container stays rendered even when the list is empty. */
	listRef?: Ref<HTMLElement>;
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
	loadError,
	listRef,
	onFilterChange,
	onEdit,
	onTogglePause,
	onDelete,
}: AbosListProps) {
	// The filter is only worthwhile when there are paused recurring expenses.
	const showFilter = abos.some((abo) => abo.pausedAt !== null);
	const filtered = applyFilter(abos, showFilter ? filter : 'all');

	return (
		<section ref={listRef} tabIndex={-1} className="flex flex-col gap-4 outline-none">
			{showFilter && (
				<ToggleGroup
					variant="segmented"
					value={[filter]}
					onValueChange={(values) => {
						const value = values[0];
						if (value === 'active' || value === 'paused' || value === 'all') onFilterChange(value);
					}}
					className="w-full"
					aria-label="Fixkosten filtern"
				>
					{FILTER_OPTIONS.map((option) => (
						<ToggleGroupItem key={option.value} value={option.value} className="flex-1">
							{option.label}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			)}
			<output aria-live="polite" className="sr-only">
				{filtered.length} Fixkosten sichtbar
			</output>
			{filtered.length === 0 ? (
				loadError && abos.length === 0 ? null : (
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<Repeat2 />
							</EmptyMedia>
							<EmptyTitle>
								{abos.length === 0
									? 'Noch keine Fixkosten'
									: `Keine ${filter === 'paused' ? 'pausierten' : 'aktiven'} Fixkosten`}
							</EmptyTitle>
							<EmptyDescription>
								{abos.length === 0
									? 'Lege Miete, Strom oder Netflix an, ManaWG bucht sie automatisch.'
									: filter === 'paused'
										? 'Keine Fixkosten sind pausiert.'
										: 'Alle Fixkosten sind pausiert. Zeige sie unter „Pausiert“.'}
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				)
			) : (
				<ul className="divide-y overflow-hidden rounded-xl border">
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
