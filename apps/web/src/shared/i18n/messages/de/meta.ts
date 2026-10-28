export default {
	brand: {
		title: 'ManaWG, die WG-App: Ausgaben, Einkauf, Putzplan für eure WG',
		description:
			'Mit ManaWG teilt ihr Ausgaben, organisiert Einkäufe und verteilt Aufgaben im Putzplan. Die App ist kostenlos und läuft im Browser.',
	},
	authReset: { title: 'Passwort zurücksetzen' },
	invite: {
		title: 'Du bist in eine WG eingeladen',
		description:
			'Tritt deiner WG auf ManaWG bei: Ausgaben, Putzplan, Einkauf und Pinnwand. Kostenlos, im Browser, in Deutschland gehostet.',
	},
	discover: {
		description: '{description} Die WG-App für Ausgaben, Putzplan, Einkauf und Pinnwand.',
	},
	join: {
		title: 'WG erstellen oder beitreten',
		description: 'WG erstellen oder mit einer Einladung beitreten.',
	},
	notFound: { title: 'Seite nicht gefunden' },
	offline: { title: 'Offline' },
	register: {
		title: 'Konto erstellen',
		description: 'Lege dein ManaWG-Konto an, um eine WG zu erstellen oder einer WG beizutreten.',
	},
	wg: { fallbackName: 'WG', notFound: 'WG nicht gefunden' },
	pages: {
		recurring: 'Fixkosten',
		statement: 'Monatsabrechnung',
		activity: 'Aktivität',
		expenses: 'Ausgaben',
		chat: 'Chat',
		shopping: 'Einkäufe',
		settings: 'Einstellungen',
		import: 'Ausgaben importieren',
		calendar: 'Kalender',
		reminders: 'Erinnerungen',
		pinboard: 'Pinnwand',
		chores: 'Putzplan',
		supplies: 'Vorräte',
	},
} as const;
