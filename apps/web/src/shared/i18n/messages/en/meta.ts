import type { Catalog } from '../catalog';
import type de from '../de/meta';

export default {
	brand: {
		title: 'ManaWG, die WG-App: Ausgaben, Einkauf, Putzplan für eure WG',
		description:
			'Mit ManaWG teilt ihr Ausgaben, organisiert Einkäufe und verteilt Aufgaben im Putzplan. Die App ist kostenlos und läuft im Browser.',
	},
} satisfies Catalog<typeof de>;
