'use client';

import { DeleteConfirmButton } from '@/components/ui/DeleteConfirmButton';
import type { Expense, ExpenseSplit } from '@/components/wg/ausgaben/expense-types';
import { MemberAvatar } from '@/components/wg/dashboard/MemberAvatar';
import { formatEuroCents } from '@/lib/money';
import { formatRelativeTime, formatTimeFull } from '@/lib/time';
import { Check, ChevronDown, Loader2, Pencil } from 'lucide-react';
import { memo } from 'react';

interface ExpenseRowProps {
	expense: Expense;
	expanded: boolean;
	onToggleExpand: (id: string) => void;
	onDelete: (id: string) => void;
	onEdit: (expense: Expense) => void;
	onToggleSettle: (expenseId: string, split: ExpenseSplit) => void;
	isPending: (id: string) => boolean;
	memberName: (id: string) => string;
	memberColor: (id: string) => string | null;
	currentMemberId: string;
	highlighted: boolean;
}

export const ExpenseRow = memo(function ExpenseRow({
	expense,
	expanded,
	onToggleExpand,
	onDelete,
	onEdit,
	onToggleSettle,
	isPending,
	memberName,
	memberColor,
	currentMemberId,
	highlighted,
}: ExpenseRowProps) {
	const isPayer = expense.paidByMemberId === currentMemberId;
	const settledCount = expense.splits.filter((s) => s.settledAt !== null).length;

	return (
		<li
			id={`expense-${expense.id}`}
			className={`scroll-mt-24 ${highlighted ? 'bg-[var(--accent)]/10 ring-2 ring-inset ring-[var(--accent)]' : ''}`}
		>
			{/* items-center keeps delete button vertically centered with the two-line content block */}
			<div className="group flex items-center gap-2 py-2.5 pl-3 pr-2 sm:pl-4 sm:pr-3">
				{expense.imageUrl && (
					// eslint-disable-next-line @next/next/no-img-element
					<img
						src={expense.imageUrl}
						alt={`Beleg: ${expense.description}`}
						className="h-10 w-10 shrink-0 rounded-md object-cover"
					/>
				)}
				<button
					type="button"
					onClick={() => onToggleExpand(expense.id)}
					aria-expanded={expanded}
					aria-controls={`expense-${expense.id}-splits`}
					aria-label={`Details für ${expense.description} ${formatEuroCents(expense.amountCents)}${
						expense.splits.length > 0 ? `, ${settledCount}/${expense.splits.length} beglichen` : ''
					}`}
					className="-mx-1 flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
				>
					{/* Content column grows, amount column is fixed-width right-aligned */}
					<div className="min-w-0 flex-1">
						<div className="flex items-baseline gap-2">
							{/* description truncates; overflow-hidden is implied by min-w-0 */}
							<span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-[var(--text-1)]">
								{expense.description}
							</span>
							{/* w-24 gives enough room for "1.234,56 €" without layout shift */}
							<span className="w-24 shrink-0 text-right text-[14.5px] font-medium tabular-nums text-[var(--text-1)]">
								{formatEuroCents(expense.amountCents)}
							</span>
						</div>
						<div className="mt-0.5 flex min-w-0 items-center gap-1 text-[12px] text-[var(--text-3)]">
							<MemberAvatar
								name={memberName(expense.paidByMemberId)}
								color={memberColor(expense.paidByMemberId)}
								size={14}
							/>
							<span className="truncate">{memberName(expense.paidByMemberId)}</span>
							<span className="shrink-0">·</span>
							<time
								dateTime={expense.occurredAt}
								title={formatTimeFull(expense.occurredAt)}
								className="shrink-0"
							>
								{formatRelativeTime(expense.occurredAt)}
							</time>
							{expense.splits.length > 0 && (
								<>
									<span className="shrink-0">·</span>
									<span className="shrink-0">
										{settledCount}/{expense.splits.length} beglichen
									</span>
								</>
							)}
						</div>
					</div>
					<ChevronDown
						className={`h-3.5 w-3.5 shrink-0 text-[var(--text-3)] transition-transform ${
							expanded ? 'rotate-180' : ''
						}`}
						aria-hidden
					/>
				</button>
				{isPayer && (
					<button
						type="button"
						onClick={() => onEdit(expense)}
						aria-label={`Ausgabe bearbeiten: ${expense.description}`}
						className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--text-3)] opacity-70 transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:opacity-100 sm:h-9 sm:w-9 sm:opacity-0 sm:group-hover:opacity-100"
					>
						<Pencil className="h-3.5 w-3.5" aria-hidden />
					</button>
				)}
				<DeleteConfirmButton
					id={expense.id}
					onConfirm={() => onDelete(expense.id)}
					pending={isPending(expense.id)}
					ariaLabel={`Ausgabe entfernen: ${expense.description}`}
					ariaLabelConfirm={`Ausgabe entfernen bestätigen: ${expense.description}`}
				/>
			</div>

			{expanded && expense.splits.length > 0 && (
				<ul
					id={`expense-${expense.id}-splits`}
					className="space-y-1 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3"
				>
					{expense.splits.map((s) => {
						const settled = s.settledAt !== null;
						return (
							<li key={s.id} className="flex items-center justify-between gap-3 text-[13px]">
								<div className="flex min-w-0 flex-1 items-center gap-1.5">
									<MemberAvatar
										name={memberName(s.debtorMemberId)}
										color={memberColor(s.debtorMemberId)}
										size={18}
									/>
									<span
										className={`min-w-0 truncate ${
											settled ? 'text-[var(--text-3)] line-through' : 'text-[var(--text-2)]'
										}`}
									>
										{memberName(s.debtorMemberId)}
									</span>
									<span
										className={`shrink-0 tabular-nums ${
											settled ? 'text-[var(--text-3)] line-through' : 'text-[var(--text-2)]'
										}`}
									>
										{formatEuroCents(s.amountCents)}
									</span>
								</div>
								{/* min 44px tap target height via py-2.5 + text height */}
								<button
									type="button"
									onClick={() => onToggleSettle(expense.id, s)}
									disabled={isPending(s.id)}
									aria-label={
										settled
											? `${memberName(s.debtorMemberId)} Zahlung als offen markieren`
											: `${memberName(s.debtorMemberId)} Zahlung als beglichen markieren`
									}
									className={`inline-flex min-h-[44px] min-w-[80px] items-center justify-center gap-1 rounded-md border px-2 text-[11.5px] font-medium transition-colors disabled:opacity-50 ${
										settled
											? 'border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]'
											: 'border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--text-1)]'
									}`}
								>
									{isPending(s.id) ? (
										<Loader2 className="h-3 w-3 animate-spin" aria-hidden />
									) : (
										<Check className="h-3 w-3" aria-hidden />
									)}
									{settled ? 'Beglichen' : 'Offen'}
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</li>
	);
});
