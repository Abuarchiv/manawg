export default {
	shell: {
		linkFallback: 'Falls der Button nicht geht: {url}',
		legalNotice: 'Impressum',
		privacy: 'Datenschutz',
		changeSettings: 'Einstellungen ändern',
		unsubscribe: 'Abbestellen',
	},
	welcome: {
		subject: 'Willkommen bei ManaWG',
		preheader: 'Drei Schritte, dann läuft eure WG.',
		title: 'Verschiedene Menschen teilen einen Alltag.',
		intro:
			'{named, select, yes {Hallo {firstName}, dein Konto ist bereit.} other {Dein Konto ist bereit.}} ManaWG hält Ausgaben, Putzplan, Einkauf und Termine für alle in der WG an einem Ort.',
		stepCreate: 'WG anlegen oder per Einladung beitreten',
		stepInvite: 'Mitbewohner einladen',
		stepFirstExpense: 'Erste Ausgabe eintragen',
		button: 'WG einrichten',
		footer: 'Du erhältst diese E-Mail, weil du ein Konto bei ManaWG erstellt hast.',
	},
	invitation: {
		subject: '{inviter} lädt dich in die WG {wgName} ein',
		title: '{inviter} lädt dich in die WG {wgName} ein.',
		eyebrow: 'Einladung',
		preheader:
			'{count, plural, one {Eine Person ist schon dabei.} other {# Leute sind schon dabei.}}',
		captionOne: '{name} ist schon dabei.',
		captionMany: '{names} sind schon dabei.',
		captionMore: '{names} und {count} weitere sind schon dabei.',
		button: 'Einladung annehmen',
		footer:
			'Der Link gilt {days} Tage. {inviter} hat deine Adresse eingegeben, wir speichern sie nicht weiter.',
	},
	reminder: {
		subject: 'Noch offen bei {creditor}: {amount}',
		title: 'Noch offen bei {creditor}.',
		amountLabel: 'Noch offen bei {creditor}',
		eyebrow: 'Erinnerung',
		age: '{days, plural, =0 {Ältester Posten von heute.} one {Ältester Posten # Tag alt.} other {Ältester Posten # Tage alt.}}',
		netted:
			'Die neuesten Posten. Zahlungen und Ausgaben in die andere Richtung sind im Betrag oben schon verrechnet.',
		oneClick: 'Ein Klick, und ihr seid quitt. {creditor} sieht es sofort in der App.',
		button: 'Jetzt ausgleichen',
		footer:
			'Erinnerungen kommen höchstens alle zwei Tage von derselben Person und nur, wenn du sie eingeschaltet hast.',
	},
	accountDeleted: {
		subject: 'Dein Konto ist gelöscht',
		preheader: 'Dein Login ist entfernt.',
		title: 'Dein Konto ist gelöscht.',
		removed:
			'Dein Login sowie deine Push- und Kalender-Abos sind entfernt. Dein Name bleibt in den bisherigen Einträgen eurer WG stehen, damit die Beträge für die anderen stimmen.',
		thanks: 'Danke für die gemeinsame Zeit. Du kannst jederzeit ein neues Konto erstellen.',
		footer: 'Das ist die letzte E-Mail, die du von uns bekommst.',
	},
	statement: {
		subject: '{month} ist abgerechnet',
		title: '{month} ist abgerechnet.',
		preheader:
			'{people, plural, one {# Person} other {# Personen}}, {expenses, plural, one {# Ausgabe} other {# Ausgaben}}, {status, select, settled {alles ausgeglichen} owed {du bekommst {amount}} other {du schuldest {amount}}}.',
		segmentSettled: 'Alles ausgeglichen',
		segmentOwed: 'Du bekommst',
		segmentOwes: 'Du schuldest',
		total: 'Gesamt',
		expenses: 'Ausgaben',
		share: 'Dein Anteil',
		transferFrom: 'von {name}',
		transferTo: 'an {name}',
		viewStatement: 'Abrechnung ansehen',
		cadence: 'Einmal im Monat, am Ersten. Als PDF in der App.',
	},
} as const;
