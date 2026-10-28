'use client';
import { Plus } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { ActionNoticeBanner } from '@/components/wg/ActionNoticeBanner';
import { LoadErrorBanner } from '@/components/wg/LoadErrorBanner';
import { OfflineQueueNotice } from '@/components/wg/OfflineQueueNotice';
import { SubNav } from '@/components/wg/SubNav';
import { ThumbAction } from '@/components/wg/ThumbAction';
import { removeDraft } from '@/core/offline/drafts';
import { AusgabenHeader } from '@/features/expenses/components/ausgaben/AusgabenHeader';
import { ExpenseHistory } from '@/features/expenses/components/ausgaben/ExpenseHistory';
import { RecurringExpensesSection } from '@/features/expenses/components/ausgaben/RecurringExpensesSection';
import { DebtSummary } from '@/features/expenses/components/debts/DebtSummary';
import { useAusgabenPage } from '@/features/expenses/hooks/use-ausgaben-page';
import { haptic } from '@/shared/lib/haptics';

const ExpenseFormSection = dynamic(
	() =>
		import('@/features/expenses/components/ausgaben/ExpenseFormSection').then(
			(module) => module.ExpenseFormSection,
		),
	{
		loading: () => (
			// Out of flow so the background does not jump; the real sheet replaces it in place.
			<output className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-popover text-sm text-popover-foreground">
				<Spinner aria-hidden className="size-6" />
				Ausgabenformular wird geladen…
			</output>
		),
	},
);

/** Request the form chunk once while online so the service worker has it for offline use. */
function usePreloadExpenseForm(): void {
	useEffect(() => {
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
		void import('@/features/expenses/components/ausgaben/ExpenseFormSection');
	}, []);
}

