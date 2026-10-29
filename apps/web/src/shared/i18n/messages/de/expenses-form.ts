export default {
	title: {
		editTemplate: 'Fixkosten-Vorlage bearbeiten',
		editQueuedTemplate: 'Wartende Fixkosten-Vorlage bearbeiten',
		editQueuedExpense: 'Wartende Ausgabe bearbeiten',
		edit: 'Ausgabe bearbeiten',
		add: 'Ausgabe hinzufügen',
	},
	submit: {
		saveTemplate: 'Vorlage speichern',
		saveTemplateAria: 'Fixkosten-Vorlage speichern',
		saveAsExpense: 'Als Ausgabe speichern',
		save: 'Speichern',
		saveAria: 'Ausgabe speichern',
	},
	fields: {
		description: 'Beschreibung',
		descriptionPlaceholder: 'z. B. Wocheneinkauf',
		amount: 'Betrag',
		amountPlaceholder: '0,00',
		category: 'Kategorie',
		date: 'Datum',
		paidBy: 'Bezahlt von',
		payerYou: '{name} (du)',
		payerLocked: 'Die zahlende Person kann bei einer bestehenden Ausgabe nicht geändert werden.',
	},
	actions: {
		cancelAria: 'Ausgabe abbrechen',
		cancel: 'Abbrechen',
		loadServer: 'Server-Version laden',
		keepDraft: 'Meinen Entwurf behalten',
	},
	draft: {
		replaceTitle: 'Entwurf verwerfen?',
		replaceBody:
			'Deine ungespeicherten Eingaben werden durch „{description}“ ersetzt. Bereits gespeicherte Ausgaben bleiben erhalten.',
		replaceKeep: 'Entwurf behalten',
		replaceDiscard: 'Entwurf verwerfen',
		closeTitle: 'Entwurf behalten?',
		closeBody:
			'Es wird keine Ausgabe gespeichert. Du kannst deinen Entwurf später weiterbearbeiten oder ausdrücklich verwerfen.',
		closeContinue: 'Weiterbearbeiten',
		closeDiscard: 'Entwurf verwerfen',
		closeKeep: 'Entwurf behalten',
		existingKept: 'Dein vorhandener Entwurf bleibt erhalten.',
		replaceWith: 'Entwurf verwerfen und „{description}“ übernehmen',
		notSynced: 'Noch nicht synchronisiert. Die Änderung wird gesendet, sobald du online bist.',
	},
	split: {
		legend: 'Beteiligte & Aufteilung',
		toggleAria: 'Aufteilung',
		equal: 'Gleichmäßig',
		equalAria: 'Aufteilung: Gleichmäßig',
		manual: 'Manuell',
		manualAria: 'Aufteilung: Manuell',
		lockedHint: 'Ausgezogene Anteile bleiben unverändert; nur aktive Personen übernehmen den Rest.',
		movedOut: '(ausgezogen)',
		shareAria: 'Anteil {name} in {currency, select, EUR {Euro} other {{currency}}}',
		shareAriaMovedOut:
			'Anteil {name} in {currency, select, EUR {Euro} other {{currency}}}, ausgezogen. Anteil bleibt unverändert.',
		zeroHint: 'Leer lassen oder {zero} für keinen Anteil.',
		settledShareLocked:
			'Der Anteil von {name} ({previous}) ist schon als bezahlt vermerkt und kann sich nicht ändern{removed, select, yes { oder entfallen.} other { (neu wären {next}).}} Öffne die Zahlung erst wieder, dann kannst du ihn anpassen.',
		participantsAria: 'Beteiligte Personen',
		reviewAria: 'Anteile vor dem Speichern',
		noShare: 'Kein Anteil',
		ownShare: 'Eigener Anteil · bereits bezahlt',
		sum: 'Summe:',
		balanced: 'Ausgeglichen',
		tooMuch: 'Zu viel',
		open: 'Offen',
		distribute: 'Rest aufteilen',
	},
	extras: {
		addReceipt: 'Beleg hinzufügen',
		attached: 'Angehängt',
		receipt: 'Beleg',
		template: 'Fixkosten-Vorlage',
		repeat: 'Wiederholung',
		templateHint: 'Die Vorlage merkt Betrag, zahlende Person und diese Aufteilung.',
		saveAsTemplate: 'Als Vorlage merken',
		templateSaved: 'Als Vorlage gespeichert. Sie steht unter Fixkosten.',
	},
	intervals: {
		optionMonths: '{count, plural, one {# Monat} other {# Monate}}',
		optionQuarter: 'Quartal',
		optionYear: 'Jahr',
		monthly: 'monatlich',
		quarterly: 'quartalsweise',
		halfYearly: 'halbjährlich',
		yearly: 'jährlich',
		everyMonths: 'alle {count} Monate',
	},
	validation: {
		description: 'Gib eine kurze Beschreibung ein.',
		date: 'Wähle ein Datum, das nicht in der Zukunft liegt.',
		amountDecimals: 'Maximal zwei Nachkommastellen.',
		amountTooLarge: 'Der Betrag darf höchstens 1.000.000 € betragen.',
		amountInvalid: 'Gib einen Betrag über 0 € ein, z. B. 12,50.',
	},
	notices: {
		receiptUploadFailed:
			'Beleg konnte nicht hochgeladen werden. Versuche es erneut oder entferne ihn.',
		draftBroken:
			'Die Zuordnung dieses Entwurfs ist beschädigt. Öffne die ursprüngliche Ausgabe erneut oder verwirf den Entwurf.',
		draftBrokenKept:
			'Die Zuordnung dieses Entwurfs ist beschädigt. Deine Eingaben bleiben erhalten; öffne die ursprüngliche Ausgabe erneut oder verwirf den Entwurf.',
		reloadFailed: 'Die Liste konnte nicht neu geladen werden. Versuche es gleich noch einmal.',
		conflict:
			'Diese Ausgabe wurde inzwischen geändert. Lade die Liste neu und entscheide dann, welche Version stimmt.',
		templateUnavailable:
			'Fixkosten-Vorlage ist nicht verfügbar. Aktualisiere die Seite und versuche es erneut.',
		saved: 'Ausgabe gespeichert. Hier wird kein Geld überwiesen.',
		updated: 'Ausgabe aktualisiert. Hier wird kein Geld überwiesen.',
		keyUnavailableExpense: 'Ausgabe konnte nicht sicher gesendet werden. Versuche es erneut.',
		keyUnavailableRecurring:
			'Fixkosten-Ausgabe konnte nicht sicher gesendet werden. Versuche es erneut.',
		keyUnavailableTemplate:
			'Fixkosten-Vorlage konnte nicht sicher gespeichert werden. Versuche es erneut.',
		recurringQueued:
			'Fixkosten-Ausgabe offline vorgemerkt. Die Vorlage bleibt bis zur Synchronisierung unverändert.',
		recurringQueueBlocked:
			'Offline-Speicher ist blockiert. Die Fixkosten-Ausgabe konnte nicht vorgemerkt werden und wurde zurückgesetzt.',
		recurringBooked: 'Fixkosten-Ausgabe wurde erstellt.',
		templateAlreadyQueued:
			'Fixkosten-Vorlage ist bereits offline vorgemerkt. Synchronisiere oder löse die bestehende Aktion zuerst.',
		templateSavedOffline: 'Fixkosten-Vorlage offline gespeichert.',
		templateGoneRemoved:
			'Diese Fixkosten-Vorlage existiert nicht mehr und wurde aus der Liste entfernt.',
		templateUpdated: 'Fixkosten-Vorlage aktualisiert.',
		templateSaved: 'Als Vorlage gespeichert ({interval}).',
		offlineSaved: 'Offline gespeichert. Wird synchronisiert, sobald du wieder online bist.',
		queueBlockedDraft:
			'Offline-Speicher ist blockiert. Lass den Entwurf offen und versuche es später erneut.',
		offlineDraftCleanupFailed:
			'Offline gespeichert, aber der alte Entwurf konnte nicht entfernt werden. Prüfe die Offline-Warteschlange.',
		draftCleanupFailed: 'Gespeichert, aber der alte Offline-Entwurf konnte nicht entfernt werden.',
		queueEditAlreadySent: 'Der Eintrag wurde inzwischen schon gesendet – bitte prüfe die Liste.',
	},
	errors: {
		withPeriod: '{subject}.',
		invalidRequest: 'Die Anfrage war ungültig.',
		splitSumMismatch:
			'Beträge stimmen nicht überein — Summe muss exakt dem Gesamtbetrag entsprechen.',
		paidByMustIncludeCaller:
			'Wenn du für jemand anderen buchst, muss dein eigener Anteil größer als 0 sein.',
		notTemplateOwner:
			'Nur wer die Fixkosten angelegt hat oder Admin der WG ist, kann sie ändern oder löschen.',
		recurringNotFound: 'Diese Fixkosten-Vorlage existiert nicht mehr. Lade die Ausgaben neu.',
		editedExpenseDeleted:
			'Die ursprüngliche Ausgabe wurde gelöscht. Deine ungespeicherten Änderungen bleiben im Entwurf; du kannst sie kopieren oder den Entwurf verwerfen.',
		save: {
			subject: 'Ausgabe konnte nicht gespeichert werden',
			amountInvalid: 'Der Betrag ist ungültig.',
			descriptionInvalid: 'Die Beschreibung muss 1 bis {max} Zeichen haben.',
			currencyInvalid: 'Die Währung ist ungültig.',
			imageInvalid: 'Der Anhang ist ungültig.',
			imageRemoved: 'Der Anhang wurde entfernt. Lade ihn erneut hoch.',
			expectedUpdatedAtInvalid: 'Lade die Liste neu und versuche es erneut.',
			occurredAtInvalid: 'Prüfe das Ausgabedatum.',
			splitsDuplicateDebtor:
				'Aufteilung enthält eine Person doppelt — jede Person darf nur einmal vorkommen.',
			notPayer: 'Nur wer bezahlt hat, kann diese Ausgabe bearbeiten.',
			hasSettledShares:
				'Ein Anteil ist schon beglichen. Betrag und Aufteilung bleiben deshalb, wie sie sind; Beschreibung, Datum und Kategorie lassen sich ändern.',
			aboPaused: 'Diese Fixkosten sind pausiert. Setze sie in den Fixkosten fort.',
			recurringAdvanced:
				'Diese Fixkosten wurden für diese Fälligkeit schon übernommen. Lade die Ausgaben neu und prüfe die Liste.',
			memberNotInWg: 'Mindestens ein Mitglied ist nicht mehr in dieser WG.',
			insertFailed: 'Prüfe die Ausgabenliste und versuche es erneut.',
			splitInsertFailed:
				'Ausgabe konnte nicht vollständig gespeichert werden: Lade die Ausgaben neu und prüfe die Aufteilung.',
			fetchFailed:
				'Ausgabe wurde möglicherweise gespeichert: Lade die Ausgaben neu und prüfe den Eintrag.',
		},
		template: {
			subject: 'Vorlage konnte nicht gespeichert werden',
			memberNotInWg: 'Mindestens ein Mitglied der Fixkosten-Vorlage ist nicht mehr in dieser WG.',
			insertFailed: 'Prüfe die Liste und versuche es erneut.',
			updateFailed:
				'Vorlage konnte nicht aktualisiert werden: Lade die Ausgaben neu und prüfe die Vorlage.',
			amountInvalid: 'Prüfe den Betrag.',
			descriptionInvalid: 'Gib eine Beschreibung ein.',
			intervalInvalid: 'Wähle ein gültiges Intervall.',
			dueDateInvalid: 'Prüfe das nächste Fälligkeitsdatum.',
			changed:
				'Die Vorlage wurde gerade gebucht oder geändert. Lade die Ausgaben neu und bearbeite sie erneut.',
		},
		templateDelete: {
			subject: 'Vorlage konnte nicht gelöscht werden',
			idInvalid: 'Diese Vorlage konnte nicht eindeutig zugeordnet werden.',
			deleteFailed: 'Lade die Ausgaben neu und prüfe, ob sie noch existiert.',
		},
		advance: {
			alreadyAdvanced:
				'Ausgabe wurde erstellt, aber die Vorlage war schon weitergeschoben. Prüfe kurz, ob diese Fixkosten doppelt übernommen wurden.',
			updateFailed:
				'Ausgabe wurde erstellt, aber die Fixkosten-Vorlage konnte nicht weitergeschoben werden. Lade die Ausgaben neu und prüfe die nächste Fälligkeit.',
			generic:
				'Ausgabe wurde erstellt, aber die Fixkosten-Vorlage konnte nicht weitergeschoben werden. Prüfe sie später noch einmal.',
		},
		split: {
			invalidShare:
				'Mindestens ein Anteil ist ungültig. Gib einen gültigen Betrag ein oder lasse das Feld leer.',
			empty: 'Aufteilung leer — gib mindestens einen Betrag ein.',
			noMembers: 'Wähle mindestens eine beteiligte Person aus.',
		},
	},
} as const;
