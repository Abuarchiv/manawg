import type { Catalog } from '../catalog';
import type de from '../de/server-pages';

export default {
	unsubscribe: {
		statement: {
			title: 'Unsubscribe from the monthly statement',
			question: 'Unsubscribe from the monthly statement?',
			explain:
				'You will no longer get the statement by email at the start of each month. It stays available in the app.',
			done: 'You will no longer get the monthly statement by email. You can turn it back on under Settings in the app.',
		},
		reminders: {
			title: 'Unsubscribe from reminders',
			question: 'Unsubscribe from reminders about open amounts?',
			explain:
				'Flatmates will no longer be able to remind you about open amounts by email or push. Your balances stay visible in the app.',
			done: 'You will no longer get reminders. You can turn them back on under Settings in the app.',
		},
		submit: 'Unsubscribe',
		hint: 'You can turn it back on under Settings at any time.',
		doneTitle: 'Unsubscribed',
		doneHeading: 'Unsubscribed.',
	},
} satisfies Catalog<typeof de>;
