import type { Catalog } from '../catalog';
import type de from '../de/offline';
import failure from './offline-failure';

export default {
	failure,
	state: {
		reviewRequired:
			'Needs a check. The first version may already be saved. The edit was not sent. Compare the flat entry and only then discard this action; queue any changes you still need again.',
		replayExpired:
			'Needs a check. The safe retry window has passed. This action may already be saved and will not be sent again. Compare the flat entry and only then discard this action; queue only the changes that are missing.',
		invalidActionTime:
			'Needs a check. The time of this action is unclear. It may already be saved and will not be sent again. Compare the flat entry and only then discard this action; queue only the changes that are missing.',
		serverCheck: 'Needs a check. {title}: {detail}',
		imageMissing:
			'Image missing. The local attachment is no longer available. Remove the attachment in the offline queue or choose the image again.',
		imageRemoved:
			'Image removed. Remove the attachment in the offline queue or choose the image again.',
		recurringAdvance:
			'Fixed cost template not advanced. The expense was created. The template stays in the queue to catch up.',
		reauth: 'Sign-in needed again. Open the flat again or join with a current invite link.',
		idempotency:
			'The action could not be prepared for safe sending. It stays saved and is not sent; try again later.',
	},
	copy: {
		queueCount:
			'{count, plural, =0 {No offline actions waiting.} one {# action waiting.} other {# actions waiting.}}',
		synced: '{count, plural, one {# action synced.} other {# actions synced.}}',
		remaining:
			'{count, plural, one {# action is still waiting.} other {# actions are still waiting.}}',
		syncedAndRemaining: '{synced} {remaining}',
		syncedOffline:
			'{count, plural, one {# offline action synced.} other {# offline actions synced.}}',
		queued:
			'{count, plural, one {# offline action is waiting to sync.} other {# offline actions are waiting to sync.}}',
		reviewNeeded:
			'{count, plural, one {# action needs your review.} other {# actions need your review.}}',
		replayUnsupported:
			'This browser cannot send the queue from here. Open the app over https in a current browser so the actions can be transferred.',
		nothingLeft: 'No actions waiting any more.',
		nothingSynced: 'Nothing synced yet. The actions stay safely saved.',
		syncNotStarted: 'Syncing could not be started. Check your connection; the actions stay saved.',
	},
	summary: {
		verbatim: '{text}',
		shopping: { title: 'Shopping', fallback: 'New item', itemFallback: 'Item' },
		shoppingUpdate: '{bought, select, yes {Tick off {name}} other {Reopen {name}}}',
		announcement: { title: 'Noticeboard post', fallback: 'New post' },
		absence: { title: 'Away', detail: 'The rota skips this person' },
		chore: { title: 'Cleaning rota task', fallback: 'New task' },
		choreComplete: { title: 'Cleaning rota', detail: 'Mark task as done' },
		expense: { title: 'Expense', fallback: 'New expense' },
		expenseUpdate: { title: 'Update expense', fallback: 'Expense' },
		recurring: { title: 'Fixed cost template', fallback: 'New template' },
		recurringAdvance: { title: 'Fixed cost template', detail: 'Catch up the due date' },
	},
	risk: {
		stale: {
			title: 'Check before sending',
			detail: 'Check the entry before you send it again.',
		},
		shoppingUpdate: {
			title: 'Check status',
			detail: 'Check whether someone else has changed the shopping item in the meantime.',
		},
		announcement: {
			title: 'Check noticeboard',
			detail: 'Check whether the content, category or status is out of date.',
		},
		absence: {
			title: 'Check away period',
			detail: 'Check whether the period or the cleaning rota has changed.',
		},
		chore: {
			title: 'Check cleaning rota',
			detail: 'Check whether the task, interval or assignment has changed.',
		},
		choreComplete: {
			title: 'Possible conflict',
			detail: 'Check whether the task has already been completed or reassigned.',
		},
		expense: {
			title: 'Check split',
			detail: 'If members or amounts have changed, edit the expense before sending.',
		},
		expenseUpdate: {
			title: 'Check version',
			detail: 'The expense is only updated if it has not changed since you edited it.',
		},
		recurring: {
			title: 'Check fixed costs',
			detail: 'Check the due date and split before the template is sent.',
		},
		recurringAdvance: {
			title: 'Check fixed costs',
			detail: 'Check whether the template has already been advanced.',
		},
		timeUnclear: {
			title: 'Check time',
			detail: 'The saved time is unclear. Check the entry before sending again.',
		},
		timeFuture: {
			title: 'Check time',
			detail: 'The saved time is in the future. Check the entry before sending.',
		},
	},
	conflict: {
		unknownDate: 'Date unknown',
		templateExists:
			'The same fixed cost template already exists. Its next due date is {date}. Check before sending whether this would be a duplicate.',
		advanceSame:
			'The server template is still on the expected due date, {expected}. You can send the offline action.',
		advanceMoved:
			'The server template is now on {server} instead of {expected}. Check before sending whether the due date has already been caught up.',
	},
	serverCheck: {
		notFound: 'Not found on the server.',
		shoppingDuplicate:
			'A similar shopping item already exists. It is {done, select, yes {done} other {open}} there. Check before sending whether this would be a duplicate.',
		shoppingFound:
			'Server version found. It is {done, select, yes {done} other {open}} there. Check before sending again whether that is still right.',
		shoppingGone: 'The shopping item no longer exists on the server.',
		announcementDuplicate:
			'The same noticeboard post already exists. It is {resolved, select, yes {resolved} other {open}} there. Check before sending whether this would be a duplicate.',
		choreFound: 'Server version found. Check who is responsible and the due date before sending.',
		choreGone: 'The task no longer exists on the server.',
		choreDuplicate:
			'The same cleaning task already exists. Its interval there is every {days, plural, one {day} other {# days}}. Check before sending whether this would be a duplicate.',
		absenceDuplicate: 'The same away period already exists on the server.',
		expenseDuplicate:
			'The same expense with the same amount already exists. Check before sending whether this would be a duplicate.',
		templateGone: 'This fixed cost template no longer exists on the server.',
	},
	page: {
		heading: 'Queue',
		unauthenticated: 'After you sign in, you will see your waiting actions.',
		queued:
			'{count, plural, =0 {No actions waiting.} one {# action waiting.} other {# actions waiting.}}',
		wgQueued:
			'{count, plural, =0 {No actions waiting} one {# action waiting} other {# actions waiting}}',
		queueLabel: 'Waiting offline actions',
		hidden:
			'+{count, plural, one {# more action} other {# more actions}} in the queue. {link} opens the full list.',
		hiddenLink: 'Check all actions',
		age: {
			unclear: 'Time unclear',
			future: 'Time in the future',
			justNow: 'just now',
			minutes: '{count} min ago',
			hours: '{count} h ago',
			days: '{count, plural, one {# day} other {# days}} ago',
		},
		label: {
			checking: 'Checking…',
			browserOffline: 'Offline mode',
			serverUnreachable: 'Server unreachable',
			unauthenticated: 'Sign-in needed',
			ready: 'Back online',
		},
		title: {
			checking: 'Checking your connection…',
			offline: 'You are offline right now.',
			serverUnreachable: 'The server is unreachable right now.',
			unauthenticated: 'Sign in to see your offline actions.',
			online: 'You are connected again.',
		},
		description: {
			checking: 'One moment, we are checking your connection and your account.',
			browserOffline:
				'Your locally saved actions stay visible. Once you are back online, you can sync them.',
			serverUnreachable:
				'The server is not responding right now. Your locally saved actions are kept; try again later.',
			unauthenticated: 'Offline actions and remembered flats belong to your account.',
			readyWithFlat: 'Your connection is back. Sync waiting actions or go back to your flat.',
			readyWithoutFlat: 'Your connection is back. You can sync waiting actions now.',
		},
		recheckLabel: 'Check offline status again',
		recheck: 'Check',
		backTo: 'Back to {name}',
		signIn: 'Sign in',
		syncingLabel: 'Syncing offline actions',
		syncNowLabel: 'Sync offline actions now',
		syncNow: 'Sync now',
		syncTitle: 'Sync',
		otherAccount: 'Actions from another account on this device are not shown here.',
		signInFirst: 'Sign in before you sync offline actions.',
		noMatchingFlat: 'The flat for these actions is missing from your account. They stay saved.',
		stays: '{modules} stays saved on this device.',
		reloadOnline: 'Reload the page once you are online.',
		flats: {
			titleNone: 'Your flats',
			titleSome: 'Back to your flat',
			openLater:
				'{count, plural, one {Your flat opens once you are back online.} other {Your flats open once you are back online.}}',
			looking: 'Looking for remembered flats…',
			codeMissing:
				'You are signed in on this device, but your flat code is not saved here. Enter the code to open it.',
			codeMissingOffline:
				'You are signed in to a flat on this device, but its code is not saved here. Once you are back online, reload the page and you can open your flat again.',
			noneRemembered: 'No flat remembered on this device yet. Enter your code to join.',
			noneRememberedOffline:
				'No flat remembered on this device yet. Once you are back online, you can join again with your code.',
			listLabel: 'Known flats',
			open: 'Open {name}',
			checkActions: 'Check actions',
			enterCode: 'Enter code',
		},
	},
	queue: {
		title: 'Offline queue',
		retry: 'Try again',
		syncingLabel: 'Syncing offline queue',
		retryLabel: 'Sync offline queue again',
		storageBlockedDiscard: 'Offline storage is blocked. The action could not be discarded.',
		storageBlockedAttachment: 'Offline storage is blocked. The attachment could not be removed.',
		storageBlockedDraft: 'Offline storage is blocked. The draft could not be opened for editing.',
		attachmentRemoved: 'Attachment removed. The offline action can sync again.',
		draftExists:
			'Another unsaved form draft already exists for this section. Open the form, save or discard it, then edit the entry in the queue.',
		compareFailed:
			'The server comparison could not be loaded. Try again before you send this action.',
		compareReady: 'Server comparison ready. Edit the draft if the content or split has changed.',
		discardTitle: 'Discard offline action?',
		discardBody: '“{summary}” has not been sent yet and cannot be restored once discarded.',
		keep: 'Keep',
		discard: 'Discard',
		attempts: '{count}x',
		inspect: 'Check flat entry',
		inspectLabel: 'Check flat entry: {action}',
		compare: 'Compare with server',
		comparing: 'Comparing…',
		compareLabel: 'Compare with server: {action}',
		edit: 'Edit',
		editLabel: 'Edit offline action: {action}',
		removeAttachment: 'Remove attachment',
		removeAttachmentLabel: 'Remove attachment: {action}',
		discardLabel: 'Discard offline action: {action}',
	},
} satisfies Catalog<typeof de>;
