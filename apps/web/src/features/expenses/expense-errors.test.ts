import { describe, expect, it } from 'vitest';
import {
	expenseActionErrorMessage,
	expenseSaveErrorMessage,
	recurringAdvanceWarningMessage,
	recurringTemplateDeleteErrorMessage,
	recurringTemplateSaveErrorMessage,
} from './expense-errors';

describe('expense error messages', () => {
	it('explains expense validation errors with actionable copy', () => {
		expect(expenseSaveErrorMessage('amount_invalid')).toBe(
			'Ausgabe konnte nicht gespeichert werden: Der Betrag ist ungültig.',
		);
		expect(expenseSaveErrorMessage('description_invalid')).toBe(
			'Ausgabe konnte nicht gespeichert werden: Die Beschreibung muss 1 bis 160 Zeichen haben.',
		);
		expect(expenseSaveErrorMessage('currency_invalid')).toBe(
			'Ausgabe konnte nicht gespeichert werden: Die Währung ist ungültig.',
		);
		expect(expenseSaveErrorMessage('image_invalid')).toBe(
			'Ausgabe konnte nicht gespeichert werden: Der Anhang ist ungültig.',
		);
		expect(expenseSaveErrorMessage('expected_updated_at_invalid')).toBe(
			'Ausgabe konnte nicht gespeichert werden: Lade die Liste neu und versuche es erneut.',
		);
		expect(expenseSaveErrorMessage('occurred_at_invalid')).toBe(
			'Ausgabe konnte nicht gespeichert werden: Prüfe das Ausgabedatum.',
		);
		expect(expenseSaveErrorMessage('splits_invalid')).toBe(
			'Beträge stimmen nicht überein — Summe muss exakt dem Gesamtbetrag entsprechen.',
		);
		expect(expenseSaveErrorMessage('splits_sum_mismatch')).toBe(
			'Beträge stimmen nicht überein — Summe muss exakt dem Gesamtbetrag entsprechen.',
		);
	});

	it('explains expense persistence failures with recovery hints', () => {
		expect(expenseSaveErrorMessage('Netzwerkfehler')).toBe(
			'Ausgabe konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
		);
		expect(expenseSaveErrorMessage('Failed to fetch')).toBe(
			'Ausgabe konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
		);
		expect(expenseSaveErrorMessage('server_error')).toBe(
			'Ausgabe konnte nicht gespeichert werden: Versuche es gleich erneut.',
		);
		expect(expenseSaveErrorMessage('db_error')).toBe(
			'Ausgabe konnte nicht gespeichert werden: Versuche es gleich erneut.',
		);
		expect(expenseSaveErrorMessage('insert_failed')).toBe(
			'Ausgabe konnte nicht gespeichert werden: Prüfe die Ausgabenliste und versuche es erneut.',
		);
		expect(expenseSaveErrorMessage('split_insert_failed')).toBe(
			'Ausgabe konnte nicht vollständig gespeichert werden: Lade die Ausgaben neu und prüfe die Aufteilung.',
		);
		expect(expenseSaveErrorMessage('fetch_failed')).toBe(
			'Ausgabe wurde möglicherweise gespeichert: Lade die Ausgaben neu und prüfe den Eintrag.',
		);
	});

	it('explains expense action errors with actionable copy', () => {
		expect(expenseActionErrorMessage('Netzwerkfehler')).toBe(
			'Ausgabenaktion fehlgeschlagen: Prüfe deine Verbindung und versuche es erneut.',
		);
		expect(expenseActionErrorMessage('server_error')).toBe(
			'Ausgabenaktion fehlgeschlagen: Versuche es gleich erneut.',
		);
		expect(expenseActionErrorMessage('db_error')).toBe(
			'Ausgabenaktion fehlgeschlagen: Versuche es gleich erneut.',
		);
		expect(expenseActionErrorMessage('wg_not_found')).toBe(
			'Ausgabenaktion fehlgeschlagen: Öffne die WG über den aktuellen Link erneut.',
		);
		expect(expenseActionErrorMessage('not_split_party')).toBe(
			'Nur Zahler:in oder beteiligte Person kann diese Zahlung als beglichen markieren.',
		);
		expect(expenseActionErrorMessage('id_invalid')).toBe(
			'Diese Ausgabenaktion konnte nicht eindeutig zugeordnet werden.',
		);
		expect(expenseActionErrorMessage('settled_invalid')).toBe(
			'Diese Zahlung konnte nicht markiert werden: Lade die Ausgaben neu und versuche es erneut.',
		);
		expect(expenseActionErrorMessage('invalid_body')).toBe(
			'Ausgabenaktion konnte nicht gespeichert werden: Die Anfrage war ungültig.',
		);
	});

	it('explains debt settlement errors with specific recovery hints', () => {
		expect(expenseActionErrorMessage('member_ids_invalid')).toBe(
			'Ausgleich konnte nicht gespeichert werden: Wähle zwei gültige Mitglieder.',
		);
		expect(expenseActionErrorMessage('same_member')).toBe(
			'Ausgleich konnte nicht gespeichert werden: Zahler:in und Empfänger:in müssen verschieden sein.',
		);
		expect(expenseActionErrorMessage('member_not_in_wg')).toBe(
			'Ausgleich konnte nicht gespeichert werden: Mindestens ein Mitglied ist nicht mehr in dieser WG.',
		);
		expect(expenseActionErrorMessage('not_party_to_debt')).toBe(
			'Nur beteiligte Mitglieder können diesen Ausgleich markieren.',
		);
	});

	it('explains recurring template validation errors with actionable copy', () => {
		expect(recurringTemplateSaveErrorMessage('amount_invalid')).toBe(
			'Vorlage konnte nicht gespeichert werden: Prüfe den Betrag.',
		);
		expect(recurringTemplateSaveErrorMessage('description_invalid')).toBe(
			'Vorlage konnte nicht gespeichert werden: Gib eine Beschreibung ein.',
		);
		expect(recurringTemplateSaveErrorMessage('interval_invalid')).toBe(
			'Vorlage konnte nicht gespeichert werden: Wähle ein gültiges Intervall.',
		);
		expect(recurringTemplateSaveErrorMessage('due_date_invalid')).toBe(
			'Vorlage konnte nicht gespeichert werden: Prüfe das nächste Fälligkeitsdatum.',
		);
		expect(recurringTemplateSaveErrorMessage('splits_invalid')).toBe(
			'Beträge stimmen nicht überein — Summe muss exakt dem Gesamtbetrag entsprechen.',
		);
	});

	it('keeps recurring template access and conflict guidance specific', () => {
		expect(recurringTemplateSaveErrorMessage('member_not_in_wg')).toBe(
			'Mindestens ein Mitglied der Fixkosten-Vorlage ist nicht mehr in dieser WG.',
		);
		expect(recurringTemplateSaveErrorMessage('splits_sum_mismatch')).toBe(
			'Beträge stimmen nicht überein — Summe muss exakt dem Gesamtbetrag entsprechen.',
		);
		expect(recurringTemplateSaveErrorMessage('member_id_invalid')).toBe(
			'Vorlage konnte nicht gespeichert werden: Tritt der WG erneut bei.',
		);
		expect(recurringTemplateSaveErrorMessage('recurring_expense_not_found')).toBe(
			'Diese Fixkosten-Vorlage existiert nicht mehr. Lade die Ausgaben neu.',
		);
	});

	it('explains recurring template persistence failures with recovery hints', () => {
		expect(recurringTemplateSaveErrorMessage('Netzwerkfehler')).toBe(
			'Vorlage konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
		);
		expect(recurringTemplateSaveErrorMessage('Failed to fetch')).toBe(
			'Vorlage konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
		);
		expect(recurringTemplateSaveErrorMessage('insert_failed')).toBe(
			'Vorlage konnte nicht gespeichert werden: Prüfe die Liste und versuche es erneut.',
		);
		expect(recurringTemplateSaveErrorMessage('update_failed')).toBe(
			'Vorlage konnte nicht aktualisiert werden: Lade die Ausgaben neu und prüfe die Vorlage.',
		);
		expect(recurringTemplateSaveErrorMessage('server_error')).toBe(
			'Vorlage konnte nicht gespeichert werden: Versuche es gleich erneut.',
		);
		expect(recurringTemplateSaveErrorMessage('db_error')).toBe(
			'Vorlage konnte nicht gespeichert werden: Versuche es gleich erneut.',
		);
	});

	it('explains recurring advance conflicts after a created expense', () => {
		expect(recurringAdvanceWarningMessage(409, 'recurring_expense_already_advanced')).toBe(
			'Ausgabe wurde erstellt, aber die Vorlage war schon weitergeschoben. Prüfe kurz, ob diese Fixkosten doppelt übernommen wurden.',
		);
		expect(recurringAdvanceWarningMessage(500, 'update_failed')).toBe(
			'Ausgabe wurde erstellt, aber die Fixkosten-Vorlage konnte nicht weitergeschoben werden. Lade die Ausgaben neu und prüfe die nächste Fälligkeit.',
		);
		expect(recurringAdvanceWarningMessage(500, 'unexpected_error')).toBe(
			'Ausgabe wurde erstellt, aber die Fixkosten-Vorlage konnte nicht weitergeschoben werden. Prüfe sie später noch einmal.',
		);
	});

	it('explains recurring template delete errors with actionable copy', () => {
		expect(recurringTemplateDeleteErrorMessage('Netzwerkfehler')).toBe(
			'Vorlage konnte nicht gelöscht werden: Prüfe deine Verbindung und versuche es erneut.',
		);
		expect(recurringTemplateDeleteErrorMessage('member_id_invalid')).toBe(
			'Vorlage konnte nicht gelöscht werden: Tritt der WG erneut bei.',
		);
		expect(recurringTemplateDeleteErrorMessage('id_invalid')).toBe(
			'Vorlage konnte nicht gelöscht werden: Diese Vorlage konnte nicht eindeutig zugeordnet werden.',
		);
		expect(recurringTemplateDeleteErrorMessage('invalid_json')).toBe(
			'Vorlage konnte nicht gelöscht werden: Die Anfrage war ungültig.',
		);
		expect(recurringTemplateDeleteErrorMessage('recurring_expense_not_found')).toBe(
			'Diese Fixkosten-Vorlage existiert nicht mehr. Lade die Ausgaben neu.',
		);
		expect(recurringTemplateDeleteErrorMessage('delete_failed')).toBe(
			'Vorlage konnte nicht gelöscht werden: Lade die Ausgaben neu und prüfe, ob sie noch existiert.',
		);
		expect(recurringTemplateDeleteErrorMessage('server_error')).toBe(
			'Vorlage konnte nicht gelöscht werden: Versuche es gleich erneut.',
		);
		expect(recurringTemplateDeleteErrorMessage('db_error')).toBe(
			'Vorlage konnte nicht gelöscht werden: Versuche es gleich erneut.',
		);
	});
});
