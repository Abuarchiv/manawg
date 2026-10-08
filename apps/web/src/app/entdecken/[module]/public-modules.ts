// Titles/descriptions mirror the module copy in PublicApp — kept here too so
// this Server Component can export per-route metadata (WCAG 2.4.2: every
// route needs its own descriptive title, not the generic app-wide one).
export const PUBLIC_MODULES: Record<string, { title: string; description: string }> = {
	ausgaben: { title: 'Ausgaben', description: 'Gemeinsame Kosten im Blick.' },
	einkauf: { title: 'Einkäufe', description: 'Was gekauft werden muss.' },
	pinnwand: { title: 'Pinnwand', description: 'Infos für alle.' },
	putzen: { title: 'Putzplan', description: 'Aufgaben fair verteilen.' },
	fixkosten: { title: 'Fixkosten', description: 'Wiederkehrende Kosten.' },
	mahnungen: { title: 'Erinnerungen', description: 'Wer noch zahlen muss.' },
	vorraete: { title: 'Vorräte', description: 'Was noch da ist.' },
	kalender: { title: 'Kalender', description: 'Gemeinsame Termine.' },
	aktivitaet: { title: 'Aktivität', description: 'Was zuletzt passiert ist.' },
	chat: { title: 'Chat', description: 'Kurz etwas klären.' },
};
