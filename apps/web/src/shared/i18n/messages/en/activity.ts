import type { Catalog } from '../catalog';
import type de from '../de/activity';

export default {
	reminder: {
		choreStuck: '{title} has been stuck for {days} days',
		choreDetail: '{assignee} is assigned. Catch up, take over or sort it out quickly.',
		nobody: 'Nobody',
		announcementOpen: 'Noticeboard post open for {days} days',
		shoppingOpen: '{name} has been on the list for {days} days',
		shoppingDetail: 'Check whether you still need it.',
	},
	loadError: { lead: 'Activity could not be loaded' },
	error: {
		title: 'Activity could not be loaded just now',
		body: 'An error occurred in the activity feed. Please try again or go back to the flat overview.',
	},
	feed: {
		emptyTitle: 'No activity yet',
		emptyDescription: 'What happens in the flat shows up here: expenses, shopping, cleaning rota.',
		history: 'Activity history',
		you: 'You',
	},
	page: {
		heading: 'Activity',
		reload: 'Reload activity',
		searchPlaceholder: 'Search',
		searchLabel: 'Search activity',
		scope: 'Area',
		kinds: {
			all: 'All',
			expense: 'Expenses',
			shopping: 'Shopping',
			announcement: 'Noticeboard',
			chore: 'Cleaning rota',
			recurring: 'Fixed costs',
			absence: 'Away',
			audit: 'Flat changes',
		},
		who: 'Who',
		onlyMe: 'Only me',
		open: 'Open',
		openLabel: 'Open matters',
		visibleCount:
			'{count, plural, =0 {No visible entries.} one {# entry visible.} other {# entries visible.}}',
		today: 'Today',
		yesterday: 'Yesterday',
		noMatch: 'No activity for this filter',
		resetFilters: 'Reset filters',
		filteredWithin: 'Filtering within the latest {count} entries.',
		loadOlder: 'Load older entries',
		loadingLabel: 'Loading activity',
		notLoaded: 'No activity loaded. Try again.',
	},
} satisfies Catalog<typeof de>;
