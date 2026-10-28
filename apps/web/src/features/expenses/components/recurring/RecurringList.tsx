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
import { RecurringRow } from '@/features/expenses/components/recurring/RecurringRow';
import type {
	MemberOption,
	RecurringExpense,
	RecurringFilter,
} from '@/features/expenses/expense-types';

interface RecurringListProps {
	recurringExpenses: RecurringExpense[];
	members: MemberOption[];
	filter: RecurringFilter;
	pendingId: string | null;
	loadError?: string | null;
	/** Focus target after deleting a row; the container stays rendered even when the list is empty. */
	listRef?: Ref<HTMLElement>;
	onFilterChange: (next: RecurringFilter) => void;
	onEdit: (recurringExpense: RecurringExpense) => void;
	onTogglePause: (recurringExpense: RecurringExpense) => void;
	onDelete: (recurringExpense: RecurringExpense) => void;
}

const FILTER_OPTIONS: readonly RecurringFilter[] = ['active', 'paused', 'all'];

function applyFilter(
	recurringExpenses: RecurringExpense[],
	filter: RecurringFilter,
): RecurringExpense[] {
	if (filter === 'all') return recurringExpenses;
	if (filter === 'paused')
		return recurringExpenses.filter((recurringExpense) => recurringExpense.pausedAt !== null);
	return recurringExpenses.filter((recurringExpense) => recurringExpense.pausedAt === null);
}

export function RecurringList({
	recurringExpenses,
	members,
	filter,
	pendingId,
	loadError,
	listRef,
	onFilterChange,
	onEdit,
	onTogglePause,
	onDelete,
}: RecurringListProps) {
	const t = useTranslations('expenses-recurring');
	// The filter is only worthwhile when there are paused recurring expenses.
	const showFilter = recurringExpenses.some(
		(recurringExpense) => recurringExpense.pausedAt !== null,
	);
	const filtered = applyFilter(recurringExpenses, showFilter ? filter : 'all');

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
				loadError && recurringExpenses.length === 0 ? null : (
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<Repeat2 />
							</EmptyMedia>
							<EmptyTitle>
								{recurringExpenses.length === 0
									? t('list.emptyTitle')
									: filter === 'paused'
										? t('list.emptyPausedTitle')
										: t('list.emptyActiveTitle')}
							</EmptyTitle>
							<EmptyDescription>
								{recurringExpenses.length === 0
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
					{filtered.map((recurringExpense) => (
						<RecurringRow
							key={recurringExpense.id}
							recurringExpense={recurringExpense}
							members={members}
							pending={pendingId === recurringExpense.id}
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
