'use client';

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
import { Badge } from '@/components/ui/badge';
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
	ItemGroup,
	ItemTitle,
} from '@/components/ui/item';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { formatEuroCents } from '@/core/utils/money';
import { formatRelativeTime, formatTimeFull } from '@/core/utils/time';
import { cn } from '@/shared/lib/cn';
import { Check, ChevronDown, MoreHorizontal, Pencil, Receipt, Trash2 } from 'lucide-react';
import { memo, useState } from 'react';
import type { Expense, ExpenseSplit } from './expense-types';

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
	currentMemberId,
	highlighted,
}: ExpenseRowProps) {
	const isPayer = expense.paidByMemberId === currentMemberId;
	const settledCount = expense.splits.filter((split) => split.settledAt !== null).length;
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [settleCandidate, setSettleCandidate] = useState<ExpenseSplit | null>(null);
	return (
		<li
			id={`expense-${expense.id}`}
			className={cn('scroll-mt-24', highlighted && 'rounded-lg ring-2 ring-ring')}
		>
			<Collapsible open={expanded} onOpenChange={() => onToggleExpand(expense.id)}>
				<Item variant="outline" className="items-start">
					<ItemContent className="min-w-0">
						<CollapsibleTrigger
							render={
								<Button
									variant="ghost"
									className="h-auto min-h-11 w-full justify-start whitespace-normal px-0 text-left"
								/>
							}
							aria-label={`Details für ${expense.description} ${formatEuroCents(expense.amountCents)}`}
						>
							<span className="min-w-0 flex-1 break-words">{expense.description}</span>
							<ChevronDown
								data-icon="inline-end"
								className={cn('shrink-0', expanded && 'rotate-180')}
							/>
						</CollapsibleTrigger>
						<ItemTitle className="line-clamp-none tabular-nums">
							{formatEuroCents(expense.amountCents)}
						</ItemTitle>
						<ItemDescription className="line-clamp-none">
							Bezahlt von {memberName(expense.paidByMemberId)} ·{' '}
							<time dateTime={expense.occurredAt} title={formatTimeFull(expense.occurredAt)}>
								{formatRelativeTime(expense.occurredAt)}
							</time>
						</ItemDescription>
						<div className="flex flex-wrap gap-1.5 pt-1">
							{expense.splits.length > 0 && (
								<Badge variant="secondary">
									{settledCount}/{expense.splits.length} beglichen
								</Badge>
							)}
							{expense.imageUrl && (
								<Badge variant="outline">
									<Receipt />
									Beleg
								</Badge>
							)}
						</div>
					</ItemContent>
					<ItemActions>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={<Button variant="ghost" size="icon" className="size-11" />}
								aria-label={`Aktionen für ${expense.description}`}
							>
								<MoreHorizontal />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuGroup>
									{isPayer && (
										<DropdownMenuItem
											onClick={() => onEdit(expense)}
											disabled={isPending(expense.id)}
										>
											<Pencil />
											Bearbeiten
										</DropdownMenuItem>
									)}
									<DropdownMenuItem
										variant="destructive"
										onClick={() => setDeleteOpen(true)}
										disabled={isPending(expense.id)}
									>
										<Trash2 />
										Entfernen
									</DropdownMenuItem>
								</DropdownMenuGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</ItemActions>
					<CollapsibleContent className="w-full">
						<Separator className="my-3" />
						{expense.imageUrl && (
							<Button
								variant="outline"
								render={
									<a
										href={expense.imageUrl}
										target="_blank"
										rel="noopener noreferrer"
										aria-label="Beleg öffnen"
									>
										<Receipt data-icon="inline-start" />
										Beleg öffnen
									</a>
								}
								nativeButton={false}
								className="mb-3 min-h-11"
							/>
						)}
						<ItemGroup aria-label="Ausgabenanteile" className="gap-1">
							{expense.splits.map((split) => {
								const settled = split.settledAt !== null;
								const ownShare = split.debtorMemberId === expense.paidByMemberId;
								return (
									<Item key={split.id} variant="muted" size="xs">
										<ItemContent className="min-w-0">
											<ItemTitle className="line-clamp-none break-words">
												{memberName(split.debtorMemberId)} · {formatEuroCents(split.amountCents)}
											</ItemTitle>
											<ItemDescription>
												{ownShare
													? 'Eigener Anteil der zahlenden Person'
													: settled
														? 'Als beglichen vermerkt'
														: `Offen an ${memberName(expense.paidByMemberId)}`}
											</ItemDescription>
										</ItemContent>
										<Button
											variant={settled ? 'secondary' : 'outline'}
											className="min-h-11"
											onClick={() => setSettleCandidate(split)}
											disabled={isPending(split.id)}
											aria-label={`${memberName(split.debtorMemberId)} Zahlung als ${settled ? 'offen' : 'beglichen'} markieren`}
										>
											{isPending(split.id) ? (
												<Spinner data-icon="inline-start" />
											) : (
												<Check data-icon="inline-start" />
											)}
											{settled ? 'Beglichen' : 'Offen'}
										</Button>
									</Item>
								);
							})}
						</ItemGroup>
						{expense.splits.length === 0 && (
							<p className="text-sm text-muted-foreground">Keine Anteile eingetragen.</p>
						)}
					</CollapsibleContent>
				</Item>
			</Collapsible>
			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Ausgabe entfernen?</AlertDialogTitle>
						<AlertDialogDescription>
							„{expense.description}“ mit {formatEuroCents(expense.amountCents)} und den zugehörigen
							Anteilen wird entfernt.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel className="min-h-11">Abbrechen</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							className="min-h-11"
							disabled={isPending(expense.id)}
							onClick={() => {
								setDeleteOpen(false);
								onDelete(expense.id);
							}}
						>
							Entfernen
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
							{settleCandidate?.settledAt ? 'Zahlung wieder öffnen?' : 'Bereits bezahlt?'}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{settleCandidate &&
								`${memberName(settleCandidate.debtorMemberId)} · ${formatEuroCents(settleCandidate.amountCents)} für „${expense.description}“, bezahlt von ${memberName(expense.paidByMemberId)}. ${settleCandidate.settledAt ? 'Dieser Anteil wird wieder als offen vermerkt.' : 'Dieser Anteil wird als beglichen vermerkt.'} Es wird kein Geld überwiesen.`}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel className="min-h-11">Abbrechen</AlertDialogCancel>
						<AlertDialogAction
							className="min-h-11"
							disabled={!settleCandidate || isPending(settleCandidate.id)}
							onClick={() => {
								if (settleCandidate) onToggleSettle(expense.id, settleCandidate);
								setSettleCandidate(null);
							}}
						>
							{settleCandidate?.settledAt ? 'Als offen markieren' : 'Zahlung verbuchen'}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</li>
	);
});
