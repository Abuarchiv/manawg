import { describe, expect, it } from 'vitest';
import {
	announcementActionErrorMessage,
	announcementCreateErrorMessage,
	commentActionErrorMessage,
} from './announcement-errors';

describe('announcement error messages', () => {
	it('explains announcement creation validation errors with actionable copy', () => {
		expect(announcementCreateErrorMessage('content_invalid')).toBe(
			'Beitrag konnte nicht gespeichert werden: Der Text muss 1 bis 2000 Zeichen haben.',
		);
		expect(announcementCreateErrorMessage('kind_invalid')).toBe(
			'Beitrag konnte nicht gespeichert werden: Die Beitragsart ist ungültig.',
		);
		expect(announcementCreateErrorMessage('image_invalid')).toBe(
			'Beitrag konnte nicht gespeichert werden: Der Anhang ist ungültig.',
		);
		expect(announcementCreateErrorMessage('source_path_invalid')).toBe(
			'Beitrag konnte nicht gespeichert werden: Der Quelllink ist ungültig.',
		);
	});

	it('explains announcement creation persistence failures with recovery hints', () => {
		expect(announcementCreateErrorMessage('Netzwerkfehler')).toBe(
			'Beitrag konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
		);
		expect(announcementCreateErrorMessage('Failed to fetch')).toBe(
			'Beitrag konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
		);
		expect(announcementCreateErrorMessage('insert_failed')).toBe(
			'Beitrag konnte nicht gespeichert werden: Prüfe die Pinnwand und versuche es erneut.',
		);
		expect(announcementCreateErrorMessage('server_error')).toBe(
			'Beitrag konnte nicht gespeichert werden: Versuche es gleich erneut.',
		);
		expect(announcementCreateErrorMessage('db_error')).toBe(
			'Beitrag konnte nicht gespeichert werden: Versuche es gleich erneut.',
		);
	});

	it('explains comment action validation errors with actionable copy', () => {
		expect(commentActionErrorMessage('comment_invalid')).toBe(
			'Kommentar konnte nicht gespeichert werden: Der Text muss 1 bis 600 Zeichen haben.',
		);
		expect(commentActionErrorMessage('not_owner')).toBe(
			'Nur der/die Autor:in kann diesen Kommentar ändern.',
		);
		expect(commentActionErrorMessage('unexpected_error')).toBe(
			'Kommentar-Aktion fehlgeschlagen: Versuche es gleich erneut.',
		);
		expect(commentActionErrorMessage('server_error')).toBe(
			'Kommentar-Aktion fehlgeschlagen: Versuche es gleich erneut.',
		);
		expect(commentActionErrorMessage('db_error')).toBe(
			'Kommentar-Aktion fehlgeschlagen: Versuche es gleich erneut.',
		);
	});

	it('explains comment persistence failures with recovery hints', () => {
		expect(commentActionErrorMessage('insert_failed')).toBe(
			'Kommentar konnte nicht gespeichert werden: Lade den Beitrag neu und versuche es erneut.',
		);
		expect(commentActionErrorMessage('delete_failed')).toBe(
			'Kommentar konnte nicht gelöscht werden: Lade den Beitrag neu und prüfe, ob er noch existiert.',
		);
		expect(commentActionErrorMessage('comment_not_found')).toBe(
			'Kommentar existiert nicht mehr. Lade den Beitrag neu, um den aktuellen Stand zu sehen.',
		);
	});

	it('explains announcement action validation errors with actionable copy', () => {
		expect(announcementActionErrorMessage('reaction_invalid')).toBe(
			'Reaktion konnte nicht gespeichert werden: Die Reaktion ist ungültig.',
		);
		expect(announcementActionErrorMessage('status_invalid')).toBe(
			'Pinnwand-Status konnte nicht gespeichert werden: Der Status ist ungültig.',
		);
		expect(announcementActionErrorMessage('pinned_invalid')).toBe(
			'Fixierung konnte nicht gespeichert werden: Der Wert ist ungültig.',
		);
	});

	it('explains reaction persistence failures with recovery hints', () => {
		expect(announcementActionErrorMessage('server_error')).toBe(
			'Pinnwand-Aktion fehlgeschlagen: Versuche es gleich erneut.',
		);
		expect(announcementActionErrorMessage('db_error')).toBe(
			'Pinnwand-Aktion fehlgeschlagen: Versuche es gleich erneut.',
		);
		expect(announcementActionErrorMessage('insert_failed')).toBe(
			'Reaktion konnte nicht gespeichert werden: Lade den Beitrag neu und versuche es erneut.',
		);
		expect(announcementActionErrorMessage('delete_failed')).toBe(
			'Reaktion konnte nicht entfernt werden: Lade den Beitrag neu und prüfe den aktuellen Stand.',
		);
		expect(announcementActionErrorMessage('reaction_not_found')).toBe(
			'Reaktion existiert nicht mehr. Lade den Beitrag neu, um den aktuellen Stand zu sehen.',
		);
	});
});
