'use client';

import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldGroup } from '@/components/ui/field';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { type ActionNotice, ActionNoticeBanner } from '@/components/wg/ActionNoticeBanner';
import type { Member } from '@/components/wg/WgContextProvider';
import { DESCRIPTION_MAX_LENGTH } from '@/features/expenses/expense-constants';
import { expenseFormModeKey, expenseSubmitLabel } from '@/features/expenses/expense-form-mode';
import type { ChangedSettledShare } from '@/features/expenses/expense-split-input';
import type {
	ExpenseFormField,
	ExpenseFormFieldErrors,
	ExpenseSplitShare,
} from '@/features/expenses/expense-types';
import type { ExpenseFormState } from '@/features/expenses/hooks/expense-page-context';
import { type Message, useMessage } from '@/shared/i18n/message';
import { cn } from '@/shared/lib/cn';
import { useKeyboardOpen } from '@/shared/lib/use-keyboard-open';
import { ExpenseCategoryField } from './ExpenseCategoryField';
import { CloseDraftDialog, ReplaceDraftDialog } from './ExpenseDraftDialogs';
import { ExpenseExtras } from './ExpenseExtras';
import { ExpenseFormNotices } from './ExpenseFormNotices';
import { ExpensePayerDateFields } from './ExpensePayerDateFields';
import { ExpenseSplitFieldset } from './ExpenseSplitFieldset';
import { ExpenseTextField } from './ExpenseTextField';
import { useExpenseFormDirty } from './use-expense-form-dirty';

const EXPENSE_DESCRIPTION_FIELD_ID = 'expense-description';

/** Who can pay and be charged in the form; the lists exclude members who moved out. */
interface ExpenseFormPeople {
	members: Member[];
	payerOptions: Member[];
	splitCandidates: Member[];
	identityMemberId: string;
}

interface ExpenseFormValidation {
	fieldErrors: ExpenseFormFieldErrors;
	/** Counts failed submit attempts; each one moves focus to the first invalid field. */
	attempt: number;
	onClear: (field: ExpenseFormField) => void;
}

interface ExpenseFormHandlers {
	onSubmit: () => void;
	onSaveRecurringTemplate: () => void;
	onCancel: () => void;
	onDiscard: () => void;
	onReloadServerVersion: () => void;
	onKeepDraft: () => void;
	onReplacePrefill: () => void;
	/** Fires after the exit animation; the form can unmount. */
	onExited: () => void;
}

interface ExpenseFormSectionProps {
	form: ExpenseFormState;
	people: ExpenseFormPeople;
	validation: ExpenseFormValidation;
	handlers: ExpenseFormHandlers;
	title: Message;
	notice: ActionNotice | null;
	shareCode: string;
	currency: string;
	changedSettledShares: ChangedSettledShare[];
	previewSplits: ExpenseSplitShare[] | null;
	/** A submit or template save is running. */
	saving: boolean;
	recurringTemplateCount: number;
	/** Controlled from outside so the sheet can fade out before unmounting. */
	open: boolean;
}

