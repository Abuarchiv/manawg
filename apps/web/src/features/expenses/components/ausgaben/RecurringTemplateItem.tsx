'use client';

import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
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
	ItemFooter,
	ItemTitle,
} from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { formatEuroCents } from '@/core/utils/money';
import { formatRelativeTime, formatShortDate, parseTimestamp } from '@/core/utils/time';
import type { RecurringExpense } from '@/features/expenses/expense-types';
import {
	canBookRecurringTemplate,
	canManageRecurringTemplate,
	getRecurringExpenseHref,
	wasRecurringExpenseAlreadyCreated,
} from '@/features/expenses/recurring-expenses';
import { cn } from '@/shared/lib/cn';

interface RecurringTemplateItemProps {
	item: RecurringExpense;
	shareCode: string;
	/** The template the page was opened for via `?recurring=`. */
	highlighted: boolean;
	/** A template action runs, for this template or any other. */
	pending: boolean;
	/** This template is being booked as an expense right now. */
	creating: boolean;
	memberName: (id: string) => string;
	currentMemberId: string;
	isAdmin: boolean;
	onCreate: (item: RecurringExpense) => void;
	onEdit: (item: RecurringExpense) => void;
	onRequestDelete: (item: RecurringExpense) => void;
}

export function RecurringTemplateItem({
	item,
	shareCode,
	highlighted,
	pending,
	creating,
	memberName,
	currentMemberId,
	isAdmin,
	onCreate,
	onEdit,
	onRequestDelete,
}: RecurringTemplateItemProps): React.ReactElement {
	const paused = Boolean(item.pausedAt);
	const alreadyCreated = !paused && wasRecurringExpenseAlreadyCreated(item);
	const nextDueAt = parseTimestamp(item.nextDueAt);
	const due = !paused && nextDueAt !== null && nextDueAt <= Date.now();
	const canManage = canManageRecurringTemplate(item, currentMemberId, isAdmin);
	// The server refuses a booking for someone else's payment without a share of one's own.
	const canBook = canBookRecurringTemplate(item, currentMemberId);
	const primary = (due && canBook) || alreadyCreated;
	const menu =
		canManage || canBook ? (
			<ItemActions className="shrink-0 self-start">
				<DropdownMenu>
					<DropdownMenuTrigger
						render={<Button variant="ghost" size="icon" />}
						disabled={pending}
						aria-label={`Fixkosten-Aktionen: ${item.description}`}
					>
						<MoreHorizontal aria-hidden />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-52 max-w-[calc(100vw-2rem)]">
						<DropdownMenuGroup>
							{canManage && (
								<DropdownMenuItem
									onClick={() => onEdit(item)}
									disabled={pending}
									className="min-h-11"
									aria-label={`Fixkosten-Vorlage bearbeiten: ${item.description}`}
								>
									<Pencil aria-hidden />
									Vorlage bearbeiten
								</DropdownMenuItem>
							)}
							{canBook && (
								<DropdownMenuItem
									render={<Link href={getRecurringExpenseHref(shareCode, item.id)} />}
									disabled={pending || paused}
									className="min-h-11"
									aria-label={`Fixkosten-Ausgabe manuell erfassen: ${item.description}`}
								>
									Manuell erfassen
								</DropdownMenuItem>
							)}
							{canManage && (
								<DropdownMenuItem
									variant="destructive"
									onClick={() => onRequestDelete(item)}
									disabled={pending}
									className="min-h-11"
									aria-label={`Fixkosten-Vorlage löschen: ${item.description}`}
								>
									<Trash2 aria-hidden />
									Löschen
								</DropdownMenuItem>
							)}
						</DropdownMenuGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			</ItemActions>
		) : null;
	return (
		<Item
			id={`recurring-${item.id}`}
			variant="outline"
			className={cn('scroll-mt-24', highlighted && 'ring-2 ring-ring')}
		>
			<ItemContent className="min-w-0">
				<ItemTitle className="line-clamp-none break-words">{item.description}</ItemTitle>
				<ItemDescription className="line-clamp-none">
					<span className="font-mono tabular-nums">
						{formatEuroCents(item.amountCents, item.currency)}
					</span>{' '}
					· bezahlt von {memberName(item.paidByMemberId)} ·{' '}
					{paused ? 'pausiert' : `fällig ${formatShortDate(item.nextDueAt)}`}
					{item.lastCreatedAt ? ` · zuletzt ${formatRelativeTime(item.lastCreatedAt)}` : ''}
				</ItemDescription>
				<div className="flex flex-wrap gap-1.5 pt-1">
					{item.splits.map((split) => (
						<Badge key={split.debtorMemberId} variant="secondary" className="whitespace-normal">
							{memberName(split.debtorMemberId)}:{' '}
							<span className="font-mono tabular-nums">
								{formatEuroCents(split.amountCents, item.currency)}
							</span>
						</Badge>
					))}
				</div>
				{alreadyCreated && (
					<ItemDescription className="line-clamp-none">
						Für diese Fälligkeit vermutlich schon übernommen.
					</ItemDescription>
				)}
				{due && !alreadyCreated && !canBook && (
					<ItemDescription className="line-clamp-none">
						Nur beteiligte Personen können diese Fixkosten erfassen.
					</ItemDescription>
				)}
			</ItemContent>
			{!primary && menu}
			{primary && (
				<ItemFooter className="flex-row items-center justify-end gap-2">
					{due && !alreadyCreated && canBook ? (
						<Button
							className="flex-1"
							onClick={() => onCreate(item)}
							disabled={pending}
							aria-label={`Erfassen: ${item.description}`}
						>
							{creating && <Spinner data-icon="inline-start" />}
							Erfassen
						</Button>
					) : alreadyCreated ? (
						<Link
							href={getRecurringExpenseHref(shareCode, item.id)}
							className={cn(
								buttonVariants({ variant: 'outline', className: 'flex-1' }),
								pending && 'pointer-events-none opacity-50',
							)}
							aria-disabled={pending || undefined}
							tabIndex={pending ? -1 : undefined}
							aria-label={`Fixkosten-Ausgabe prüfen: ${item.description}`}
							onClick={(event) => {
								if (pending) event.preventDefault();
							}}
						>
							Prüfen
						</Link>
					) : null}
					{menu}
				</ItemFooter>
			)}
		</Item>
	);
}
