import { describe, expect, it } from 'vitest';
import {
	createQueuedAbsence,
	createQueuedAnnouncement,
	createQueuedChore,
	createQueuedChoreCompletion,
	createQueuedExpense,
	createQueuedRecurring,
	createQueuedShoppingItem,
	createQueuedShoppingUpdate,
	explainOfflineActionFailure,
	getOfflineActionRequest,
	getOfflineActionRisk,
	getOfflineActionSummary,
	getOfflineRetryDelayMs,
	isOfflineIdempotencyKey,
	serializeOfflineAction,
	shouldRetryOfflineAction,
} from './offline-queue';

describe('offline queue helpers', () => {
	it('stores the stable WG id without storing a member token', () => {
		const action = createQueuedShoppingItem({
			wgId: 'wg-1',
			shareCode: 'ABC12345',
			memberId: 'member-1',
			name: 'Milch',
			quantity: null,
			now: 1,
		});

		expect(action.wgId).toBe('wg-1');
		expect(action).not.toHaveProperty('memberToken');
		expect(isOfflineIdempotencyKey(action.idempotencyKey)).toBe(true);
	});

	it('creates a stable queued shopping action that can be retried later', () => {
		const action = createQueuedShoppingItem({
			shareCode: 'ABC12345',
			memberId: 'member-1',
			name: 'Milch',
			quantity: '2x',
			now: 1_768_000_000_000,
		});

		expect(action).toMatchObject({
			id: 'shopping:ABC12345:1768000000000:milch',
			type: 'shopping.create',
			shareCode: 'ABC12345',
			memberId: 'member-1',
			createdAt: '2026-01-09T23:06:40.000Z',
			payload: { name: 'Milch', quantity: '2x' },
		});
		expect(isOfflineIdempotencyKey(action.idempotencyKey)).toBe(true);
		expect(JSON.parse(serializeOfflineAction(action))).toEqual(action);
	});

	it('creates a queued shopping status update for offline toggles', () => {
		const action = createQueuedShoppingUpdate({
			shareCode: 'ABC12345',
			memberId: 'member-1',
			itemId: 'item-1',
			name: 'Milch',
			bought: true,
			now: 1_768_000_000_000,
		});

		expect(action).toMatchObject({
			id: 'shopping-update:ABC12345:1768000000000:item-1',
			type: 'shopping.update',
			shareCode: 'ABC12345',
			memberId: 'member-1',
			createdAt: '2026-01-09T23:06:40.000Z',
			payload: { itemId: 'item-1', name: 'Milch', bought: true },
		});
		expect(isOfflineIdempotencyKey(action.idempotencyKey)).toBe(true);
	});

	it('creates queued actions for announcements, chores, and expenses', () => {
		expect([
			createQueuedAnnouncement({
				shareCode: 'ABC12345',
				memberId: 'm1',
				content: 'Bitte leise',
				kind: 'info',
				imageUrl: 'manawg-pending-image:img1',
				now: 1,
			}).type,
			createQueuedAbsence({
				shareCode: 'ABC12345',
				memberId: 'm1',
				absenceMemberId: 'm2',
				startDate: '2026-05-20T00:00:00.000Z',
				endDate: '2026-05-22T23:59:59.000Z',
				reason: 'Urlaub',
				now: 2,
			}).type,
			createQueuedChore({
				shareCode: 'ABC12345',
				memberId: 'm1',
				title: 'Bad putzen',
				intervalDays: 7,
				assignedMemberId: null,
				now: 3,
			}).type,
			createQueuedChoreCompletion({
				shareCode: 'ABC12345',
				memberId: 'm1',
				choreId: 'c1',
				now: 4,
			}).type,
			createQueuedExpense({
				shareCode: 'ABC12345',
				memberId: 'm1',
				description: 'Miete',
				amountCents: 50000,
				paidByMemberId: 'm1',
				splits: [{ debtorMemberId: 'm1', amountCents: 50000 }],
				imageUrl: 'https://cdn.example/receipt.jpg',
				now: 5,
			}).type,
			createQueuedRecurring({
				shareCode: 'ABC12345',
				memberId: 'm1',
				description: 'Internet',
				amountCents: 3290,
				paidByMemberId: 'm1',
				intervalMonths: 1,
				nextDueAt: '2026-05-20T00:00:00.000Z',
				splits: [{ debtorMemberId: 'm1', amountCents: 3290 }],
				now: 6,
			}).type,
		]).toEqual([
			'announcement.create',
			'absence.create',
			'chore.create',
			'chore.complete',
			'expense.create',
			'recurring.create',
		]);
	});

	it('maps queued actions to retryable API requests', () => {
		const action = createQueuedAbsence({
			shareCode: 'ABC12345',
			memberId: 'm1',
			absenceMemberId: 'm2',
			startDate: '2026-05-20T00:00:00.000Z',
			endDate: '2026-05-22T23:59:59.000Z',
			reason: null,
			now: 2,
		});

		expect(getOfflineActionRequest(action)).toEqual({
			path: '/api/wg/ABC12345/absences',
			method: 'POST',
			body: {
				memberId: 'm2',
				startDate: '2026-05-20T00:00:00.000Z',
				endDate: '2026-05-22T23:59:59.000Z',
			},
		});
		expect(
			getOfflineActionRequest({
				...createQueuedShoppingItem({
					shareCode: 'ABC/123?x=1',
					memberId: 'm1',
					name: 'Milch',
					quantity: null,
					now: 1,
				}),
				payload: { name: 'Milch', quantity: null, bought: true },
			}),
		).toEqual({
			path: '/api/wg/ABC%2F123%3Fx%3D1/shopping',
			method: 'POST',
			body: { name: 'Milch', quantity: null, bought: true, addedByMemberId: 'm1' },
		});
		expect(
			getOfflineActionRequest(
				createQueuedRecurring({
					shareCode: 'ABC12345',
					memberId: 'm1',
					description: 'Internet',
					amountCents: 3290,
					paidByMemberId: 'm1',
					intervalMonths: 1,
					nextDueAt: '2026-05-20T00:00:00.000Z',
					splits: [{ debtorMemberId: 'm1', amountCents: 3290 }],
					now: 6,
				}),
			),
		).toEqual({
			path: '/api/wg/ABC12345/recurring-expenses',
			method: 'POST',
			body: {
				description: 'Internet',
				amountCents: 3290,
				paidByMemberId: 'm1',
				intervalMonths: 1,
				nextDueAt: '2026-05-20T00:00:00.000Z',
				splits: [{ debtorMemberId: 'm1', amountCents: 3290 }],
			},
		});
		expect(
			getOfflineActionRequest(
				createQueuedShoppingUpdate({
					shareCode: 'ABC12345',
					memberId: 'm1',
					itemId: 'item 1/frag?x=1',
					name: 'Milch',
					bought: false,
					now: 7,
				}),
			),
		).toEqual({
			path: '/api/wg/ABC12345/shopping/item%201%2Ffrag%3Fx%3D1',
			method: 'PATCH',
			body: { bought: false },
		});
		expect(
			getOfflineActionRequest(
				createQueuedExpense({
					shareCode: 'ABC12345',
					memberId: 'm1',
					description: 'Internet',
					amountCents: 3290,
					paidByMemberId: 'm1',
					splits: [{ debtorMemberId: 'm1', amountCents: 3290 }],
					recurringExpenseId: 'recurring-1',
					expectedRecurringNextDueAt: '2026-05-20T00:00:00.000Z',
					now: 8,
				}),
			),
		).toEqual({
			path: '/api/wg/ABC12345/expenses',
			method: 'POST',
			body: {
				description: 'Internet',
				amountCents: 3290,
				paidByMemberId: 'm1',
				splits: [{ debtorMemberId: 'm1', amountCents: 3290 }],
			},
		});
		expect(
			getOfflineActionRequest({
				id: 'recurring-advance:ABC12345:recurring-1',
				type: 'recurring.advance',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T10:00:00.000Z',
				payload: {
					recurringExpenseId: 'recurring-1',
					expectedRecurringNextDueAt: '2026-05-20T00:00:00.000Z',
				},
			}),
		).toEqual({
			path: '/api/wg/ABC12345/recurring-expenses',
			method: 'PATCH',
			body: {
				id: 'recurring-1',
				expectedNextDueAt: '2026-05-20T00:00:00.000Z',
			},
		});
	});

	it('describes queued actions for the settings UI', () => {
		expect(
			getOfflineActionSummary(
				createQueuedShoppingUpdate({
					shareCode: 'ABC12345',
					memberId: 'm1',
					itemId: 'item-1',
					name: 'Milch',
					bought: true,
					now: 7,
				}),
			),
		).toEqual({
			title: 'Einkauf',
			detail: 'Milch abhaken',
		});
		expect(
			getOfflineActionSummary(
				createQueuedAnnouncement({
					shareCode: 'ABC12345',
					memberId: 'm1',
					content: 'Bitte leise',
					kind: 'info',
					now: 1,
				}),
			),
		).toEqual({
			title: 'Pinnwand-Beitrag',
			detail: 'Bitte leise',
		});
		expect(
			getOfflineActionSummary(
				createQueuedChore({
					shareCode: 'ABC12345',
					memberId: 'm1',
					title: 'Bad putzen',
					intervalDays: 7,
					assignedMemberId: null,
					now: 2,
				}),
			),
		).toEqual({
			title: 'Putzplan-Aufgabe',
			detail: 'Bad putzen',
		});
		expect(
			getOfflineActionSummary(
				createQueuedAbsence({
					shareCode: 'ABC12345',
					memberId: 'm1',
					absenceMemberId: 'm2',
					startDate: '2026-05-20T00:00:00.000Z',
					endDate: '2026-05-22T23:59:59.000Z',
					reason: null,
					now: 3,
				}),
			),
		).toEqual({
			title: 'Abwesenheit',
			detail: 'Rotation überspringt diese Person',
		});
		expect(
			getOfflineActionSummary(
				createQueuedRecurring({
					shareCode: 'ABC12345',
					memberId: 'm1',
					description: 'Internet',
					amountCents: 3290,
					paidByMemberId: 'm1',
					intervalMonths: 1,
					nextDueAt: '2026-05-20T00:00:00.000Z',
					splits: [{ debtorMemberId: 'm1', amountCents: 3290 }],
					now: 6,
				}),
			),
		).toEqual({
			title: 'Fixkosten-Vorlage',
			detail: 'Internet',
		});
	});

	it('explains retry failures with a recovery hint', () => {
		expect(explainOfflineActionFailure(401, 'not_a_member')).toEqual({
			title: 'Mitglied nicht mehr gültig',
			detail:
				'Öffne die WG erneut oder tritt mit einem aktuellen Einladungslink bei, bevor du diese Aktion sendest.',
		});
		expect(explainOfflineActionFailure(400, 'member_not_in_wg')).toEqual({
			title: 'Mitglied in Aktion prüfen',
			detail:
				'Ein beteiligtes Mitglied ist nicht mehr in der WG. Bearbeite Zuweisung oder Aufteilung vor dem erneuten Senden.',
		});
		expect(explainOfflineActionFailure(404, 'wg_not_found')).toEqual({
			title: 'WG-Link nicht mehr gültig',
			detail:
				'Prüfe den Einladungslink oder lass dir einen neuen Share-Code geben, bevor du diese Aktion sendest.',
		});
		expect(explainOfflineActionFailure(404, 'recurring_expense_not_found')).toEqual({
			title: 'Fixkosten-Vorlage fehlt',
			detail:
				'Die Vorlage existiert nicht mehr. Entferne diese Offline-Aktion oder erstelle die Fixkosten neu.',
		});
		expect(explainOfflineActionFailure(404, 'item_not_found')).toEqual({
			title: 'Einkauf fehlt',
			detail:
				'Der Artikel existiert nicht mehr. Entferne diese Offline-Aktion oder lege den Einkauf neu an.',
		});
		expect(explainOfflineActionFailure(404, 'chore_not_found')).toEqual({
			title: 'Putzplan-Aufgabe fehlt',
			detail:
				'Die Aufgabe existiert nicht mehr. Entferne diese Offline-Aktion oder lege die Aufgabe neu an.',
		});
		expect(explainOfflineActionFailure(404, 'expense_not_found')).toEqual({
			title: 'Ausgabe fehlt',
			detail:
				'Die Ausgabe existiert nicht mehr. Entferne diese Offline-Aktion oder erfasse die Ausgabe neu.',
		});
		expect(explainOfflineActionFailure(404, 'split_not_found')).toEqual({
			title: 'Ausgabenanteil fehlt',
			detail:
				'Der Anteil existiert nicht mehr. Entferne diese Offline-Aktion oder prüfe die Ausgabe erneut.',
		});
		expect(explainOfflineActionFailure(413)).toEqual({
			title: 'Bild oder Eintrag ist zu groß',
			detail: 'Entferne den Anhang oder wähle ein kleineres Bild und versuche es erneut.',
		});
		expect(explainOfflineActionFailure(0)).toEqual({
			title: 'Noch keine Verbindung',
			detail: 'Die Aktion bleibt gespeichert und wird erneut versucht, sobald das Netz zurück ist.',
		});
		expect(explainOfflineActionFailure(500)).toEqual({
			title: 'Server gerade nicht bereit',
			detail: 'Die Aktion bleibt in der Warteschlange. Versuche es gleich erneut.',
		});
		expect(explainOfflineActionFailure(503, 'db_error')).toEqual({
			title: 'Server gerade nicht bereit',
			detail: 'Die Aktion bleibt in der Warteschlange. Versuche es gleich erneut.',
		});
	});

	it('explains partial server-write failures with refresh guidance', () => {
		expect(explainOfflineActionFailure(500, 'completion_insert_failed')).toEqual({
			title: 'Putzplan unvollständig gespeichert',
			detail:
				'Die Aufgabe wurde möglicherweise rotiert, aber nicht im Verlauf protokolliert. Lade den Putzplan neu und prüfe den Verlauf vor dem erneuten Senden.',
		});
		expect(explainOfflineActionFailure(500, 'split_insert_failed')).toEqual({
			title: 'Ausgabe unvollständig gespeichert',
			detail:
				'Die Ausgabe oder ihre Aufteilung wurde nicht vollständig gespeichert. Lade die Ausgaben neu und prüfe den Eintrag vor dem erneuten Senden.',
		});
		expect(explainOfflineActionFailure(500, 'insert_failed')).toEqual({
			title: 'Speichern nicht bestätigt',
			detail:
				'Der Server hat den Eintrag nicht bestätigt. Lade die WG neu und prüfe, ob die Aktion bereits angekommen ist.',
		});
		expect(explainOfflineActionFailure(500, 'delete_failed')).toEqual({
			title: 'Entfernen nicht bestätigt',
			detail:
				'Der Server hat das Entfernen nicht bestätigt. Lade die WG neu und prüfe den Eintrag vor dem erneuten Senden.',
		});
		expect(explainOfflineActionFailure(500, 'update_failed')).toEqual({
			title: 'Aktualisierung nicht bestätigt',
			detail:
				'Der Server hat die Änderung nicht bestätigt. Lade die WG neu und prüfe den aktuellen Stand vor dem erneuten Senden.',
		});
	});

	it('explains amount and split validation failures with an edit hint', () => {
		expect(explainOfflineActionFailure(400, 'amount_invalid')).toEqual({
			title: 'Betrag prüfen',
			detail: 'Bearbeite Betrag und Aufteilung, bevor du diese Aktion erneut sendest.',
		});
		expect(explainOfflineActionFailure(400, 'currency_invalid')).toEqual({
			title: 'Währung prüfen',
			detail: 'Erfasse die Ausgabe neu mit der aktuellen Euro-Währung.',
		});
		expect(explainOfflineActionFailure(400, 'splits_sum_mismatch')).toEqual({
			title: 'Aufteilung prüfen',
			detail: 'Bearbeite Betrag und Aufteilung, bevor du diese Aktion erneut sendest.',
		});
		expect(explainOfflineActionFailure(400, 'splits_invalid')).toEqual({
			title: 'Aufteilung prüfen',
			detail: 'Bearbeite Betrag und Aufteilung, bevor du diese Aktion erneut sendest.',
		});
	});

	it('explains text and date validation failures with an edit hint', () => {
		expect(explainOfflineActionFailure(400, 'name_invalid')).toEqual({
			title: 'Eintrag prüfen',
			detail: 'Bearbeite die markierten Felder, bevor du diese Aktion erneut sendest.',
		});
		expect(explainOfflineActionFailure(400, 'content_invalid')).toEqual({
			title: 'Eintrag prüfen',
			detail: 'Bearbeite die markierten Felder, bevor du diese Aktion erneut sendest.',
		});
		expect(explainOfflineActionFailure(400, 'kind_invalid')).toEqual({
			title: 'Kategorie prüfen',
			detail: 'Wähle eine aktuelle Pinnwand-Kategorie, bevor du den Beitrag erneut sendest.',
		});
		expect(explainOfflineActionFailure(400, 'source_path_invalid')).toEqual({
			title: 'Quelllink prüfen',
			detail: 'Entferne den alten Quelllink oder erfasse den Pinnwand-Beitrag neu.',
		});
		expect(explainOfflineActionFailure(400, 'quantity_invalid')).toEqual({
			title: 'Menge prüfen',
			detail: 'Kürze oder entferne die Mengenangabe, bevor du diesen Einkauf erneut sendest.',
		});
		expect(explainOfflineActionFailure(400, 'due_date_invalid')).toEqual({
			title: 'Datum prüfen',
			detail: 'Bearbeite Datum oder Zeitraum, bevor du diese Aktion erneut sendest.',
		});
		expect(explainOfflineActionFailure(400, 'date_range_invalid')).toEqual({
			title: 'Datum prüfen',
			detail: 'Bearbeite Datum oder Zeitraum, bevor du diese Aktion erneut sendest.',
		});
		expect(explainOfflineActionFailure(400, 'invalid_body')).toEqual({
			title: 'Offline-Aktion prüfen',
			detail:
				'Die gespeicherte Aktion passt nicht mehr zur aktuellen App. Entferne sie und erfasse den Eintrag neu.',
		});
		expect(explainOfflineActionFailure(400, 'id_invalid')).toEqual({
			title: 'Ziel prüfen',
			detail:
				'Die gespeicherte Ziel-ID ist ungültig. Entferne diese Offline-Aktion und öffne den Eintrag neu.',
		});
	});

	it('explains attachment and absence reason validation failures with an edit hint', () => {
		expect(explainOfflineActionFailure(400, 'image_invalid')).toEqual({
			title: 'Anhang prüfen',
			detail: 'Entferne den Anhang oder wähle ein gültiges Bild, bevor du erneut sendest.',
		});
		expect(explainOfflineActionFailure(400, 'reason_invalid')).toEqual({
			title: 'Grund prüfen',
			detail: 'Kürze oder entferne den Abwesenheitsgrund, bevor du diese Aktion erneut sendest.',
		});
	});

	it('explains shopping status validation failures with an edit hint', () => {
		expect(explainOfflineActionFailure(400, 'bought_invalid')).toEqual({
			title: 'Status prüfen',
			detail: 'Prüfe den Einkaufsstatus, bevor du diese Aktion erneut sendest.',
		});
	});

	it('explains interval validation failures with a neutral edit hint', () => {
		expect(explainOfflineActionFailure(400, 'interval_invalid')).toEqual({
			title: 'Intervall prüfen',
			detail: 'Bearbeite das Intervall, bevor du diese Aktion erneut sendest.',
		});
	});

	it('flags older queued actions with a conflict hint', () => {
		const action = createQueuedChoreCompletion({
			shareCode: 'ABC12345',
			memberId: 'm1',
			choreId: 'c1',
			now: 1,
		});

		expect(getOfflineActionRisk(action, 24 * 60 * 60 * 1000)?.title).toBe('Möglicher Konflikt');
	});

	it('flags older queued absences with a specific review hint', () => {
		const action = createQueuedAbsence({
			shareCode: 'ABC12345',
			memberId: 'm1',
			absenceMemberId: 'm2',
			startDate: '2026-05-20T00:00:00.000Z',
			endDate: '2026-05-22T23:59:59.000Z',
			reason: 'Urlaub',
			now: 1,
		});

		expect(getOfflineActionRisk(action, 24 * 60 * 60 * 1000)).toEqual({
			title: 'Abwesenheit prüfen',
			detail: 'Prüfe kurz, ob Zeitraum oder Putzplan inzwischen geändert wurden.',
		});
	});

	it('flags older queued chore creations with a specific review hint', () => {
		const action = createQueuedChore({
			shareCode: 'ABC12345',
			memberId: 'm1',
			title: 'Küche putzen',
			intervalDays: 7,
			assignedMemberId: null,
			now: 1,
		});

		expect(getOfflineActionRisk(action, 24 * 60 * 60 * 1000)).toEqual({
			title: 'Putzplan prüfen',
			detail: 'Prüfe kurz, ob Aufgabe, Intervall oder Zuweisung inzwischen geändert wurden.',
		});
	});

	it('flags older queued announcements with a specific review hint', () => {
		const action = createQueuedAnnouncement({
			shareCode: 'ABC12345',
			memberId: 'm1',
			content: 'Fenster bleibt heute offen',
			kind: 'info',
			now: 1,
		});

		expect(getOfflineActionRisk(action, 24 * 60 * 60 * 1000)).toEqual({
			title: 'Pinnwand prüfen',
			detail: 'Prüfe kurz, ob Inhalt, Kategorie oder Status inzwischen überholt sind.',
		});
	});

	it('flags queued actions with invalid creation dates for review', () => {
		const action = {
			...createQueuedShoppingItem({
				shareCode: 'ABC12345',
				memberId: 'member-1',
				name: 'Milch',
				quantity: null,
				now: 1_000,
			}),
			createdAt: 'broken',
		};

		expect(getOfflineActionRisk(action)).toEqual({
			title: 'Zeitpunkt prüfen',
			detail: 'Der gespeicherte Zeitpunkt ist unklar. Prüfe den Eintrag vor dem erneuten Senden.',
		});
	});

	it('flags queued actions from the future for review', () => {
		const action = createQueuedShoppingItem({
			shareCode: 'ABC12345',
			memberId: 'member-1',
			name: 'Milch',
			quantity: null,
			now: new Date('2026-05-20T12:00:00.000Z').getTime(),
		});

		expect(getOfflineActionRisk(action, new Date('2026-05-20T11:55:00.000Z').getTime())).toEqual({
			title: 'Zeitpunkt prüfen',
			detail: 'Der gespeicherte Zeitpunkt liegt in der Zukunft. Prüfe den Eintrag vor dem Senden.',
		});
	});

	it('backs off automatic retries for failed queued actions', () => {
		const action = {
			...createQueuedShoppingItem({
				shareCode: 'ABC12345',
				memberId: 'member-1',
				name: 'Milch',
				quantity: null,
				now: 1_000,
			}),
			attempts: 2,
			lastAttemptAt: '2026-05-18T10:00:00.000Z',
		};

		expect(getOfflineRetryDelayMs(action)).toBe(60_000);
		expect(shouldRetryOfflineAction(action, new Date('2026-05-18T10:00:30.000Z').getTime())).toBe(
			false,
		);
		expect(shouldRetryOfflineAction(action, new Date('2026-05-18T10:01:01.000Z').getTime())).toBe(
			true,
		);
	});

	it('retries immediately when the last attempt timestamp is invalid', () => {
		const action = {
			...createQueuedShoppingItem({
				shareCode: 'ABC12345',
				memberId: 'member-1',
				name: 'Milch',
				quantity: null,
				now: 1_000,
			}),
			attempts: 3,
			lastAttemptAt: 'broken',
		};

		expect(shouldRetryOfflineAction(action)).toBe(true);
	});

	it('waits when the last attempt timestamp is in the future', () => {
		const action = {
			...createQueuedShoppingItem({
				shareCode: 'ABC12345',
				memberId: 'member-1',
				name: 'Milch',
				quantity: null,
				now: 1_000,
			}),
			attempts: 3,
			lastAttemptAt: '2026-05-18T12:00:00.000Z',
		};

		expect(shouldRetryOfflineAction(action, new Date('2026-05-18T11:00:00.000Z').getTime())).toBe(
			false,
		);
	});
});
