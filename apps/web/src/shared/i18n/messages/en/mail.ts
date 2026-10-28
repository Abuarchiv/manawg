import type { Catalog } from '../catalog';
import type de from '../de/mail';

export default {
	shell: {
		linkFallback: 'If the button does not work: {url}',
		legalNotice: 'Legal notice (German)',
		privacy: 'Privacy policy (German)',
		changeSettings: 'Change settings',
		unsubscribe: 'Unsubscribe',
	},
	welcome: {
		subject: 'Welcome to ManaWG',
		preheader: 'Three steps, then your flat is up and running.',
		title: 'Different people, one shared everyday life.',
		intro:
			'{named, select, yes {Hello {firstName}, your account is ready.} other {Your account is ready.}} ManaWG keeps expenses, the cleaning rota, shopping and events for everyone in the flat in one place.',
		stepCreate: 'Create a flat or join with an invitation',
		stepInvite: 'Invite your flatmates',
		stepFirstExpense: 'Add the first expense',
		button: 'Set up your flat',
		footer: 'You are receiving this email because you created a ManaWG account.',
	},
	invitation: {
		subject: '{inviter} has invited you to join {wgName}',
		title: '{inviter} has invited you to join {wgName}.',
		eyebrow: 'Invitation',
		preheader:
			'{count, plural, one {One person is already a member.} other {# people are already members.}}',
		captionOne: '{name} is already a member.',
		captionMany: '{names} are already members.',
		captionMore: '{names} and {count} more are already members.',
		button: 'Accept invitation',
		footer:
			'The link is valid for {days, plural, one {# day} other {# days}}. {inviter} entered your address. We do not store it beyond this email.',
	},
	reminder: {
		subject: '{amount} to {creditor}, still open',
		title: 'Still open to {creditor}.',
		amountLabel: 'Still open to {creditor}',
		eyebrow: 'Reminder',
		age: '{days, plural, =0 {The oldest item is from today.} one {The oldest item is # day old.} other {The oldest item is # days old.}}',
		netted:
			'The newest items. Payments and expenses going the other way are already offset against the amount above.',
		oneClick: 'One click and you are settled up. {creditor} sees it in the app straight away.',
		button: 'Settle up now',
		footer: 'Reminders come at most once a week, and only if you have turned them on.',
	},
	accountDeleted: {
		subject: 'Your account has been deleted',
		preheader: 'Your login has been removed.',
		title: 'Your account has been deleted.',
		removed:
			'Your login and your push and calendar subscriptions have been removed. Your name stays on earlier entries in your flat, so the amounts still add up for the others.',
		thanks: 'Thank you for the time together. You can create a new account at any time.',
		footer: 'This is the last email you will get from us.',
	},
	statement: {
		subject: 'The {month} statement is ready',
		title: 'The {month} statement is ready.',
		preheader:
			'{people, plural, one {# person} other {# people}}, {expenses, plural, one {# expense} other {# expenses}}, {status, select, settled {all settled} owed {you are owed {amount}} other {you owe {amount}}}.',
		segmentSettled: 'All settled',
		segmentOwed: 'You are owed',
		segmentOwes: 'You owe',
		total: 'Total',
		expenses: 'Expenses',
		share: 'Your share',
		transferFrom: 'from {name}',
		transferTo: 'to {name}',
		viewStatement: 'View statement',
		cadence: 'Once a month, on the 1st. As a PDF in the app.',
	},
} satisfies Catalog<typeof de>;
