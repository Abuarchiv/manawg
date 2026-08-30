'use client';

import { DeleteConfirmButton } from '@/components/ui/DeleteConfirmButton';
import { formatEuroCents } from '@/core/utils/money';
import { formatRelativeTime, formatShortDate, parseTimestamp } from '@/core/utils/time';
import type { RecurringExpense } from '@/features/expenses/components/ausgaben/expense-types';
import {
	getRecurringExpenseHref,
	wasRecurringExpenseAlreadyCreated,
} from '@/features/expenses/recurring-expenses';
import { ChevronDown, Loader2 } from 'lucide-react';
import Link from 'next/link';

interface RecurringExpensesSectionProps {
	recurringExpenses: RecurringExpense[];
	recurringFilterActive: boolean;
	wgBaseHref: string;
	shareCode: string;
	hiddenRecurringCount: number;
	visibleRecurringExpenses: RecurringExpense[];
	recurringId: string | null;
	recurringActionPending: boolean;
	creatingRecurringId: string | null;
	isPending: (id: string) => boolean;
	onCreateFromTemplate: (item: RecurringExpense) => void;
	onEditTemplate: (item: RecurringExpense) => void;
	onDeleteTemplate: (item: RecurringExpense) => void;
	onPrepareNewExpense: () => void;
}

export function RecurringExpensesSection({
	recurringExpenses,
	recurringFilterActive,
	wgBaseHref,
	shareCode,
	hiddenRecurringCount,
	visibleRecurringExpenses,
	recurringId,
	recurringActionPending,
	creatingRecurringId,
	isPending,
	onCreateFromTemplate,
	onEditTemplate,
	onDeleteTemplate,
	onPrepareNewExpense,
}: RecurringExpensesSectionProps): React.ReactElement {
	return (
		<details
			id="recurring-expenses"
			open={recurringFilterActive || recurringId !== null}
			className={`rounded-lg border bg-[var(--bg-base)] p-4 ${
				recurringFilterActive
					? 'border-[var(--accent)] shadow-[0_0_0_3px_var(--accent-soft)]'
					: 'border-[var(--border)]'
			}`}
		>
			<summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
				<span className="min-w-0">
					<span className="block text-sm font-semibold text-[var(--text-1)]">
						Wiederkehrende Kosten
					</span>
					<span className="mt-0.5 block text-[12px] text-[var(--text-3)]">
						{recurringFilterActive
							? 'Fixkosten-Fokus: fällige Vorlagen können direkt übernommen werden.'
							: 'Fällige Vorlagen können direkt als Ausgabe übernommen werden.'}
					</span>
				</span>
				<span className="rounded-full border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-3)]">
					{recurringExpenses.length}
				</span>
				<ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-3)]" aria-hidden />
			</summary>
			<div className="mt-3">
				{hiddenRecurringCount > 0 && (
					<Link
						href={`${wgBaseHref}/ausgaben?filter=recurring`}
						className="mb-3 inline-flex h-11 items-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
					>
						Alle {recurringExpenses.length} Fixkosten anzeigen
					</Link>
				)}
				{recurringExpenses.length === 0 ? (
					<div className="rounded-md border border-dashed border-[var(--border)] px-3 py-4 text-[13px] text-[var(--text-3)]">
						<p>Es gibt noch keine Fixkosten-Vorlage.</p>
						<button
							type="button"
							onClick={onPrepareNewExpense}
							className="mt-3 inline-flex h-11 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						>
							Neue Ausgabe vorbereiten
						</button>
					</div>
				) : (
					<ul className="space-y-2">
						{visibleRecurringExpenses.map((item) => {
							const alreadyCreated = wasRecurringExpenseAlreadyCreated(item);
							const nextDueAt = parseTimestamp(item.nextDueAt);
							const due = nextDueAt !== null && nextDueAt <= Date.now();
							const highlighted = item.id === recurringId;
							return (
								<li
									key={item.id}
									id={`recurring-${item.id}`}
									className={`group scroll-mt-28 flex flex-col gap-2 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between ${
										highlighted
											? 'border-[var(--accent)] bg-[var(--accent)]/5 ring-2 ring-inset ring-[var(--accent)]'
											: 'border-[var(--border)]'
									}`}
								>
									<div className="min-w-0">
										<p className="truncate text-[13px] font-medium text-[var(--text-1)]">
											{item.description}
										</p>
										<p className="text-[12px] text-[var(--text-3)]">
											{formatEuroCents(item.amountCents)} · fällig {formatShortDate(item.nextDueAt)}
											{item.lastCreatedAt
												? ` · zuletzt ${formatRelativeTime(item.lastCreatedAt)}`
												: ''}
										</p>
										{alreadyCreated && (
											<p className="mt-1 text-[11.5px] text-[var(--accent)]">
												Für diese Fälligkeit vermutlich schon übernommen.
											</p>
										)}
									</div>
									<div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:justify-end">
										{due && !alreadyCreated && (
											<button
												type="button"
												onClick={() => onCreateFromTemplate(item)}
												disabled={recurringActionPending || isPending(item.id)}
												aria-label={`Fixkosten-Ausgabe direkt erstellen: ${item.description}`}
												className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-md bg-[var(--text-1)] px-3 text-[12px] font-medium text-[var(--bg-base)] disabled:opacity-50 sm:w-auto"
											>
												{creatingRecurringId === item.id && (
													<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
												)}
												Direkt erstellen
											</button>
										)}
										<div className="flex gap-2">
											<button
												type="button"
												onClick={() => onEditTemplate(item)}
												disabled={recurringActionPending || isPending(item.id)}
												aria-label={`Fixkosten-Vorlage bearbeiten: ${item.description}`}
												className="inline-flex h-11 flex-1 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
											>
												Vorlage
											</button>
											<Link
												href={getRecurringExpenseHref(shareCode, item.id)}
												aria-disabled={recurringActionPending || isPending(item.id)}
												aria-label={
													alreadyCreated
														? `Fixkosten-Ausgabe prüfen: ${item.description}`
														: `Fixkosten-Ausgabe manuell erfassen: ${item.description}`
												}
												tabIndex={recurringActionPending || isPending(item.id) ? -1 : undefined}
												onClick={(event) => {
													if (recurringActionPending || isPending(item.id)) event.preventDefault();
												}}
												className={`inline-flex h-11 flex-1 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors sm:flex-none ${
													recurringActionPending || isPending(item.id)
														? 'pointer-events-none cursor-not-allowed opacity-50'
														: ''
												}`}
											>
												{alreadyCreated ? 'Prüfen' : 'Manuell'}
											</Link>
											<DeleteConfirmButton
												id={`recurring-${item.id}`}
												onConfirm={() => onDeleteTemplate(item)}
												pending={recurringActionPending || isPending(item.id)}
												ariaLabel={`Fixkosten-Vorlage löschen: ${item.description}`}
												ariaLabelConfirm={`Fixkosten-Vorlage wirklich löschen: ${item.description}`}
											/>
										</div>
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</details>
	);
}
