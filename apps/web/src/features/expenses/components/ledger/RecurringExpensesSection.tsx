'use client';

import { ChevronDown, Repeat2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from '@/components/animate-ui/primitives/base/collapsible';
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
import { Button, buttonVariants } from '@/components/ui/button';
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from '@/components/ui/empty';
import { ItemGroup } from '@/components/ui/item';
import type { RecurringExpense } from '@/features/expenses/expense-types';
import { cn } from '@/shared/lib/cn';
import { RecurringTemplateItem } from './RecurringTemplateItem';

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
	memberName: (id: string) => string;
	currentMemberId: string;
	isAdmin: boolean;
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
	memberName,
	currentMemberId,
	isAdmin,
}: RecurringExpensesSectionProps): React.ReactElement {
	const t = useTranslations('expenses.recurring');
	const [open, setOpen] = useState(recurringFilterActive || recurringId !== null);
	const [deleteCandidate, setDeleteCandidate] = useState<RecurringExpense | null>(null);
	// The dialog has no trigger; after deletion the row that focus would return to is gone.
	const triggerRef = useRef<HTMLButtonElement>(null);
	const deletedRef = useRef(false);
	useEffect(() => {
		if (recurringFilterActive || recurringId) setOpen(true);
	}, [recurringFilterActive, recurringId]);
	return (
		<>
			<Collapsible
				id="recurring-expenses"
				open={open}
				onOpenChange={setOpen}
				className="scroll-mt-24"
			>
				{recurringFilterActive && <h2 className="text-base font-semibold">{t('focusHeading')}</h2>}
				<CollapsibleTrigger
					ref={triggerRef}
					render={<Button variant="outline" className="w-full justify-start" />}
				>
					<Repeat2 data-icon="inline-start" />
					{t('toggle')}
					<Badge variant="secondary">{recurringExpenses.length}</Badge>
					<ChevronDown data-icon="inline-end" className={cn('ml-auto', open && 'rotate-180')} />
				</CollapsibleTrigger>
				<CollapsiblePanel>
					<div className="flex flex-col gap-3 pt-3">
						{hiddenRecurringCount > 0 && (
							<Link
								href={`${wgBaseHref}/expenses?filter=recurring`}
								className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')}
							>
								{t('showAll', { count: String(recurringExpenses.length) })}
							</Link>
						)}
						{recurringExpenses.length === 0 ? (
							<Empty>
								<EmptyHeader>
									<EmptyTitle>{t('emptyTitle')}</EmptyTitle>
									<EmptyDescription>{t('emptyBody')}</EmptyDescription>
								</EmptyHeader>
								<EmptyContent>
									<Button onClick={onPrepareNewExpense}>{t('prepare')}</Button>
								</EmptyContent>
							</Empty>
						) : (
							<ItemGroup>
								{visibleRecurringExpenses.map((item) => (
									<RecurringTemplateItem
										key={item.id}
										item={item}
										shareCode={shareCode}
										highlighted={item.id === recurringId}
										pending={recurringActionPending || isPending(item.id)}
										creating={creatingRecurringId === item.id}
										memberName={memberName}
										currentMemberId={currentMemberId}
										isAdmin={isAdmin}
										onCreate={onCreateFromTemplate}
										onEdit={onEditTemplate}
										onRequestDelete={setDeleteCandidate}
									/>
								))}
							</ItemGroup>
						)}
					</div>
				</CollapsiblePanel>
			</Collapsible>
			<AlertDialog
				open={deleteCandidate !== null}
				onOpenChange={(next) => {
					if (!next) setDeleteCandidate(null);
				}}
			>
				<AlertDialogContent
					finalFocus={() => {
						if (!deletedRef.current) return true;
						deletedRef.current = false;
						return triggerRef.current;
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
						<AlertDialogDescription>
							{t('deleteBody', { description: deleteCandidate?.description ?? '' })}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel className="min-h-11">{t('cancel')}</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							className="min-h-11"
							disabled={recurringActionPending}
							onClick={() => {
								if (deleteCandidate) {
									deletedRef.current = true;
									onDeleteTemplate(deleteCandidate);
								}
								setDeleteCandidate(null);
							}}
						>
							{t('delete')}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
