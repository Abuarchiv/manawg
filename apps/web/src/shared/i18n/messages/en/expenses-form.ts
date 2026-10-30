import type { Catalog } from '../catalog';
import type de from '../de/expenses-form';

export default {
	title: {
		editTemplate: 'Edit fixed-cost template',
		editQueuedTemplate: 'Edit queued fixed-cost template',
		editQueuedExpense: 'Edit queued expense',
		edit: 'Edit expense',
		add: 'Add expense',
	},
	submit: {
		saveTemplate: 'Save template',
		saveTemplateAria: 'Save fixed-cost template',
		saveAsExpense: 'Save as expense',
		save: 'Save',
		saveAria: 'Save expense',
	},
	fields: {
		description: 'Description',
		descriptionPlaceholder: 'e.g. Weekly shop',
		amount: 'Amount',
		amountPlaceholder: '0.00',
		category: 'Category',
		date: 'Date',
		paidBy: 'Paid by',
		payerYou: '{name} (you)',
		payerLocked: 'The payer of an existing expense cannot be changed.',
	},
	actions: {
		cancelAria: 'Close expense form',
		cancel: 'Cancel',
		loadServer: 'Load server version',
		keepDraft: 'Keep my draft',
	},
	draft: {
		replaceTitle: 'Discard draft?',
		replaceBody:
			'Your unsaved entries will be replaced by “{description}”. Expenses already saved stay.',
		replaceKeep: 'Keep draft',
		replaceDiscard: 'Discard draft',
		closeTitle: 'Keep draft?',
		closeBody: 'No expense is saved. You can carry on with your draft later or discard it.',
		closeContinue: 'Keep editing',
		closeDiscard: 'Discard draft',
		closeKeep: 'Keep draft',
		existingKept: 'Your existing draft is kept.',
		replaceWith: 'Discard draft and use “{description}”',
		notSynced: 'Not synced yet. The change is sent once you are online.',
	},
	split: {
		legend: 'People involved and split',
		toggleAria: 'Split',
		equal: 'Equally',
		equalAria: 'Split: equally',
		manual: 'Manually',
		manualAria: 'Split: manually',
		lockedHint:
			'Shares of members who have moved out stay unchanged; only active members take the rest.',
		movedOut: '(moved out)',
		shareAria: 'Share of {name} in {currency, select, EUR {euros} other {{currency}}}',
		shareAriaMovedOut:
			'Share of {name} in {currency, select, EUR {euros} other {{currency}}}, moved out. Share stays unchanged.',
		zeroHint: 'Leave empty or enter {zero} for no share.',
		settledShareLocked:
			'The share of {name} ({previous}) is already marked as paid and cannot change{removed, select, yes { or be removed.} other { (it would be {next}).}} Reopen the payment first, then you can adjust it.',
		participantsAria: 'People involved',
		reviewAria: 'Shares before saving',
		noShare: 'No share',
		ownShare: 'Own share · already paid',
		sum: 'Total:',
		balanced: 'Balanced',
		tooMuch: 'Too much',
		open: 'Open',
		distribute: 'Split the rest',
	},
	extras: {
		addReceipt: 'Add receipt',
		attached: 'Attached',
		receipt: 'Receipt',
		template: 'Fixed-cost template',
		repeat: 'Repeat',
		templateHint: 'The template remembers the amount, the payer and this split.',
		saveAsTemplate: 'Save as template',
		templateSaved: 'Saved as a template. You can find it under Fixed costs.',
	},
	intervals: {
		optionMonths: '{count, plural, one {# month} other {# months}}',
		optionQuarter: '3 months',
		optionYear: '12 months',
		monthly: 'monthly',
		quarterly: 'quarterly',
		halfYearly: 'every six months',
		yearly: 'yearly',
		everyMonths: 'every {count} months',
	},
	validation: {
		description: 'Enter a short description.',
		date: 'Choose a date that is not in the future.',
		amountDecimals: 'At most two decimal places.',
		amountTooLarge: 'The amount can be at most €1,000,000.',
		amountInvalid: 'Enter an amount above €0, e.g. 12.50.',
	},
	notices: {
		receiptUploadFailed: 'The receipt could not be uploaded. Try again or remove it.',
		draftBroken:
			'This draft can no longer be matched to its expense. Open the original expense again or discard the draft.',
		draftBrokenKept:
			'This draft can no longer be matched to its expense. Your entries are kept; open the original expense again or discard the draft.',
		reloadFailed: 'The list could not be reloaded. Try again in a moment.',
		conflict:
			'This expense has been changed in the meantime. Reload the list, then decide which version is right.',
		templateUnavailable:
			'The fixed-cost template is not available. Refresh the page and try again.',
		saved: 'Expense saved. No money is transferred here.',
		updated: 'Expense updated. No money is transferred here.',
		keyUnavailableExpense: 'The expense could not be sent reliably. Try again.',
		keyUnavailableRecurring: 'The fixed-cost expense could not be sent reliably. Try again.',
		keyUnavailableTemplate: 'The fixed-cost template could not be saved reliably. Try again.',
		recurringQueued:
			'Fixed-cost expense queued offline. The template stays unchanged until it syncs.',
		recurringQueueBlocked:
			'Offline storage is blocked. The fixed-cost expense could not be queued and was rolled back.',
		recurringBooked: 'Fixed-cost expense recorded.',
		templateAlreadyQueued:
			'The fixed-cost template is already queued offline. Sync or resolve the existing action first.',
		templateSavedOffline: 'Fixed-cost template saved offline.',
		templateGoneRemoved: 'This fixed-cost template no longer exists and was removed from the list.',
		templateUpdated: 'Fixed-cost template updated.',
		templateSaved: 'Saved as a template ({interval}).',
		offlineSaved: 'Saved offline. It will sync once you are back online.',
		queueBlockedDraft: 'Offline storage is blocked. Keep the draft open and try again later.',
		offlineDraftCleanupFailed:
			'Saved offline, but the old draft could not be removed. Check the offline queue.',
		draftCleanupFailed: 'Saved, but the old offline draft could not be removed.',
		queueEditAlreadySent: 'The entry has already been sent. Check the list.',
	},
	errors: {
		withPeriod: '{subject}.',
		invalidRequest: 'The request was not valid.',
		splitSumMismatch: 'The amounts do not add up. The shares must match the total exactly.',
		paidByMustIncludeCaller:
			'If you add an expense for someone else, your own share must be more than €0.',
		notTemplateOwner:
			'Only the person who created this fixed cost or a flat admin can change or delete it.',
		recurringNotFound: 'This fixed-cost template no longer exists. Reload the expenses.',
		editedExpenseDeleted:
			'The original expense was deleted. Your unsaved changes stay in the draft; you can copy them or discard the draft.',
		save: {
			subject: 'The expense could not be saved',
			amountInvalid: 'The amount is not valid.',
			descriptionInvalid: 'The description must be 1 to {max} characters.',
			currencyInvalid: 'The currency is not valid.',
			imageInvalid: 'The attachment is not valid.',
			imageRemoved: 'The attachment was removed. Upload it again.',
			expectedUpdatedAtInvalid: 'Reload the list and try again.',
			occurredAtInvalid: 'Check the expense date.',
			splitsDuplicateDebtor: 'The split lists a person twice. Each person can appear only once.',
			notPayer: 'Only the payer can edit this expense.',
			hasSettledShares:
				'A share is already settled, so the amount and split stay as they are; you can still change the description, date and category.',
			recurringPaused: 'This fixed cost is paused. Resume it under Fixed costs.',
			recurringAdvanced:
				'This fixed cost was already recorded for this due date. Reload the expenses and check the list.',
			recurringChanged:
				'This fixed cost has been changed in the meantime. The list has been reloaded: check the amount and split, then book it again.',
			memberNotInWg: 'At least one member is no longer in this flat.',
			insertFailed: 'Check the expense list and try again.',
			splitInsertFailed:
				'The expense could not be saved completely: reload the expenses and check the split.',
			fetchFailed: 'The expense may have been saved: reload the expenses and check the entry.',
		},
		template: {
			subject: 'The template could not be saved',
			memberNotInWg: 'At least one member of the fixed-cost template is no longer in this flat.',
			insertFailed: 'Check the list and try again.',
			updateFailed:
				'The template could not be updated: reload the expenses and check the template.',
			amountInvalid: 'Check the amount.',
			descriptionInvalid: 'Enter a description.',
			intervalInvalid: 'Choose a valid interval.',
			dueDateInvalid: 'Check the next due date.',
			changed: 'The template has just been used or changed. Reload the expenses and edit it again.',
		},
		templateDelete: {
			subject: 'The template could not be deleted',
			idInvalid: 'This template could not be identified.',
			deleteFailed: 'Reload the expenses and check whether it still exists.',
		},
		advance: {
			alreadyAdvanced:
				'The expense was recorded, but the template had already moved to the next due date. Check whether this fixed cost was recorded twice.',
			updateFailed:
				'The expense was recorded, but the fixed-cost template could not be moved to the next due date. Reload the expenses and check the next due date.',
			generic:
				'The expense was recorded, but the fixed-cost template could not be moved to the next due date. Check it again later.',
		},
		split: {
			invalidShare:
				'At least one share is not valid. Enter a valid amount or leave the field empty.',
			empty: 'The split is empty. Enter at least one amount.',
			noMembers: 'Choose at least one person involved.',
		},
	},
} satisfies Catalog<typeof de>;
