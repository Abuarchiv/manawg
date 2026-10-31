'use client';

import { Check, Hand, MessageSquareMore, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { memo, type ReactElement, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from '@/components/ui/drawer';
import {
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemEntry,
	ItemTitle,
} from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { MemberAvatar } from '@/components/wg/MemberAvatar';
import { useConfirmDelete } from '@/core/hooks/use-confirm-delete';
import { formatDayMonthYear, parseValidDate, relativeTimeMessage } from '@/core/utils/time';
import type { NextAssignee } from '@/features/chores/chore-completion';
import type { ChoreEditChanges } from '@/features/chores/chore-edit';
import { choreNeedsRepair, getChoreStatus } from '@/features/chores/chore-status';
import {
	ChoreCompleteDialog,
	completeTriggerLabel,
} from '@/features/chores/components/ChoreCompleteDialog';
import { ChoreEditDrawer } from '@/features/chores/components/ChoreEditDrawer';
import { formatChoreCadence } from '@/features/chores/components/chore-cadence';
import type { Chore, ChoreMember, PlanChore } from '@/features/chores/components/chore-types';
import type { Locale } from '@/shared/i18n/locale';
import { useMessage } from '@/shared/i18n/message';
import { cn } from '@/shared/lib/cn';
import type { MemberInfo } from '@/shared/lib/member-types';

interface ChoreRowProps {
	chore: PlanChore;
	assignee: MemberInfo;
	members: ChoreMember[];
	isMine: boolean;
	isAdmin: boolean;
	isPending: boolean;
	isSwapPending: boolean;
	isSwapRequested: boolean;
	isTakePending: boolean;
	isEditPending: boolean;
	isCompleteArmed: boolean;
	completeError: string | null;
	nextAssignee: NextAssignee | null;
	onCancelComplete: () => void;
	onComplete: (chore: PlanChore) => void;
	onSwapRequest: (chore: PlanChore) => void;
	onTakeOver: (chore: PlanChore) => void;
	onEdit: (chore: Chore, changes: ChoreEditChanges) => Promise<boolean>;
	onRemove: (id: string) => void;
	highlighted: boolean;
}

export const ChoreRow = memo(function ChoreRow({
	chore,
	assignee,
	members,
	isMine,
	isAdmin,
	isPending,
	isSwapPending,
	isSwapRequested,
	isTakePending,
	isEditPending,
	isCompleteArmed,
	completeError,
	nextAssignee,
	onCancelComplete,
	onComplete,
	onSwapRequest,
	onTakeOver,
	onEdit,
	onRemove,
	highlighted,
}: ChoreRowProps): ReactElement {
	const t = useTranslations('chores.row');
	const render = useMessage();
	const locale = useLocale() as Locale;
	const [actionsOpen, setActionsOpen] = useState(false);
	const [editOpen, setEditOpen] = useState(false);
	const removeConfirm = useConfirmDelete();
	const status = getChoreStatus(chore.nextDueAt);
	// Taking over your own chore is a no-op, so the shortcut only shows for others'.
	const needsTakeOver = !isMine && choreNeedsRepair(chore);
	const cadence = render(formatChoreCadence(chore.intervalDays, chore.recurrenceType));
	const statusLabel = render(status.label);
	const assigneeLabel = isMine ? t('you') : assignee.name;
	const busy = isPending || isTakePending || isSwapPending || isEditPending;
	const dueDate = parseValidDate(chore.nextDueAt);

	return (
		<ItemEntry
			id={`chore-${chore.id}`}
			className={cn(
				'scroll-mt-24 rounded-none py-2 pr-1.5 transition-colors duration-700 [contain-intrinsic-size:auto_4.5rem] [content-visibility:auto]',
				highlighted && 'bg-primary/10',
			)}
			aria-busy={busy}
		>
			{chore.assignedMemberId ? (
				<MemberAvatar name={assignee.name} size={28} />
			) : (
				<span
					aria-hidden
					className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground"
				>
					?
				</span>
			)}
			{/* Minimum width in rem: with large text the buttons wrap below the title instead of squashing it. */}
			<ItemContent className="min-w-[7rem] gap-0.5">
				<ItemTitle className="line-clamp-none w-auto break-words text-body [overflow-wrap:anywhere]">
					{chore.title}
				</ItemTitle>
				<ItemDescription className="line-clamp-none break-words text-meta leading-snug">
					<span className="sr-only">{t('assignedSr', { assignee: assigneeLabel })}</span>
					<span className={cn(status.state === 'overdue' && 'font-medium text-foreground')}>
						{statusLabel}
					</span>
					{' · '}
					{cadence}
					{chore.assigneeAbsent && !isMine && ` · ${t('assigneeAway', { name: assignee.name })}`}
				</ItemDescription>
				{needsTakeOver && (
					<Button
						variant="link"
						size="sm"
						onClick={() => onTakeOver(chore)}
						disabled={busy}
						aria-label={t('takeOverAria', { title: chore.title })}
						className="h-auto self-start px-0 text-meta"
					>
						{isTakePending && <Spinner data-icon="inline-start" aria-hidden />}
						{t('takeOver')}
					</Button>
				)}
			</ItemContent>
			<ItemActions className="ml-auto flex-nowrap gap-3">
				<Button
					onClick={() => {
						if (!busy) onComplete(chore);
					}}
					aria-disabled={busy}
					variant={status.state === 'planned' ? 'outline' : 'default'}
					size="icon"
					className="size-8 rounded-full aria-disabled:opacity-50"
					aria-label={render(completeTriggerLabel(chore.title, status.action))}
				>
					{isPending ? <Spinner aria-hidden /> : <Check aria-hidden />}
				</Button>
				<Drawer
					open={actionsOpen}
					onOpenChange={(next) => {
						setActionsOpen(next);
						removeConfirm.cancel();
					}}
				>
					<DrawerTrigger
						render={
							<Button
								variant="ghost"
								size="icon"
								className="size-8"
								aria-label={t('actionsAria', { title: chore.title })}
							/>
						}
					>
						<MoreHorizontal aria-hidden />
					</DrawerTrigger>
					<DrawerContent className="mx-auto w-full max-w-md data-ending-style:transform-none data-starting-style:transform-none">
						<DrawerHeader>
							<DrawerTitle className="break-words">{chore.title}</DrawerTitle>
						</DrawerHeader>
						<div className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain p-4">
							<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm [&>dd]:break-words">
								<dt className="text-muted-foreground">{t('assigned')}</dt>
								<dd>{assigneeLabel}</dd>
								<dt className="text-muted-foreground">{t('due')}</dt>
								<dd>
									{t('dueValue', {
										date: dueDate ? formatDayMonthYear(chore.nextDueAt, locale) : t('dateUnknown'),
										status: statusLabel,
									})}
								</dd>
								<dt className="text-muted-foreground">{t('rhythm')}</dt>
								<dd>{cadence}</dd>
								<dt className="text-muted-foreground">{t('after')}</dt>
								<dd>
									{nextAssignee
										? nextAssignee.isSelf
											? t('you')
											: nextAssignee.name
										: t('nobodyAvailable')}
								</dd>
								{chore.lastCompletedAt && chore.lastCompletedByName && (
									<>
										<dt className="text-muted-foreground">{t('last')}</dt>
										<dd>
											{t('lastValue', {
												when: render(
													relativeTimeMessage(chore.lastCompletedAt, Date.now(), locale),
												),
												name: chore.lastCompletedByName,
											})}
										</dd>
									</>
								)}
							</dl>
							<Button
								variant="outline"
								className="min-h-11 shrink-0 py-2"
								disabled={busy}
								aria-label={t('editAria', { title: chore.title })}
								onClick={() => {
									setActionsOpen(false);
									setEditOpen(true);
								}}
							>
								<Pencil data-icon="inline-start" aria-hidden />
								{t('edit')}
							</Button>
							{/* Nothing to take over for the own chore. */}
							{!isMine && (
								<Button
									variant="outline"
									className="min-h-11 shrink-0 py-2"
									disabled={busy}
									onClick={() => {
										setActionsOpen(false);
										onTakeOver(chore);
									}}
								>
									<Hand data-icon="inline-start" aria-hidden />
									{t('takeOver')}
								</Button>
							)}
							<Button
								variant="outline"
								className="min-h-11 shrink-0 py-2"
								disabled={busy || isSwapRequested}
								aria-label={t(isSwapRequested ? 'swapRequestedAria' : 'swapAria', {
									title: chore.title,
								})}
								onClick={() => {
									setActionsOpen(false);
									onSwapRequest(chore);
								}}
							>
								<MessageSquareMore data-icon="inline-start" aria-hidden />
								{t(isSwapRequested ? 'swapRequested' : 'swap')}
							</Button>
							{isAdmin && (
								<>
									{removeConfirm.confirmId === chore.id && (
										<Alert className="shrink-0">
											<AlertDescription>{t('removeWarning')}</AlertDescription>
										</Alert>
									)}
									<Button
										variant="destructive"
										className="min-h-11 shrink-0 py-2"
										disabled={busy}
										aria-label={t(
											removeConfirm.confirmId === chore.id ? 'removeConfirmAria' : 'removeAria',
											{ title: chore.title },
										)}
										onClick={() => {
											if (removeConfirm.request(chore.id)) {
												setActionsOpen(false);
												onRemove(chore.id);
											}
										}}
									>
										<Trash2 data-icon="inline-start" aria-hidden />
										{t(removeConfirm.confirmId === chore.id ? 'removeConfirm' : 'remove')}
									</Button>
								</>
							)}
						</div>
						<DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
							<DrawerClose render={<Button variant="outline" className="min-h-11 py-2" />}>
								{t('close')}
							</DrawerClose>
						</DrawerFooter>
					</DrawerContent>
				</Drawer>
			</ItemActions>
			<ChoreEditDrawer
				open={editOpen}
				onOpenChange={setEditOpen}
				chore={chore}
				members={members}
				pending={isEditPending}
				error={editOpen ? completeError : null}
				onSave={(base, changes) => {
					void onEdit(base, changes).then((saved) => {
						if (saved) setEditOpen(false);
					});
				}}
			/>
			<ChoreCompleteDialog
				open={isCompleteArmed}
				title={chore.title}
				action={status.action}
				busy={busy}
				error={completeError}
				nextAssignee={nextAssignee}
				onCancel={onCancelComplete}
				onConfirm={() => onComplete(chore)}
			/>
		</ItemEntry>
	);
});
