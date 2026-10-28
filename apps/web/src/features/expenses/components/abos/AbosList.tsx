'use client';

import { Repeat2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Ref } from 'react';
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { AboRow } from '@/features/expenses/components/abos/AboRow';
import type { Abo, AboFilter, MemberOption } from '@/features/expenses/expense-types';

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

const FILTER_OPTIONS: readonly AboFilter[] = ['active', 'paused', 'all'];

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
	const t = useTranslations('expenses-abos');
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
					aria-label={t('list.filterLabel')}
				>
					{FILTER_OPTIONS.map((option) => (
						<ToggleGroupItem key={option} value={option} className="flex-1">
							{t(`list.filter.${option}`)}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			)}
			<output aria-live="polite" className="sr-only">
				{t('list.visibleCount', { count: filtered.length })}
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
									? t('list.emptyTitle')
									: filter === 'paused'
										? t('list.emptyPausedTitle')
										: t('list.emptyActiveTitle')}
							</EmptyTitle>
							<EmptyDescription>
								{abos.length === 0
									? t('list.emptyHint')
									: filter === 'paused'
										? t('list.nonePaused')
										: t('list.allPaused')}
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
