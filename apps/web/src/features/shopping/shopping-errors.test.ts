import { describe, expect, it } from 'vitest';
import {
	clearBoughtErrorMessage,
	shoppingActionErrorMessage,
	shoppingAddErrorMessage,
} from './shopping-errors';

describe('shopping error messages', () => {
	it('explains add errors with actionable copy', () => {
		expect(shoppingAddErrorMessage('Netzwerkfehler')).toBe(
			'Artikel konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
		);
		expect(shoppingAddErrorMessage('Failed to fetch')).toBe(
			'Artikel konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
		);
		expect(shoppingAddErrorMessage('unexpected_error')).toBe(
			'Artikel konnte nicht gespeichert werden: Versuche es gleich erneut.',
		);
		expect(shoppingAddErrorMessage('server_error')).toBe(
			'Artikel konnte nicht gespeichert werden: Versuche es gleich erneut.',
		);
		expect(shoppingAddErrorMessage('db_error')).toBe(
			'Artikel konnte nicht gespeichert werden: Versuche es gleich erneut.',
		);
		expect(shoppingAddErrorMessage('wg_not_found')).toBe(
			'Artikel konnte nicht gespeichert werden: Öffne die WG über den aktuellen Link erneut.',
		);
		expect(shoppingAddErrorMessage('member_id_invalid')).toBe(
			'Artikel konnte nicht gespeichert werden: Tritt der WG erneut bei.',
		);
		expect(shoppingAddErrorMessage('name_invalid')).toBe(
			'Artikel konnte nicht gespeichert werden: Der Name muss 1 bis 120 Zeichen haben.',
		);
		expect(shoppingAddErrorMessage('quantity_invalid')).toBe(
			'Artikel konnte nicht gespeichert werden: Die Menge darf höchstens 40 Zeichen haben.',
		);
		expect(shoppingAddErrorMessage('bought_invalid')).toBe(
			'Artikel konnte nicht gespeichert werden: Der Status ist ungültig.',
		);
		expect(shoppingAddErrorMessage('invalid_body')).toBe(
			'Artikel konnte nicht gespeichert werden: Die Anfrage war ungültig.',
		);
		expect(shoppingAddErrorMessage('insert_failed')).toBe(
			'Artikel konnte nicht gespeichert werden: Prüfe die Einkaufsliste und versuche es erneut.',
		);
	});

	it('explains shopping action errors with actionable copy', () => {
		expect(shoppingActionErrorMessage('Netzwerkfehler', 'Abhaken fehlgeschlagen.')).toBe(
			'Einkaufsaktion konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
		);
		expect(shoppingActionErrorMessage('server_error', 'Abhaken fehlgeschlagen.')).toBe(
			'Einkaufsaktion konnte nicht gespeichert werden: Versuche es gleich erneut.',
		);
		expect(shoppingActionErrorMessage('db_error', 'Abhaken fehlgeschlagen.')).toBe(
			'Einkaufsaktion konnte nicht gespeichert werden: Versuche es gleich erneut.',
		);
		expect(shoppingActionErrorMessage('not_a_member', 'Abhaken fehlgeschlagen.')).toBe(
			'Einkaufsaktion konnte nicht gespeichert werden: Tritt der WG erneut bei.',
		);
		expect(shoppingActionErrorMessage('id_invalid', 'Abhaken fehlgeschlagen.')).toBe(
			'Dieser Einkaufsartikel kann nicht mehr eindeutig zugeordnet werden.',
		);
		expect(shoppingActionErrorMessage('bought_invalid', 'Abhaken fehlgeschlagen.')).toBe(
			'Einkaufsaktion konnte nicht gespeichert werden: Der Status ist ungültig.',
		);
		expect(shoppingActionErrorMessage('other', 'Abhaken fehlgeschlagen.')).toBe(
			'Abhaken fehlgeschlagen.',
		);
	});

	it('explains clear-bought failures without exposing raw codes', () => {
		expect(clearBoughtErrorMessage(0, 'Netzwerkfehler')).toBe(
			'Erledigte konnten nicht entfernt werden: Prüfe deine Verbindung und versuche es erneut.',
		);
		expect(clearBoughtErrorMessage(500, 'unexpected_error')).toBe(
			'Erledigte konnten nicht entfernt werden: Versuche es gleich erneut.',
		);
		expect(clearBoughtErrorMessage(500, 'server_error')).toBe(
			'Erledigte konnten nicht entfernt werden: Versuche es gleich erneut.',
		);
		expect(clearBoughtErrorMessage(500, 'db_error')).toBe(
			'Erledigte konnten nicht entfernt werden: Versuche es gleich erneut.',
		);
		expect(clearBoughtErrorMessage(400, 'invalid_body')).toBe(
			'Erledigte konnten nicht entfernt werden.',
		);
	});
});
