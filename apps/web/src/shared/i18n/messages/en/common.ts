import type { Catalog } from '../catalog';
import type de from '../de/common';

export default {
	skipToContent: 'Skip to main content',
	loading: 'Loading…',
	unknownPerson: 'Unknown',
	errors: {
		withSubject: '{subject}: {detail}',
		network: 'Check your connection and try again.',
		retry: 'Try again in a moment.',
		rateLimited: 'Too many requests. Wait a moment, then try again.',
		readOnly: 'The app is in maintenance and read-only right now. Try again later.',
		maintenance: 'The app is in maintenance right now. Try again later.',
		sessionExpired: 'Your session has expired. Sign in again.',
		signInAgain: 'Sign in again.',
		wgUnavailable: 'Open the flat again using the current link.',
		invalidShareCode: 'The flat code is not valid.',
		authInvalidated: 'Join the flat again.',
		queryTooLong: 'The search term is too long.',
	},
	loadError: {
		withoutDetail: '{lead}.',
		lead: {
			expenses: 'Expenses could not be loaded',
		},
	},
	time: {
		unknown: 'Time unknown',
		justNow: 'just now',
		minutesAgo: '{count} min ago',
		hoursAgo: '{count} h ago',
		yesterday: 'yesterday',
		daysAgo: '{count} days ago',
		minutesAhead: 'in {count} min',
		hoursAhead: 'in {count} h',
		tomorrow: 'tomorrow',
		daysAhead: 'in {count} days',
		date: '{date}',
		thisWeek: 'This week',
		lastWeek: 'Last week',
		weekOf: 'Week of {date}',
	},
} satisfies Catalog<typeof de>;
