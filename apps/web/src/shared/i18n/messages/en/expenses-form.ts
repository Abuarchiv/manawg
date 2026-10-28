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
		saveTemplateAria: 'Save template for fixed costs',
		saveAsExpense: 'Save as expense',
		save: 'Save',
		saveAria: 'Save expense',
	},
	fields: {
		description: 'Description',
		descriptionPlaceholder: 'e.g. weekly shop',
		amount: 'Amount',
		amountPlaceholder: '0.00',
		category: 'Category',
		date: 'Date',
		paidBy: 'Paid by',
		payerYou: '{name} (you)',
		payerLocked: 'The payer of an existing expense cannot be changed.',
	},
	actions: {
		cancelAria: 'Cancel expense',
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
		closeBody:
			'No expense is saved. You can carry on with your draft later or discard it explicitly.',
		closeContinue: 'Keep editing',
		closeDiscard: 'Discard draft',
		closeKeep: 'Keep draft',
		existingKept: 'Your existing draft stays.',
		replaceWith: 'Discard draft and use “{description}”',
		notSynced: 'Not synced yet. The change is sent once you’re online.',
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
		reopened:
			'The share of {name} ({previous}) is already marked as paid and will be reopened because of this change{removed, select, yes { (no longer applies).} other { (new {next}).}}',
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
		templateSaved: 'Saved as a template. You’ll find it under Fixed costs.',
	},
	intervals: {
		optionMonths: '{count, plural, one {# month} other {# months}}',
		optionQuarter: 'Quarter',
		optionYear: 'Year',
		monthly: 'monthly',
		quarterly: 'quarterly',
		halfYearly: 'half-yearly',
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
			'The link to this draft is damaged. Open the original expense again or discard the draft.',
		draftBrokenKept:
			'The link to this draft is damaged. Your entries are kept; open the original expense again or discard the draft.',
		reloadFailed: 'The list could not be reloaded. Try again in a moment.',
		conflict:
			'This expense has been changed in the meantime. Reload the list, then decide which version is right.',
		templateUnavailable:
			'The fixed-cost template is not available. Refresh the page and try again.',
		saved: 'Expense saved. No money is transferred here.',
		updated: 'Expense updated. No money is transferred here.',
		keyUnavailableExpense: 'The expense could not be sent safely. Try again.',
		keyUnavailableRecurring: 'The fixed-cost expense could not be sent safely. Try again.',
		keyUnavailableTemplate: 'The fixed-cost template could not be saved safely. Try again.',
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
	},
	errors: {
		withPeriod: '{subject}.',
		invalidRequest: 'The request was invalid.',
		splitSumMismatch: 'The amounts do not add up — the total must match the full amount exactly.',
		paidByMustIncludeCaller: 'If you book for someone else, your own share must be more than 0.',
		notTemplateOwner:
			'Only the person who created the fixed costs or a flat admin can change or delete them.',
		recurringNotFound: 'This fixed-cost template no longer exists. Reload the expenses.',
		editedExpenseDeleted:
			'The original expense was deleted. Your unsaved changes stay in the draft; you can copy them or discard the draft.',
		save: {
			subject: 'The expense could not be saved',
			amountInvalid: 'The amount is invalid.',
			descriptionInvalid: 'The description must be 1 to {max} characters.',
			currencyInvalid: 'The currency is invalid.',
			imageInvalid: 'The attachment is invalid.',
			imageRemoved: 'The attachment was removed. Upload it again.',
			expectedUpdatedAtInvalid: 'Reload the list and try again.',
			occurredAtInvalid: 'Check the expense date.',
			splitsDuplicateDebtor: 'The split lists a person twice — each person can appear only once.',
			notPayer: 'Only the payer can edit this expense.',
			hasSettledShares:
				'A share is already settled, so the amount and split stay as they are; you can still change the description, date and category.',
			aboPaused: 'These fixed costs are paused. Resume them under Fixed costs.',
			recurringAdvanced:
				'These fixed costs were already recorded for this due date. Reload the expenses and check the list.',
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
			changed: 'The template was just recorded or changed. Reload the expenses and edit it again.',
		},
		templateDelete: {
			subject: 'The template could not be deleted',
			idInvalid: 'This template could not be matched clearly.',
			deleteFailed: 'Reload the expenses and check whether it still exists.',
		},
		advance: {
			alreadyAdvanced:
				'The expense was recorded, but the template had already moved on. Check whether these fixed costs were recorded twice.',
			updateFailed:
				'The expense was recorded, but the fixed-cost template could not be moved on. Reload the expenses and check the next due date.',
			generic:
				'The expense was recorded, but the fixed-cost template could not be moved on. Check it again later.',
		},
		split: {
			invalidShare: 'At least one share is invalid. Enter a valid amount or leave the field empty.',
			empty: 'The split is empty — enter at least one amount.',
			noMembers: 'Choose at least one person involved.',
		},
	},
} satisfies Catalog<typeof de>;
