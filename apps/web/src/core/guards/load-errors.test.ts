import { describe, expect, it } from 'vitest';
import { getWgLoadErrorMessage } from './load-errors';

describe('getWgLoadErrorMessage', () => {
	it('explains network load failures without blaming WG membership', () => {
		expect(getWgLoadErrorMessage('Suche', 0, 'Netzwerkfehler')).toBe(
			'Suche konnte nicht geladen werden: Prüfe deine Verbindung und versuche es erneut.',
		);
		expect(getWgLoadErrorMessage('Aktivität', 0, 'Failed to fetch')).toBe(
			'Aktivität konnte nicht geladen werden: Prüfe deine Verbindung und versuche es erneut.',
		);
		expect(getWgLoadErrorMessage('Dashboard', 0, null)).toBe(
			'Dashboard konnte nicht geladen werden: Prüfe deine Verbindung und versuche es erneut.',
		);
	});

	it('keeps specific WG access guidance for known API errors', () => {
		expect(getWgLoadErrorMessage('Suche', 404, 'wg_not_found')).toBe(
			'Suche konnte nicht geladen werden: Öffne die WG über den aktuellen Link erneut.',
		);
		expect(getWgLoadErrorMessage('Aktivität', 401, 'member_id_invalid')).toBe(
			'Aktivität konnte nicht geladen werden: Tritt der WG erneut bei.',
		);
	});

	it('explains server load failures as retryable failures', () => {
		expect(getWgLoadErrorMessage('Dashboard', 500, 'server_error')).toBe(
			'Dashboard konnte nicht geladen werden: Versuche es gleich erneut.',
		);
		expect(getWgLoadErrorMessage('Ausgaben', 503, null, { verb: 'konnten' })).toBe(
			'Ausgaben konnten nicht geladen werden: Versuche es gleich erneut.',
		);
		expect(getWgLoadErrorMessage('Abwesenheiten', 500, 'db_error', { verb: 'konnten' })).toBe(
			'Abwesenheiten konnten nicht geladen werden: Versuche es gleich erneut.',
		);
	});

	it('supports plural load labels such as absences', () => {
		expect(getWgLoadErrorMessage('Abwesenheiten', 0, 'Netzwerkfehler', { verb: 'konnten' })).toBe(
			'Abwesenheiten konnten nicht geladen werden: Prüfe deine Verbindung und versuche es erneut.',
		);
	});

	it('explains rejected search queries with actionable copy', () => {
		expect(getWgLoadErrorMessage('Suche', 400, 'query_invalid')).toBe(
			'Suche konnte nicht geladen werden: Der Suchbegriff ist zu lang.',
		);
	});
});
