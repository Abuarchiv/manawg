import type { Catalog } from '../catalog';
import type de from '../de/meta';

export default {
	brand: {
		title: 'ManaWG, the flat app: expenses, shopping and cleaning rota for your flat',
		description:
			'With ManaWG you share expenses, organise shopping and split tasks on the cleaning rota. The app is free and runs in the browser.',
	},
	authReset: { title: 'Reset password' },
	invite: {
		title: 'You have been invited to a flat',
		description:
			'Join your flat on ManaWG: expenses, cleaning rota, shopping and noticeboard. Free, in the browser, hosted in Germany.',
	},
	discover: {
		description:
			'{description} The flat app for expenses, cleaning rota, shopping and noticeboard.',
	},
	join: {
		title: 'Create or join a flat',
		description: 'Create a flat or join one with an invitation.',
	},
	notFound: { title: 'Page not found' },
	offline: { title: 'Offline' },
	register: {
		title: 'Create account',
		description: 'Create your ManaWG account to set up or join a flat.',
	},
	wg: { fallbackName: 'Flat', notFound: 'Flat not found' },
	pages: {
		recurring: 'Fixed costs',
		statement: 'Monthly statement',
		activity: 'Activity',
		expenses: 'Expenses',
		chat: 'Chat',
		shopping: 'Shopping',
		settings: 'Settings',
		import: 'Import expenses',
		calendar: 'Calendar',
		reminders: 'Reminders',
		pinboard: 'Noticeboard',
		chores: 'Cleaning rota',
		supplies: 'Supplies',
	},
} satisfies Catalog<typeof de>;
