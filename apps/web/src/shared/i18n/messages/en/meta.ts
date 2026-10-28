import type { Catalog } from '../catalog';
import type de from '../de/meta';

export default {
	brand: {
		title: 'ManaWG, die WG-App: Ausgaben, Einkauf, Putzplan für eure WG',
		description:
			'Mit ManaWG teilt ihr Ausgaben, organisiert Einkäufe und verteilt Aufgaben im Putzplan. Die App ist kostenlos und läuft im Browser.',
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
		abos: 'Fixed costs',
		abrechnung: 'Monthly statement',
		aktivitaet: 'Activity',
		ausgaben: 'Expenses',
		chat: 'Chat',
		einkauf: 'Shopping',
		einstellungen: 'Settings',
		import: 'Import expenses',
		kalender: 'Calendar',
		mahnungen: 'Reminders',
		pinnwand: 'Noticeboard',
		putzen: 'Cleaning rota',
		vorraete: 'Supplies',
	},
} satisfies Catalog<typeof de>;
