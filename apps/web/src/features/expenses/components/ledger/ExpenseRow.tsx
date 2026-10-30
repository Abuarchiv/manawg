'use client';

import { Check, MoreHorizontal, Pencil, Receipt, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { memo, useState } from 'react';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemEntry,
	ItemGroup,
	ItemTitle,
} from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { MemberAvatar } from '@/components/wg/MemberAvatar';
import { formatEuroCents } from '@/core/utils/money';
import { formatTimeFull } from '@/core/utils/time';
import { type ExpenseImpact, getExpenseImpact } from '@/features/expenses/expense-impact';
import type { Expense, ExpenseSplit } from '@/features/expenses/expense-types';
import { cn } from '@/shared/lib/cn';
import { monoAmount } from './mono-amount';

const IMPACT_KEY = {
	lent: 'impactLent',
	owe: 'impactOwe',
	settled: 'impactSettled',
	own: 'impactOwn',
	none: 'impactNone',
} as const satisfies Record<ExpenseImpact['kind'], string>;

interface ExpenseRowProps {
	expense: Expense;
	expanded: boolean;
	onToggleExpand: (id: string) => void;
	onDelete: (id: string) => void;
	onEdit: (expense: Expense) => void;
	onToggleSettle: (expenseId: string, split: ExpenseSplit) => void;
	pendingIds: ReadonlySet<string>;
	memberName: (id: string) => string;
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
	pendingIds,
	memberName,
	currentMemberId,
	highlighted,
}: ExpenseRowProps) {
	const locale = useLocale();
	const t = useTranslations('expenses.row');
	const tCategories = useTranslations('expenses.categories');
	const money = (cents: number) => formatEuroCents(cents, expense.currency, { locale });
	// An offline-queued expense has only a placeholder id until it syncs; the
	// server knows nothing to edit, delete or settle yet.
	const locked = pendingIds.has(expense.id) || expense.id.startsWith('pending:');
	const isPayer = expense.paidByMemberId === currentMemberId;
	// The server lets only the payer or a debtor delete an expense.
	const canDelete =
		isPayer || expense.splits.some((split) => split.debtorMemberId === currentMemberId);
	const impact = getExpenseImpact(expense, currentMemberId);
	const who = (id: string) => (id === currentMemberId ? t('you') : memberName(id));
	const shareStatusLabel = (split: ExpenseSplit, ownShare: boolean): string => {
		if (ownShare) return t('statusOwn');
		if (split.amountCents === 0) return t('statusNone');
		if (split.settledAt !== null) return t('statusPaid');
		return isPayer
			? t('statusOpenToYou')
			: t('statusOpenTo', { name: memberName(expense.paidByMemberId) });
	};
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [settleCandidate, setSettleCandidate] = useState<ExpenseSplit | null>(null);
	return (
		<li
			id={`expense-${expense.id}`}
			className={cn(
				'scroll-mt-24 [contain-intrinsic-size:auto_4.5rem] [content-visibility:auto]',
				highlighted && 'ring-2 ring-inset ring-ring',
			)}
		>
			<Collapsible open={expanded} onOpenChange={() => onToggleExpand(expense.id)}>
				<Item className="gap-0.5 rounded-none py-1 pr-1.5 pl-3">
					<ItemContent className="min-w-0">
						<CollapsibleTrigger
							render={
								<Button
									variant="ghost"
									className="h-auto w-full items-start justify-start gap-2.5 whitespace-normal px-0 py-1 text-left hover:bg-transparent aria-expanded:bg-transparent"
								/>
							}
						>
							<MemberAvatar name={memberName(expense.paidByMemberId)} size={28} />
							{/* Amount to the right of the text; only when the row gets too narrow (large text) it goes below. */}
							<span className="@container flex min-w-0 flex-1">
								<span className="flex min-w-0 flex-1 flex-col gap-1 @[15rem]:flex-row @[15rem]:gap-3">
									<span className="flex min-w-0 flex-1 flex-col gap-0.5">
										<span className="sr-only">{t('openDetails')}</span>
										<span className="line-clamp-2 min-w-0 hyphens-auto text-body font-medium leading-snug [overflow-wrap:break-word]">
											{expense.description}
										</span>
										<span className="text-meta leading-normal font-normal text-muted-foreground">
											{/* The same amount already appears on the right; on the left only when the share differs. */}
											<span className="whitespace-nowrap">
												{t('paidBy', {
													who: isPayer ? 'self' : 'other',
													name: memberName(expense.paidByMemberId),
												})}
												{Math.abs(impact.cents) !== expense.amountCents && (
													<span className="tabular-nums"> {money(expense.amountCents)}</span>
												)}
											</span>
											{expense.category !== 'other' && (
												<>
													{' · '}
													{tCategories(expense.category)}
												</>
											)}
											{expense.imageUrl && (
												<>
													{' · '}
													<Receipt aria-hidden className="inline size-3.5 align-[-2px]" />
													<span className="sr-only">{t('receipt')}</span>
												</>
											)}
										</span>
									</span>
									{/* As in Splitwise: the right side shows what the expense means for you. */}
									<span className="flex shrink-0 flex-row flex-wrap items-baseline gap-x-1.5 @[15rem]:flex-col @[15rem]:items-end @[15rem]:gap-0.5 @[15rem]:text-right">
										<span
											className={cn(
												'whitespace-nowrap font-mono text-body leading-snug tabular-nums',
												impact.kind === 'lent'
													? 'text-settled'
													: impact.kind === 'owe'
														? 'text-destructive'
														: 'text-muted-foreground',
											)}
										>
											{money(impact.cents)}
										</span>
										<span className="whitespace-nowrap text-meta font-normal text-muted-foreground">
											{t(IMPACT_KEY[impact.kind])}
										</span>
									</span>
								</span>
							</span>
						</CollapsibleTrigger>
					</ItemContent>
					<ItemActions className="shrink-0">
						{canDelete && (
							<DropdownMenu>
								<DropdownMenuTrigger
									render={<Button variant="ghost" size="icon" />}
									aria-label={t('actionsFor', { description: expense.description })}
								>
									<MoreHorizontal />
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuGroup>
										{isPayer && (
											<DropdownMenuItem onClick={() => onEdit(expense)} disabled={locked}>
												<Pencil />
												{t('edit')}
											</DropdownMenuItem>
										)}
										<DropdownMenuItem
											variant="destructive"
											onClick={() => setDeleteOpen(true)}
											disabled={locked}
										>
											<Trash2 />
											{t('delete')}
										</DropdownMenuItem>
									</DropdownMenuGroup>
								</DropdownMenuContent>
							</DropdownMenu>
						)}
					</ItemActions>
					<CollapsibleContent className="w-full pr-1.5 pb-2">
						{/* The week is already a heading; the exact time only appears in the details. */}
						<p className="mb-2 text-xs text-muted-foreground">
							<time dateTime={expense.occurredAt}>
								{formatTimeFull(expense.occurredAt, locale)}
							</time>
							{expense.id.startsWith('pending:') && ` · ${t('pendingNote')}`}
						</p>
						{expense.imageUrl && (
							<Button
								variant="outline"
								render={
									<a href={expense.imageUrl} target="_blank" rel="noopener noreferrer">
										<Receipt data-icon="inline-start" />
										{t('openReceipt')}
									</a>
								}
								nativeButton={false}
								className="mb-3"
							/>
						)}
						<ItemGroup aria-label={t('sharesAria')} className="gap-1">
							{expense.splits.map((split) => {
								const settled = split.settledAt !== null;
								const ownShare = split.debtorMemberId === expense.paidByMemberId;
								// The server lets only the payer or the debtor of a share change its state.
								const canSettle = isPayer || split.debtorMemberId === currentMemberId;
								return (
									<ItemEntry key={split.id} variant="muted" size="xs" className="flex-wrap">
										<ItemContent className="min-w-0 flex-[1_1_8rem]">
											<ItemTitle className="line-clamp-none break-words">
												{who(split.debtorMemberId)} ·{' '}
												<span className="font-mono tabular-nums">{money(split.amountCents)}</span>
											</ItemTitle>
											<ItemDescription>{shareStatusLabel(split, ownShare)}</ItemDescription>
										</ItemContent>
										{!ownShare && canSettle && split.amountCents > 0 && (
											<Button
												variant={settled ? 'secondary' : 'outline'}
												size="sm"
												className="ml-auto"
												onClick={() => setSettleCandidate(split)}
												disabled={pendingIds.has(split.id) || locked}
												aria-label={t(settled ? 'markOpenAria' : 'markPaidAria', {
													name: who(split.debtorMemberId),
												})}
											>
												{pendingIds.has(split.id) ? (
													<Spinner data-icon="inline-start" />
												) : (
													<Check data-icon="inline-start" />
												)}
												{settled ? t('markOpen') : t('markPaid')}
											</Button>
										)}
									</ItemEntry>
								);
							})}
						</ItemGroup>
						{expense.splits.length === 0 && (
							<p className="text-sm text-muted-foreground">{t('noShares')}</p>
						)}
					</CollapsibleContent>
				</Item>
			</Collapsible>
			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
						<AlertDialogDescription>
							{t.rich('deleteBody', {
								description: expense.description,
								amount: monoAmount(money(expense.amountCents)),
							})}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel className="min-h-11">{t('cancel')}</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							className="min-h-11"
							disabled={locked}
							onClick={() => {
								setDeleteOpen(false);
								onDelete(expense.id);
							}}
						>
							{t('delete')}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<AlertDialog
				open={settleCandidate !== null}
				onOpenChange={(open) => {
					if (!open) setSettleCandidate(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{settleCandidate?.settledAt ? t('markOpenTitle') : t('markPaidTitle')}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{settleCandidate &&
								t.rich(settleCandidate.settledAt ? 'markOpenBody' : 'markPaidBody', {
									who: who(settleCandidate.debtorMemberId),
									amount: monoAmount(money(settleCandidate.amountCents)),
									description: expense.description,
									payer: isPayer ? 'you' : 'other',
									payerName: memberName(expense.paidByMemberId),
								})}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel className="min-h-11">{t('cancel')}</AlertDialogCancel>
						<AlertDialogAction
							className="min-h-11"
							disabled={!settleCandidate || pendingIds.has(settleCandidate.id) || locked}
							onClick={() => {
								if (settleCandidate) onToggleSettle(expense.id, settleCandidate);
								setSettleCandidate(null);
							}}
						>
							{settleCandidate?.settledAt ? t('markOpen') : t('markPaid')}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</li>
	);
});
