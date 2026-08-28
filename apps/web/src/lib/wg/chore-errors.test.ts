import { describe, expect, it } from 'vitest';
import { absenceSaveErrorMessage, choreCreateErrorMessage } from './chore-errors';

describe('chore error messages', () => {
	it('explains absence validation errors with actionable copy', () => {
		expect(absenceSaveErrorMessage('Netzwerkfehler')).toBe(
			'Abwesenheit konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
		);
		expect(absenceSaveErrorMessage('Failed to fetch')).toBe(
			'Abwesenheit konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
		);
		expect(absenceSaveErrorMessage('server_error')).toBe(
			'Abwesenheit konnte nicht gespeichert werden: Versuche es gleich erneut.',
		);
		expect(absenceSaveErrorMessage('db_error')).toBe(
			'Abwesenheit konnte nicht gespeichert werden: Versuche es gleich erneut.',
		);
		expect(absenceSaveErrorMessage('date_range_invalid')).toBe(
			'Abwesenheit konnte nicht gespeichert werden: Das Enddatum liegt vor dem Startdatum.',
		);
		expect(absenceSaveErrorMessage('reason_invalid')).toBe(
			'Abwesenheit konnte nicht gespeichert werden: Der Grund darf höchstens 120 Zeichen haben.',
		);
		expect(absenceSaveErrorMessage('member_not_in_wg')).toBe(
			'Abwesenheit konnte nicht gespeichert werden: Dieses Mitglied ist nicht mehr in dieser WG.',
		);
		expect(absenceSaveErrorMessage('insert_failed')).toBe(
			'Abwesenheit konnte nicht gespeichert werden: Prüfe den Putzplan und versuche es erneut.',
		);
	});

	it('explains chore validation errors with actionable copy', () => {
		expect(choreCreateErrorMessage('Netzwerkfehler')).toBe(
			'Putzaufgabe konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
		);
		expect(choreCreateErrorMessage('Failed to fetch')).toBe(
			'Putzaufgabe konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
		);
		expect(choreCreateErrorMessage('server_error')).toBe(
			'Putzaufgabe konnte nicht gespeichert werden: Versuche es gleich erneut.',
		);
		expect(choreCreateErrorMessage('db_error')).toBe(
			'Putzaufgabe konnte nicht gespeichert werden: Versuche es gleich erneut.',
		);
		expect(choreCreateErrorMessage('interval_invalid')).toBe(
			'Putzaufgabe konnte nicht gespeichert werden: Das Intervall muss zwischen 1 und 365 Tagen liegen.',
		);
		expect(choreCreateErrorMessage('title_invalid')).toBe(
			'Putzaufgabe konnte nicht gespeichert werden: Der Titel muss 1 bis 120 Zeichen haben.',
		);
		expect(choreCreateErrorMessage('due_date_invalid')).toBe(
			'Putzaufgabe konnte nicht gespeichert werden: Das Fälligkeitsdatum ist ungültig.',
		);
		expect(choreCreateErrorMessage('insert_failed')).toBe(
			'Putzaufgabe konnte nicht gespeichert werden: Prüfe den Putzplan und versuche es erneut.',
		);
	});
});
