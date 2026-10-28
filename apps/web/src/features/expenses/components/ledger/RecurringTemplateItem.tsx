'use client';

import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
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
import { formatShortDate, parseTimestamp, relativeTimeMessage } from '@/core/utils/time';
import type { RecurringExpense } from '@/features/expenses/expense-types';
import {
	canBookRecurringTemplate,
	canManageRecurringTemplate,
	getRecurringExpenseHref,
	wasRecurringExpenseAlreadyCreated,
} from '@/features/expenses/recurring-expenses';
import { useMessage } from '@/shared/i18n/message';
import { cn } from '@/shared/lib/cn';
import { monoAmount } from './mono-amount';

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
	const locale = useLocale();
	const t = useTranslations('expenses.recurring');
	const message = useMessage();
	const money = (cents: number) => formatEuroCents(cents, item.currency, { locale });
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
						aria-label={t('actionsAria', { description: item.description })}
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
									aria-label={t('editAria', { description: item.description })}
								>
									<Pencil aria-hidden />
									{t('edit')}
								</DropdownMenuItem>
							)}
							{canBook && (
								<DropdownMenuItem
									render={<Link href={getRecurringExpenseHref(shareCode, item.id)} />}
									disabled={pending || paused}
									className="min-h-11"
									aria-label={t('manualAria', { description: item.description })}
								>
									{t('manual')}
								</DropdownMenuItem>
							)}
							{canManage && (
								<DropdownMenuItem
									variant="destructive"
									onClick={() => onRequestDelete(item)}
									disabled={pending}
									className="min-h-11"
									aria-label={t('deleteAria', { description: item.description })}
								>
									<Trash2 aria-hidden />
									{t('delete')}
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
					{t.rich('summary', {
						amount: monoAmount(money(item.amountCents)),
						payer: memberName(item.paidByMemberId),
						paused: paused ? 'true' : 'other',
						date: formatShortDate(item.nextDueAt, undefined, locale),
						hasLast: item.lastCreatedAt ? 'true' : 'other',
						last: item.lastCreatedAt
							? message(relativeTimeMessage(item.lastCreatedAt, Date.now(), locale))
							: '',
					})}
				</ItemDescription>
				<div className="flex flex-wrap gap-1.5 pt-1">
					{item.splits.map((split) => (
						<Badge key={split.debtorMemberId} variant="secondary" className="whitespace-normal">
							{t.rich('share', {
								name: memberName(split.debtorMemberId),
								amount: monoAmount(money(split.amountCents)),
							})}
						</Badge>
					))}
				</div>
				{alreadyCreated && (
					<ItemDescription className="line-clamp-none">{t('probablyBooked')}</ItemDescription>
				)}
				{due && !alreadyCreated && !canBook && (
					<ItemDescription className="line-clamp-none">{t('onlyParticipants')}</ItemDescription>
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
							aria-label={t('bookAria', { description: item.description })}
						>
							{creating && <Spinner data-icon="inline-start" />}
							{t('book')}
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
							aria-label={t('reviewAria', { description: item.description })}
							onClick={(event) => {
								if (pending) event.preventDefault();
							}}
						>
							{t('review')}
						</Link>
					) : null}
					{menu}
				</ItemFooter>
			)}
		</Item>
	);
}