export default function AusgabenPage() {
	usePreloadExpenseForm();
	const page = useAusgabenPage();
	const { wg, members, identity, isAdmin, data, form, support, recurring, submit, notify } = page;
	const { expenses, recurringExpenses, initialLoading, refreshing, loadError } = data;
	const { showForm, setShowForm } = form;
	// The form stays mounted after closing until the exit animation finishes; every open starts fresh.
	const [formSession, setFormSession] = useState({ mounted: showForm, key: 0 });
	const [previousShowForm, setPreviousShowForm] = useState(showForm);
	if (showForm !== previousShowForm) {
		setPreviousShowForm(showForm);
		if (showForm) setFormSession((session) => ({ mounted: true, key: session.key + 1 }));
	}

	return (
		<div
			data-finance-content
			className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-3 px-4 py-3"
		>
			<SubNav />
			<AusgabenHeader expenseCount={expenses.length} initialLoading={initialLoading} />
			{formSession.mounted && (
				<ExpenseFormSection
					key={formSession.key}
					open={showForm}
					form={form}
					title={page.formTitle}
					notice={page.actionNotice}
					shareCode={wg.shareCode}
					currency={page.formCurrency}
					reopenedShares={page.reopenedShares}
					previewSplits={page.splitPreview?.ok ? page.splitPreview.splits : null}
					saving={page.saving}
					recurringTemplateCount={recurringExpenses.length}
					people={{
						members,
						payerOptions: page.selectablePayers,
						splitCandidates: page.selectableSplitMembers,
						identityMemberId: identity.memberId,
					}}
					validation={{
						fieldErrors: support.fieldErrors,
						attempt: support.validationAttempt,
						onClear: support.clearFieldError,
					}}
					handlers={{
						onExited: () => setFormSession((session) => ({ ...session, mounted: false })),
						onReplacePrefill: () => {
							page.clearPendingCreateRequests();
							form.acceptPendingPrefill();
						},
						onReloadServerVersion: () => void page.resolveConflict('server'),
						onKeepDraft: () => void page.resolveConflict('draft'),
						onSaveRecurringTemplate: () => void recurring.saveRecurringTemplate(),
						onCancel: () => setShowForm(false),
						onDiscard: () => {
							page.clearPendingCreateRequests();
							form.resetForm();
							setShowForm(false);
							removeDraft(form.draftKey);
						},
						onSubmit: () => {
							haptic('medium');
							if (page.isEditingQueuedRecurring) void recurring.saveRecurringTemplate();
							else void submit.submit();
						},
					}}
				/>
			)}
			{page.actionNotice && !showForm && <ActionNoticeBanner notice={page.actionNotice} />}
			{/* Screen readers only: a visible notice would cover the header and flash on every poll. */}
			<output aria-live="polite" aria-hidden={!refreshing} className="sr-only">
				{refreshing ? 'Lädt…' : ''}
			</output>
			<OfflineQueueNotice queuedCount={data.queuedCount} />
			{loadError && (
				<LoadErrorBanner
					message={loadError}
					onRetry={() => void data.load(true)}
					busy={initialLoading || refreshing}
					retryLabel="Ausgaben erneut laden"
				/>
			)}
			{page.showSkeleton && (
				<div aria-hidden className="flex min-h-[18rem] flex-col gap-3 rounded-xl border p-3">
					<Skeleton className="h-3 w-20" />
					<Skeleton className="h-7 w-2/3" />
					<Skeleton className="h-4 w-1/3" />
					{['b0', 'b1', 'b2'].map((key) => (
						<Skeleton key={key} className="h-6 w-full" />
					))}
				</div>
			)}
			{!page.showSkeleton &&
				(expenses.length > 0 ||
					page.directDebts.length > 0 ||
					page.memberBalances.some((member) => member.balanceCents !== 0)) && (
					<DebtSummary
						debts={page.directDebts}
						summary={page.settlementSummary}
						balances={page.memberBalances}
						expenses={expenses}
						payments={data.payments}
						memberName={page.memberName}
						shareCode={wg.shareCode}
						currentMemberId={identity.memberId}
						onSettled={(message) => {
							if (message) notify.success(message);
							void data.load(false);
						}}
					/>
				)}
			{/* Recurring expenses live in their own tab; shown here only when a link opens a specific template. */}
			{(page.recurringFilterActive || (page.recurringId && recurringExpenses.length > 0)) && (
				<RecurringExpensesSection
					recurringExpenses={recurringExpenses}
					recurringFilterActive={page.recurringFilterActive}
					wgBaseHref={page.wgBaseHref}
					shareCode={wg.shareCode}
					hiddenRecurringCount={page.hiddenRecurringCount}
					visibleRecurringExpenses={page.visibleRecurringExpenses}
					recurringId={page.recurringId}
					recurringActionPending={
						recurring.creatingRecurringId !== null || recurring.savingRecurringTemplate
					}
					creatingRecurringId={recurring.creatingRecurringId}
					isPending={page.pending.isPending}
					memberName={page.memberName}
					currentMemberId={identity.memberId}
					isAdmin={isAdmin}
					onCreateFromTemplate={(item) => void recurring.createFromRecurringTemplate(item)}
					onEditTemplate={form.startRecurringEdit}
					onDeleteTemplate={(item) => void recurring.deleteRecurringTemplate(item)}
					onPrepareNewExpense={() => setShowForm(true)}
				/>
			)}
			<ExpenseHistory
				expenseCount={expenses.length}
				shownCount={page.shownExpenseCount}
				scope={page.scope}
				onScopeChange={page.setScope}
				query={page.query}
				onQueryChange={page.setQuery}
				weeks={page.expenseWeeks}
				showSkeleton={page.showSkeleton}
				initialLoading={initialLoading}
				loadFailed={loadError !== null}
				hiddenCount={page.hiddenExpenseCount}
				onShowMore={page.showMoreExpenses}
				importHref={`${page.wgBaseHref}/import`}
				expanded={page.expanded}
				highlightedId={page.highlightedId}
				currentMemberId={identity.memberId}
				pendingIds={page.pending.pendingIds}
				memberName={page.stable.memberName}
				onToggleExpand={page.stable.toggleExpand}
				onDelete={page.stable.deleteExpense}
				onEdit={page.stable.edit}
				onToggleSettle={page.stable.toggleSettle}
			/>
			<ThumbAction>
				<Button
					type="button"
					className="min-h-11 w-full"
					onClick={() => {
						haptic('light');
						setShowForm(true);
					}}
				>
					<Plus data-icon="inline-start" aria-hidden />
					Ausgabe hinzufügen
				</Button>
			</ThumbAction>
		</div>
	);
}
