'use client';

import { Button, buttonVariants } from '@/components/ui/button';
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { ExpenseRow } from '@/features/expenses/components/ausgaben/ExpenseRow';
import { ExpensesSkeleton } from '@/features/expenses/components/ausgaben/ExpensesSkeleton';
import type { Expense, ExpenseSplit } from '@/features/expenses/components/ausgaben/expense-types';
import { cn } from '@/shared/lib/cn';
import { FileInput } from 'lucide-react';
import Link from 'next/link';

interface ExpenseHistoryProps {
	expenseCount: number;
	weeks: Array<{ label: string; items: Expense[] }>;
	showSkeleton: boolean;
	initialLoading: boolean;
	loadFailed: boolean;
	hiddenCount: number;
	onShowMore: () => void;
	importHref: string;
	expanded: Set<string>;
	highlightedId: string | null;
	currentMemberId: string;
	pendingIds: ReadonlySet<string>;
	memberName: (id: string) => string;
	onToggleExpand: (id: string) => void;
	onDelete: (id: string) => void;
	onEdit: (expense: Expense) => void;
	onToggleSettle: (expenseId: string, split: ExpenseSplit) => void;
}

export function ExpenseHistory({
	expenseCount,
	weeks,
	showSkeleton,
	initialLoading,
	loadFailed,
	hiddenCount,
	onShowMore,
	importHref,
	expanded,
	highlightedId,
	currentMemberId,
	pendingIds,
	memberName,
	onToggleExpand,
	onDelete,
	onEdit,
	onToggleSettle,
}: ExpenseHistoryProps): React.ReactElement {
	return (
		<section className="flex flex-col gap-3" aria-label="Eingetragene Ausgaben">
			{expenseCount > 0 && <h2 className="sr-only">Verlauf</h2>}
			{showSkeleton ? (
				<ExpensesSkeleton />
			) : loadFailed && expenseCount === 0 ? null : expenseCount === 0 && !initialLoading ? (
				<Empty>
					<EmptyHeader>
						<EmptyTitle>Noch keine Ausgaben</EmptyTitle>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="flex flex-col gap-4">
					{weeks.map((week) => (
						<section key={week.label} aria-label={week.label} className="flex flex-col gap-1.5">
							<h3 className="px-0 text-[12px] font-medium text-muted-foreground">{week.label}</h3>
							<ul className="divide-y divide-border/60 overflow-hidden rounded-xl border">
								{week.items.map((expense) => (
									<ExpenseRow
										key={expense.id}
										expense={expense}
										expanded={expanded.has(expense.id)}
										onToggleExpand={onToggleExpand}
										onDelete={onDelete}
										onEdit={onEdit}
										onToggleSettle={onToggleSettle}
										pendingIds={pendingIds}
										memberName={memberName}
										currentMemberId={currentMemberId}
										highlighted={highlightedId === expense.id}
									/>
								))}
							</ul>
						</section>
					))}
					{hiddenCount > 0 && (
						<Button variant="outline" onClick={onShowMore}>
							Mehr anzeigen ({hiddenCount})
						</Button>
					)}
				</div>
			)}
			{/* Rarely needed: import at the end of the list instead of as an icon above the balance. */}
			{!showSkeleton && (
				<Link
					href={importHref}
					className={cn(
						buttonVariants({ variant: 'ghost', size: 'sm' }),
						'self-center text-muted-foreground',
					)}
				>
					<FileInput data-icon="inline-start" aria-hidden />
					Ausgaben importieren
				</Link>
			)}
		</section>
	);
}
