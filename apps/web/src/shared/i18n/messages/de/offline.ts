import failure from './offline-failure';

export default {
	failure,
	state: {
		reviewRequired:
			'Server prüfen: Die erste Version kann bereits gespeichert sein. Die Bearbeitung wurde nicht gesendet. Vergleiche den WG-Eintrag und verwirf diese Aktion erst danach; lege benötigte Änderungen neu an.',
		replayExpired:
			'Server prüfen: Die sichere Wiederholungsfrist ist abgelaufen. Diese Aktion kann bereits gespeichert sein und wird nicht erneut gesendet. Vergleiche den WG-Eintrag und verwirf diese Aktion erst danach; lege nur fehlende Änderungen neu an.',
		invalidActionTime:
			'Server prüfen: Der Zeitpunkt dieser Aktion ist unklar. Sie kann bereits gespeichert sein und wird nicht erneut gesendet. Vergleiche den WG-Eintrag und verwirf diese Aktion erst danach; lege nur fehlende Änderungen neu an.',
		serverCheck: 'Server prüfen: {title}: {detail}',
		imageMissing:
			'Bild fehlt: Der lokale Anhang ist nicht mehr verfügbar. Entferne den Anhang in der Offline-Warteschlange oder wähle das Bild erneut aus.',
		imageRemoved:
			'Bild wurde entfernt: Entferne den Anhang in der Offline-Warteschlange oder wähle das Bild erneut aus.',
		recurringAdvance:
			'Fixkosten-Vorlage nicht weitergeschoben: Die Ausgabe wurde erstellt. Die Vorlage bleibt zur Nachholung in der Warteschlange.',
		reauth:
			'Erneute Anmeldung erforderlich: Öffne die WG erneut oder tritt mit einem aktuellen Einladungslink bei.',
		idempotency:
			'Die Aktion konnte nicht für das sichere Senden vorbereitet werden. Sie bleibt gespeichert und wird nicht gesendet; versuche es später erneut.',
	},
	copy: {
		queueCount:
			'{count, plural, =0 {Keine wartenden Offline-Aktionen.} one {# Aktion wartet.} other {# Aktionen warten.}}',
		synced: '{count, plural, one {# Aktion synchronisiert.} other {# Aktionen synchronisiert.}}',
		remaining: '{count, plural, one {# Aktion wartet weiter.} other {# Aktionen warten weiter.}}',
		syncedAndRemaining: '{synced} {remaining}',
		syncedOffline:
			'{count, plural, one {# Offline-Aktion synchronisiert.} other {# Offline-Aktionen synchronisiert.}}',
		queued:
			'{count, plural, one {# Offline-Aktion wartet auf Synchronisierung.} other {# Offline-Aktionen warten auf Synchronisierung.}}',
		reviewNeeded:
			'{count, plural, one {# Aktion braucht deine Prüfung.} other {# Aktionen brauchen deine Prüfung.}}',
		replayUnsupported:
			'Dieser Browser kann die Warteschlange hier nicht senden. Öffne die App über https in einer aktuellen Browser-Version, damit die Aktionen übertragen werden.',
		nothingLeft: 'Keine wartenden Aktionen mehr.',
		nothingSynced: 'Noch nichts synchronisiert. Die Aktionen bleiben sicher gespeichert.',
		syncNotStarted:
			'Synchronisierung konnte nicht gestartet werden. Prüfe deine Verbindung; die Aktionen bleiben gespeichert.',
	},
	summary: {
		verbatim: '{text}',
		shopping: { title: 'Einkauf', fallback: 'Neuer Artikel', itemFallback: 'Artikel' },
		shoppingUpdate: '{bought, select, yes {{name} abhaken} other {{name} wieder öffnen}}',
		announcement: { title: 'Pinnwand-Beitrag', fallback: 'Neuer Beitrag' },
		absence: { title: 'Abwesenheit', detail: 'Rotation überspringt diese Person' },
		chore: { title: 'Putzplan-Aufgabe', fallback: 'Neue Aufgabe' },
		choreComplete: { title: 'Putzplan', detail: 'Aufgabe als erledigt markieren' },
		expense: { title: 'Ausgabe', fallback: 'Neue Ausgabe' },
		expenseUpdate: { title: 'Ausgabe aktualisieren', fallback: 'Ausgabe' },
		recurring: { title: 'Fixkosten-Vorlage', fallback: 'Neue Vorlage' },
		recurringAdvance: { title: 'Fixkosten-Vorlage', detail: 'Fälligkeit nachholen' },
	},
	risk: {
		stale: {
			title: 'Vor dem Senden prüfen',
			detail: 'Prüfe den Eintrag, bevor du ihn erneut sendest.',
		},
		shoppingUpdate: {
			title: 'Status prüfen',
			detail: 'Prüfe kurz, ob der Einkauf inzwischen von jemand anderem geändert wurde.',
		},
		announcement: {
			title: 'Pinnwand prüfen',
			detail: 'Prüfe kurz, ob Inhalt, Kategorie oder Status inzwischen überholt sind.',
		},
		absence: {
			title: 'Abwesenheit prüfen',
			detail: 'Prüfe kurz, ob Zeitraum oder Putzplan inzwischen geändert wurden.',
		},
		chore: {
			title: 'Putzplan prüfen',
			detail: 'Prüfe kurz, ob Aufgabe, Intervall oder Zuweisung inzwischen geändert wurden.',
		},
		choreComplete: {
			title: 'Möglicher Konflikt',
			detail: 'Prüfe kurz, ob die Aufgabe inzwischen schon erledigt oder neu zugewiesen wurde.',
		},
		expense: {
			title: 'Aufteilung prüfen',
			detail:
				'Wenn sich Mitglieder oder Beträge geändert haben, bearbeite die Ausgabe vor dem Senden.',
		},
		expenseUpdate: {
			title: 'Version prüfen',
			detail: 'Die Ausgabe wird nur aktualisiert, wenn sie seit dem Bearbeiten unverändert blieb.',
		},
		recurring: {
			title: 'Fixkosten prüfen',
			detail: 'Prüfe Fälligkeit und Aufteilung, bevor die Vorlage gesendet wird.',
		},
		recurringAdvance: {
			title: 'Fixkosten prüfen',
			detail: 'Prüfe kurz, ob die Vorlage inzwischen schon weitergeschoben wurde.',
		},
		timeUnclear: {
			title: 'Zeitpunkt prüfen',
			detail: 'Der gespeicherte Zeitpunkt ist unklar. Prüfe den Eintrag vor dem erneuten Senden.',
		},
		timeFuture: {
			title: 'Zeitpunkt prüfen',
			detail: 'Der gespeicherte Zeitpunkt liegt in der Zukunft. Prüfe den Eintrag vor dem Senden.',
		},
	},
	conflict: {
		unknownDate: 'Datum unbekannt',
		templateExists:
			'Gleiche Fixkosten-Vorlage existiert schon. Nächste Fälligkeit dort: {date}. Prüfe vor dem Senden, ob es ein Duplikat wäre.',
		advanceSame:
			'Server-Vorlage ist noch auf der erwarteten Fälligkeit {expected}. Du kannst die Offline-Aktion senden.',
		advanceMoved:
			'Server-Vorlage steht inzwischen auf {server} statt {expected}. Prüfe vor dem Senden, ob die Fälligkeit schon nachgeholt wurde.',
	},
	serverCheck: {
		notFound: 'Auf dem Server nicht gefunden.',
		shoppingDuplicate:
			'Ähnlicher Einkaufsartikel existiert schon. Status dort: {done, select, yes {erledigt} other {offen}}. Prüfe vor dem Senden, ob es ein Duplikat wäre.',
		shoppingFound:
			'Server-Version gefunden. Status dort: {done, select, yes {erledigt} other {offen}}. Prüfe vor dem erneuten Senden, ob das noch stimmt.',
		shoppingGone: 'Der Einkaufsartikel existiert serverseitig nicht mehr.',
		announcementDuplicate:
			'Gleicher Pinnwand-Beitrag existiert schon. Status dort: {resolved, select, yes {geklärt} other {offen}}. Prüfe vor dem Senden, ob es ein Duplikat wäre.',
		choreFound: 'Server-Version gefunden. Prüfe Zuständigkeit und Fälligkeit vor dem Senden.',
		choreGone: 'Die Aufgabe existiert serverseitig nicht mehr.',
		choreDuplicate:
			'Gleiche Putzaufgabe existiert schon. Intervall dort: {days, plural, =1 {täglich} other {alle # Tage}}. Prüfe vor dem Senden, ob es ein Duplikat wäre.',
		absenceDuplicate: 'Gleiche Abwesenheit existiert schon auf dem Server.',
		expenseDuplicate:
			'Gleiche Ausgabe mit gleichem Betrag existiert schon. Prüfe vor dem Senden, ob es ein Duplikat wäre.',
		templateGone: 'Diese Fixkosten-Vorlage existiert serverseitig nicht mehr.',
	},
	page: {
		heading: 'Warteschlange',
		unauthenticated: 'Nach der Anmeldung siehst du deine wartenden Aktionen.',
		queued:
			'{count, plural, =0 {Keine wartenden Aktionen.} one {# Aktion wartet.} other {# Aktionen warten.}}',
		wgQueued:
			'{count, plural, =0 {Keine wartenden Aktionen} one {# Aktion wartet} other {# Aktionen warten}}',
		queueLabel: 'Wartende Offline-Aktionen',
		hidden:
			'+{count, plural, one {# weitere Aktion} other {# weitere Aktionen}} in der Warteschlange. {link} öffnet die vollständige Liste.',
		hiddenLink: 'Alle Aktionen prüfen',
		age: {
			unclear: 'Zeitpunkt unklar',
			future: 'Zeitpunkt in der Zukunft',
			justNow: 'gerade eben',
			minutes: 'vor {count} Min.',
			hours: 'vor {count} Std.',
			days: 'vor {count, plural, one {# Tag} other {# Tagen}}',
		},
		label: {
			checking: 'Prüft…',
			browserOffline: 'Offline-Modus',
			serverUnreachable: 'Server nicht erreichbar',
			unauthenticated: 'Anmeldung nötig',
			ready: 'Wieder online',
		},
		title: {
			checking: 'Verbindung wird geprüft…',
			offline: 'Du bist gerade offline.',
			serverUnreachable: 'Server gerade nicht erreichbar.',
			unauthenticated: 'Melde dich an, um Offline-Aktionen zu sehen.',
			online: 'Du bist wieder verbunden.',
		},
		description: {
			checking: 'Einen Moment, wir prüfen deine Verbindung und dein Konto.',
			browserOffline:
				'Deine lokal gespeicherten Aktionen bleiben sichtbar. Sobald du wieder online bist, kannst du sie synchronisieren.',
			serverUnreachable:
				'Der Server antwortet gerade nicht. Deine lokal gespeicherten Aktionen bleiben erhalten; versuche es später erneut.',
			unauthenticated: 'Offline-Aktionen und gemerkte WGs hängen an deinem Konto.',
			readyWithFlat:
				'Deine Verbindung steht. Synchronisiere wartende Aktionen oder geh zurück in deine WG.',
			readyWithoutFlat:
				'Deine Verbindung steht. Wartende Aktionen kannst du jetzt synchronisieren.',
		},
		recheckLabel: 'Offline-Status erneut prüfen',
		recheck: 'Prüfen',
		backTo: 'Zurück zu {name}',
		signIn: 'Anmelden',
		syncingLabel: 'Offline-Aktionen werden synchronisiert',
		syncNowLabel: 'Offline-Aktionen jetzt synchronisieren',
		syncNow: 'Jetzt synchronisieren',
		syncTitle: 'Synchronisation',
		otherAccount: 'Aktionen eines anderen Kontos auf diesem Gerät werden hier nicht angezeigt.',
		signInFirst: 'Melde dich an, bevor du Offline-Aktionen synchronisierst.',
		noMatchingFlat: 'Für diese Aktionen fehlt die passende Konto-WG. Sie bleiben gespeichert.',
		stays: '{modules} bleibt lokal gespeichert.',
		reloadOnline: 'Lade die Seite neu, sobald du online bist.',
		flats: {
			titleNone: 'Deine WGs',
			titleSome: 'Zurück in deine WG',
			openLater:
				'{count, plural, one {Deine WG öffnet sich erst, sobald du wieder online bist.} other {Deine WGs öffnen sich erst, sobald du wieder online bist.}}',
			looking: 'Gemerkte WGs werden gesucht…',
			codeMissing:
				'Auf diesem Gerät bist du angemeldet, aber der Code deiner WG ist hier nicht gespeichert. Gib den Code ein, um sie zu öffnen.',
			codeMissingOffline:
				'Auf diesem Gerät bist du in einer WG angemeldet, aber ihr Code ist hier nicht gespeichert. Sobald du wieder online bist, lade die Seite neu, dann kannst du deine WG wieder öffnen.',
			noneRemembered:
				'Noch keine WG auf diesem Gerät gemerkt. Gib deinen Code ein, um beizutreten.',
			noneRememberedOffline:
				'Noch keine WG auf diesem Gerät gemerkt. Sobald du wieder online bist, kannst du mit deinem Code erneut beitreten.',
			listLabel: 'Bekannte WGs',
			open: '{name} öffnen',
			checkActions: 'Aktionen prüfen',
			enterCode: 'Code eingeben',
		},
	},
	queue: {
		title: 'Offline-Warteschlange',
		retry: 'Erneut versuchen',
		syncingLabel: 'Offline-Warteschlange wird synchronisiert',
		retryLabel: 'Offline-Warteschlange erneut synchronisieren',
		storageBlockedDiscard:
			'Offline-Speicher ist blockiert. Die Aktion konnte nicht verworfen werden.',
		storageBlockedAttachment:
			'Offline-Speicher ist blockiert. Der Anhang konnte nicht entfernt werden.',
		storageBlockedDraft:
			'Offline-Speicher ist blockiert. Der Entwurf konnte nicht zum Bearbeiten geöffnet werden.',
		attachmentRemoved: 'Anhang entfernt. Die Offline-Aktion kann wieder synchronisiert werden.',
		draftExists:
			'Es existiert bereits ein anderer ungespeicherter Formular-Entwurf für dieses Modul. Öffne das Formular, speichere oder verwerfe ihn, und bearbeite dann den Eintrag in der Warteschlange.',
		compareFailed:
			'Server-Vergleich konnte nicht geladen werden. Versuche es erneut, bevor du diese Aktion sendest.',
		compareReady:
			'Server-Vergleich bereit: bearbeite den Entwurf, wenn sich Inhalt oder Aufteilung geändert haben.',
		discardTitle: 'Offline-Aktion verwerfen?',
		discardBody:
			'„{summary}“ wurde noch nicht gesendet und lässt sich nach dem Verwerfen nicht wiederherstellen.',
		keep: 'Behalten',
		discard: 'Verwerfen',
		attempts: '{count}x',
		inspect: 'WG-Eintrag prüfen',
		inspectLabel: 'WG-Eintrag prüfen: {action}',
		compare: 'Server prüfen',
		comparing: 'Prüft…',
		compareLabel: 'Server prüfen: {action}',
		edit: 'Bearbeiten',
		editLabel: 'Offline-Aktion bearbeiten: {action}',
		removeAttachment: 'Anhang entfernen',
		removeAttachmentLabel: 'Anhang entfernen: {action}',
		discardLabel: 'Offline-Aktion verwerfen: {action}',
	},
} as const;