export function ExpenseFormSection({
	form,
	people,
	validation,
	handlers,
	title,
	notice,
	shareCode,
	currency,
	changedSettledShares,
	previewSplits,
	saving: formSaving,
	recurringTemplateCount,
	open,
}: ExpenseFormSectionProps): React.ReactElement {
	const t = useTranslations('expenses-form');
	const message = useMessage();
	const {
		description,
		setDescription,
		category,
		setCategory,
		amountStr,
		setAmountStr,
		paidByMemberId,
		setPaidByMemberId,
		splitMode,
		setSplitMode,
		recurringIntervalMonths,
		setRecurringIntervalMonths,
		manualSplits,
		setManualSplits,
		extras,
		imageUrl,
		setImageUrl,
		editingRecurringExpense,
		formError,
		conflictExpenseId,
	} = form;
	const { members, payerOptions, splitCandidates, identityMemberId } = people;
	const { fieldErrors, attempt: validationAttempt, onClear: onClearFieldError } = validation;
	const {
		onSubmit,
		onSaveRecurringTemplate,
		onCancel,
		onDiscard,
		onReloadServerVersion,
		onKeepDraft,
		onReplacePrefill,
		onExited,
	} = handlers;
	const isEditingQueuedExpense = form.queueEditType === 'expense.create';
	const isEditingQueuedRecurring = form.queueEditType === 'recurring.create';
	const isEditingExpense = form.editingExpense !== null || form.invalidEditDraft;
	const editingExpenseId = form.editingExpense?.id ?? null;
	const pendingPrefillDescription = form.pendingPrefill?.description ?? null;
	const keyboardOpen = useKeyboardOpen();
	const [confirmClose, setConfirmClose] = useState(false);
	const [replaceOpen, setReplaceOpen] = useState(false);
	const formRef = useRef<HTMLFormElement>(null);
	const formErrorRef = useRef<HTMLDivElement>(null);
	const editingTemplate = Boolean(
		editingRecurringExpense && !isEditingQueuedExpense && !isEditingQueuedRecurring,
	);
	const savesTemplate = isEditingQueuedRecurring || editingTemplate;
	const formModeKey = expenseFormModeKey({
		editingRecurringExpense,
		isEditingExpense,
		editingExpenseId,
	});
	const submitLabel = expenseSubmitLabel({ savesTemplate, editingRecurringExpense });
	const textError = (error: Message | undefined) => (error ? message(error) : undefined);
	const isDirty = useExpenseFormDirty({
		description,
		category,
		amountStr,
		paidByMemberId,
		splitMode,
		manualSplits,
		imageUrl,
		...extras.draftFields,
		recurringIntervalMonths,
		identityMemberId,
		formModeKey,
		startsFromCurrentValues: isEditingExpense || editingRecurringExpense !== null,
	});

	useEffect(() => {
		if (validationAttempt === 0) return;
		formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
	}, [validationAttempt]);

	// The server error sits at the end of the scroll area, below the fold on small phones.
	useEffect(() => {
		if (formError) formErrorRef.current?.scrollIntoView({ block: 'nearest' });
	}, [formError]);

	// Saving while the receipt still uploads would book the expense without it.
	const [imageUploading, setImageUploading] = useState(false);
	const submitBlocked = formSaving || imageUploading || changedSettledShares.length > 0;

	function requestClose() {
		if (formSaving) return;
		if (isDirty) setConfirmClose(true);
		else onCancel();
	}

	return (
		<>
			<Dialog
				open={open}
				onOpenChange={(next) => !next && requestClose()}
				onOpenChangeComplete={(next) => !next && onExited()}
			>
				<DialogContent
					showCloseButton={false}
					className="top-0 flex h-dvh max-h-dvh w-full max-w-md translate-y-0 flex-col gap-0 rounded-none p-0"
					initialFocus={() => document.getElementById(EXPENSE_DESCRIPTION_FIELD_ID)}
				>
					<DialogHeader className="shrink-0 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
						<div className="flex items-center gap-2">
							<Button
								variant="ghost"
								size="icon"
								onClick={requestClose}
								disabled={formSaving}
								aria-label={t('actions.cancelAria')}
							>
								<ArrowLeft />
							</Button>
							<DialogTitle>{message(title)}</DialogTitle>
						</div>
					</DialogHeader>
					<Separator />
					<form
						ref={formRef}
						className="flex min-h-0 flex-1 flex-col"
						onSubmit={(event) => {
							event.preventDefault();
							if (submitBlocked) return;
							if (editingTemplate) onSaveRecurringTemplate();
							else onSubmit();
						}}
					>
						<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
							<FieldGroup>
								{notice && <ActionNoticeBanner notice={notice} />}
								<ExpenseFormNotices
									pendingPrefillDescription={pendingPrefillDescription}
									isEditingQueued={isEditingQueuedExpense || isEditingQueuedRecurring}
									formSaving={formSaving}
									onAskReplace={() => setReplaceOpen(true)}
								/>
								<ExpenseTextField
									id={EXPENSE_DESCRIPTION_FIELD_ID}
									label={t('fields.description')}
									value={description}
									onChange={(value) => {
										setDescription(value);
										onClearFieldError('description');
									}}
									maxLength={DESCRIPTION_MAX_LENGTH}
									placeholder={t('fields.descriptionPlaceholder')}
									disabled={formSaving}
									error={textError(fieldErrors.description)}
									enterKeyHint="next"
								/>
								<ExpenseCategoryField
									id="expense-category"
									value={category}
									onChange={setCategory}
									disabled={formSaving}
								/>
								<ExpenseTextField
									label={t('fields.amount')}
									value={amountStr}
									onChange={(value) => {
										setAmountStr(value);
										onClearFieldError('amount');
										onClearFieldError('splits');
									}}
									inputMode="decimal"
									placeholder={t('fields.amountPlaceholder')}
									suffix={currency === 'EUR' ? '€' : currency}
									disabled={formSaving}
									error={textError(fieldErrors.amount)}
									enterKeyHint="next"
								/>
								<ExpensePayerDateFields
									paidByMemberId={paidByMemberId}
									setPaidByMemberId={setPaidByMemberId}
									payerOptions={payerOptions}
									identityMemberId={identityMemberId}
									isEditingExpense={isEditingExpense}
									occurredOn={extras.occurredOn}
									setOccurredOn={extras.setOccurredOn}
									dateError={textError(fieldErrors.date)}
									onClearDateError={() => onClearFieldError('date')}
									formSaving={formSaving}
								/>
								<ExpenseSplitFieldset
									members={members}
									splitCandidates={splitCandidates}
									splitMode={splitMode}
									setSplitMode={setSplitMode}
									manualSplits={manualSplits}
									setManualSplits={setManualSplits}
									participantIds={extras.participantIds}
									setParticipantIds={extras.setParticipantIds}
									changedSettledShares={changedSettledShares}
									splitsError={textError(fieldErrors.splits)}
									onClearSplitsError={() => onClearFieldError('splits')}
									amountStr={amountStr}
									currency={currency}
									paidByMemberId={paidByMemberId}
									previewSplits={previewSplits}
									isEditingExpense={isEditingExpense}
									formSaving={formSaving}
								/>
								<Separator />
								<ExpenseExtras
									shareCode={shareCode}
									imageUrl={imageUrl}
									setImageUrl={setImageUrl}
									recurringIntervalMonths={recurringIntervalMonths}
									setRecurringIntervalMonths={setRecurringIntervalMonths}
									editingRecurringExpense={editingRecurringExpense}
									isEditingQueuedExpense={isEditingQueuedExpense}
									isEditingQueuedRecurring={isEditingQueuedRecurring}
									onSaveRecurringTemplate={onSaveRecurringTemplate}
									recurringTemplateCount={recurringTemplateCount}
									formSaving={formSaving}
									onImageUploadingChange={setImageUploading}
								/>
								{formError && (
									<Alert ref={formErrorRef} variant="destructive">
										<AlertDescription>{message(formError)}</AlertDescription>
										{conflictExpenseId && (
											<div className="flex flex-col gap-2 pt-3">
												<Button type="button" variant="outline" onClick={onReloadServerVersion}>
													{t('actions.loadServer')}
												</Button>
												<Button type="button" variant="outline" onClick={onKeepDraft}>
													{t('actions.keepDraft')}
												</Button>
											</div>
										)}
									</Alert>
								)}
							</FieldGroup>
						</div>
						<Separator />
						<div
							className={cn(
								'flex shrink-0 flex-col gap-2 px-4',
								// With the keyboard open the safe area is irrelevant and the back arrow already cancels, so more of the form stays visible.
								keyboardOpen ? 'py-2' : 'pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
							)}
						>
							<div className="flex flex-col gap-2">
								<Button
									type="submit"
									className="w-full"
									disabled={submitBlocked}
									aria-label={message(submitLabel.accessibleName)}
								>
									{formSaving && <Spinner data-icon="inline-start" />}
									{message(submitLabel.text)}
								</Button>
								<Button
									type="button"
									variant="ghost"
									className={cn('w-full', keyboardOpen && 'hidden')}
									onClick={requestClose}
									disabled={formSaving}
								>
									{t('actions.cancel')}
								</Button>
							</div>
							{editingTemplate && (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="self-start"
									disabled={submitBlocked}
									onClick={onSubmit}
								>
									{t('submit.saveAsExpense')}
								</Button>
							)}
						</div>
					</form>
				</DialogContent>
			</Dialog>

			<ReplaceDraftDialog
				open={replaceOpen}
				onOpenChange={setReplaceOpen}
				prefillDescription={pendingPrefillDescription}
				onReplace={onReplacePrefill}
			/>
			<CloseDraftDialog
				open={confirmClose}
				onOpenChange={setConfirmClose}
				onDiscard={onDiscard}
				onKeep={onCancel}
			/>
		</>
	);
}
