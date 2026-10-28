'use client';

import { Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef } from 'react';
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
import { Card, CardContent } from '@/components/ui/card';
import { ItemContent, ItemEntry, ItemGroup } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { ActionNoticeBanner } from '@/components/wg/ActionNoticeBanner';
import { LoadErrorBanner } from '@/components/wg/LoadErrorBanner';
import { SubNav } from '@/components/wg/SubNav';
import { ThumbAction } from '@/components/wg/ThumbAction';
import { formatEuroCents } from '@/core/utils/money';
import { RecurringCreateModal } from '@/features/expenses/components/recurring/RecurringCreateModal';
import { RecurringEditModal } from '@/features/expenses/components/recurring/RecurringEditModal';
import { RecurringList } from '@/features/expenses/components/recurring/RecurringList';
import { RecurringModalOpenContext } from '@/features/expenses/components/recurring/RecurringModalShell';
import type { RecurringExpense } from '@/features/expenses/expense-types';
import { useRecurringPage } from '@/features/expenses/hooks/use-recurring-page';

export default function RecurringPage() {
	const {
		identity,
		memberOptions,
		recurringExpenses,
		filter,
		setFilter,
		loading,
		refreshing,
		loadError,
		load,
		notice,
		setNotice,
		showCreate,
		setShowCreate,
		editing,
		setEditing,
		submitting,
		pendingId,
		deleteCandidate,
		setDeleteCandidate,
		handleCreate,
		handleEdit,
		handleTogglePause,
		handleDelete,
		activeCount,
		dueCount,
		monthly,
	} = useRecurringPage();
	const t = useTranslations('expenses-recurring');
	const tCommon = useTranslations('common');
	const locale = useLocale();
	const listRef = useRef<HTMLElement>(null);
	const deletedRef = useRef(false);
	const lastEditingRef = useRef<RecurringExpense | null>(null);
	if (editing) lastEditingRef.current = editing;

	return (
		<div
			data-finance-content
			className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-3 px-4 py-3"
		>
			<SubNav liveCount={!loading && !loadError ? dueCount : undefined} />
			{/* The active tab already names the page; title and counter stay for screen readers. */}
			<header className="sr-only">
				<h1>{t('page.title')}</h1>
				<p aria-live="polite">
					{loading
						? ''
						: t('page.counter', { active: activeCount, total: recurringExpenses.length })}
				</p>
				<output aria-live="polite" aria-hidden={!refreshing}>
					{tCommon('loading')}
				</output>
			</header>
			{loadError && (
				<LoadErrorBanner
					message={loadError}
					onRetry={() => void load(true)}
					busy={loading || refreshing}
					retryLabel={{ key: 'expenses-recurring.page.loadError.retry' }}
				/>
			)}
			{notice && <ActionNoticeBanner notice={notice} />}
			{!loading && monthly.size > 0 && (
				<Card size="sm">
					<CardContent className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,7.5rem),1fr))] gap-3">
						<div className="min-w-0">
							<p className="text-sm text-muted-foreground">{t('page.perMonth')}</p>
							{[...monthly].map(([currency, { totalCents }]) => (
								<p
									key={currency}
									className="break-words font-mono text-lg font-semibold tabular-nums"
								>
									{formatEuroCents(Math.round(totalCents), currency, { locale })}
								</p>
							))}
						</div>
						<div className="min-w-0">
							<p className="text-sm text-muted-foreground">{t('page.yourShare')}</p>
							{[...monthly].map(([currency, { mineCents }]) => (
								<p
									key={currency}
									className="break-words font-mono text-lg font-semibold tabular-nums"
								>
									{formatEuroCents(Math.round(mineCents), currency, { locale })}
								</p>
							))}
						</div>
					</CardContent>
				</Card>
			)}
			{loading ? (
				<AbosSkeleton />
			) : (
				<RecurringList
					recurringExpenses={recurringExpenses}
					members={memberOptions}
					filter={filter}
					pendingId={pendingId}
					loadError={loadError}
					listRef={listRef}
					onFilterChange={setFilter}
					onEdit={(recurringExpense) => {
						setNotice(null);
						setEditing(recurringExpense);
					}}
					onTogglePause={(recurringExpense) => void handleTogglePause(recurringExpense)}
					onDelete={setDeleteCandidate}
				/>
			)}
			<RecurringModalOpenContext.Provider value={showCreate}>
				<RecurringCreateModal
					members={memberOptions}
					defaultPaidByMemberId={identity.memberId}
					submitting={submitting}
					saveError={notice?.tone === 'error' ? notice.message : null}
					onClose={() => {
						setShowCreate(false);
						setNotice(null);
					}}
					onSubmit={(values) => void handleCreate(values)}
				/>
			</RecurringModalOpenContext.Provider>
			{/* Stays mounted with the last entry after closing until the animation finishes. */}
			{lastEditingRef.current && (
				<RecurringModalOpenContext.Provider value={editing !== null}>
					<RecurringEditModal
						recurringExpense={lastEditingRef.current}
						members={memberOptions}
						submitting={submitting}
						saveError={notice?.tone === 'error' ? notice.message : null}
						onClose={() => {
							setEditing(null);
							setNotice(null);
						}}
						onSubmit={(values) => void handleEdit(values)}
					/>
				</RecurringModalOpenContext.Provider>
			)}
			<AlertDialog
				open={deleteCandidate !== null}
				onOpenChange={(open) => {
					if (!open) setDeleteCandidate(null);
				}}
			>
				<AlertDialogContent
					finalFocus={() => {
						// The deleted row and its trigger are gone: focus stays in the list instead of falling to <body>.
						if (!deletedRef.current) return null;
						deletedRef.current = false;
						return listRef.current;
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('deleteDialog.title')}</AlertDialogTitle>
						<AlertDialogDescription>
							{t('deleteDialog.description', { description: deleteCandidate?.description ?? '' })}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel className="min-h-11">{t('deleteDialog.cancel')}</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							className="min-h-11"
							disabled={pendingId !== null}
							onClick={() => {
								if (deleteCandidate) {
									deletedRef.current = true;
									void handleDelete(deleteCandidate);
								}
								setDeleteCandidate(null);
							}}
						>
							{t('deleteDialog.confirm')}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<ThumbAction>
				<Button
					type="button"
					className="min-h-11 w-full"
					onClick={() => {
						setNotice(null);
						setShowCreate(true);
					}}
				>
					<Plus data-icon="inline-start" aria-hidden />
					{t('page.add')}
				</Button>
			</ThumbAction>
		</div>
	);
}

function AbosSkeleton() {
	const t = useTranslations('expenses-recurring');
	return (
		<>
			{/* Reserves the summary card so the list does not jump down while loading. */}
			<Card size="sm" aria-hidden="true">
				<CardContent className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,7.5rem),1fr))] gap-3">
					{['s1', 's2'].map((key) => (
						<div key={key} className="min-w-0">
							<div className="flex h-5 items-center">
								<Skeleton className="h-3 w-16" />
							</div>
							<div className="flex h-7 items-center">
								<Skeleton className="h-5 w-24" />
							</div>
						</div>
					))}
				</CardContent>
			</Card>
			<ItemGroup aria-busy="true" aria-label={t('page.skeletonLabel')}>
				{['s1', 's2', 's3', 's4'].map((key) => (
					<ItemEntry key={key} variant="outline" aria-hidden="true">
						<ItemContent>
							<Skeleton className="h-4 w-2/3" />
							<Skeleton className="h-3 w-1/3" />
						</ItemContent>
						<Skeleton className="h-4 w-16" />
					</ItemEntry>
				))}
			</ItemGroup>
		</>
	);
}
