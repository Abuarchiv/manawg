'use client';
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
import { Plus } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useEffect } from 'react';

const ExpenseFormSection = dynamic(
	() =>
		import('@/features/expenses/components/ausgaben/ExpenseFormSection').then(
			(module) => module.ExpenseFormSection,
		),
	{
		loading: () => (
			<output className="block text-sm text-[var(--text-2)]">Ausgabenformular wird geladen…</output>
		),
	},
);

/** Das Formular-Chunk einmal online anfordern, damit der Service Worker es für offline hat. */
function usePreloadExpenseForm(): void {
	useEffect(() => {
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
		void import('@/features/expenses/components/ausgaben/ExpenseFormSection');
	}, []);
}

export default function AusgabenPage() {
	usePreloadExpenseForm();
	const page = useAusgabenPage();
	const { wg, members, identity, data, form, support, recurring, submit, notify } = page;
	const { expenses, recurringExpenses, initialLoading, refreshing, loadError } = data;
	const { showForm, setShowForm, editingExpense, editingRecurringExpense } = form;
	const isEditingQueuedRecurring = form.queueEditType === 'recurring.create';
	const formSaving = submit.submitting || recurring.savingRecurringTemplate;

	return (
		<div
			data-finance-content
			className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-3 px-4 py-3"
		>
			<SubNav />
			<AusgabenHeader expenseCount={expenses.length} initialLoading={initialLoading} />
			{showForm && (
				<ExpenseFormSection
					title={
						editingRecurringExpense
							? 'Fixkosten-Vorlage bearbeiten'
							: editingExpense
								? 'Ausgabe bearbeiten'
								: 'Ausgabe hinzufügen'
					}
					previewSplits={page.splitPreview?.ok ? page.splitPreview.splits : null}
					pendingPrefillDescription={form.pendingPrefill?.description ?? null}
					onReplacePrefill={() => {
						page.clearPendingCreateRequests();
						form.acceptPendingPrefill();
					}}
					isEditingExpense={editingExpense !== null || form.invalidEditDraft}
					editingExpenseId={editingExpense?.id ?? null}
					currency={page.formCurrency}
					notice={page.actionNotice}
					description={form.description}
					setDescription={form.setDescription}
					amountStr={form.amountStr}
					setAmountStr={form.setAmountStr}
					paidByMemberId={form.paidByMemberId}
					setPaidByMemberId={form.setPaidByMemberId}
					members={members}
					payerOptions={page.selectablePayers}
					splitCandidates={page.selectableSplitMembers}
					identityMemberId={identity.memberId}
					splitMode={form.splitMode}
					setSplitMode={form.setSplitMode}
					recurringIntervalMonths={form.recurringIntervalMonths}
					setRecurringIntervalMonths={form.setRecurringIntervalMonths}
					manualSplits={form.manualSplits}
					setManualSplits={form.setManualSplits}
					imageUrl={form.imageUrl}
					setImageUrl={form.setImageUrl}
					shareCode={wg.shareCode}
					isEditingQueuedExpense={form.queueEditType === 'expense.create'}
					isEditingQueuedRecurring={isEditingQueuedRecurring}
					formError={form.formError}
					fieldErrors={support.fieldErrors}
					validationAttempt={support.validationAttempt}
					onClearFieldError={support.clearFieldError}
					conflictExpenseId={form.conflictExpenseId}
					onReloadServerVersion={() => {
						form.setConflictExpenseId(null);
						form.setFormError(null);
						void data.load(false);
					}}
					onKeepDraft={() => form.setConflictExpenseId(null)}
					savingRecurringTemplate={recurring.savingRecurringTemplate}
					editingRecurringExpense={editingRecurringExpense}
					formSaving={formSaving}
					onSaveRecurringTemplate={() => void recurring.saveRecurringTemplate()}
					onCancel={() => setShowForm(false)}
					onDiscard={() => {
						page.clearPendingCreateRequests();
						form.resetForm();
						setShowForm(false);
						removeDraft(form.draftKey);
					}}
					onSubmit={() => {
						haptic('medium');
						if (isEditingQueuedRecurring) void recurring.saveRecurringTemplate();
						else void submit.submit();
					}}
				/>
			)}
			{page.actionNotice && !showForm && <ActionNoticeBanner notice={page.actionNotice} />}
			{refreshing && (
				<output
					// Schwebt über dem Inhalt: im Fluss würde sein Verschwinden die Karten springen lassen.
					className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.5rem)] z-40 mx-auto flex w-fit items-center gap-2 rounded-full border bg-background px-3 py-1 text-sm text-muted-foreground shadow-sm"
					aria-live="polite"
				>
					<Spinner />
					Wird aktualisiert…
				</output>
			)}
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
				<div aria-hidden className="flex min-h-[26rem] flex-col gap-3 rounded-xl border p-3">
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
						shareCode={wg.shareCode}
						currentMemberId={identity.memberId}
						memberToken={identity.memberToken}
						memberPayPalMerchantId={page.memberPayPalMerchantId}
						onSettled={(message) => {
							if (message) notify.success(message);
							void data.load(false);
						}}
					/>
				)}
			{/* Fixkosten leben im eigenen Tab; hier nur, wenn ein Link gezielt eine Vorlage öffnet. */}
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
					onCreateFromTemplate={(item) => void recurring.createFromRecurringTemplate(item)}
					onEditTemplate={form.startRecurringEdit}
					onDeleteTemplate={(item) => void recurring.deleteRecurringTemplate(item)}
					onPrepareNewExpense={() => setShowForm(true)}
				/>
			)}
			<ExpenseHistory
				expenseCount={expenses.length}
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
