import { describe, expect, it } from 'vitest';
import { getInitialJoinCode, joinErrorMessage, shouldFallbackToDirectJoin } from './join-flow';

describe('getInitialJoinCode', () => {
	it('reads and normalizes a valid invite code from the query string', () => {
		expect(getInitialJoinCode('?code=mte8pzat')).toBe('MTE8PZAT');
	});

	it('ignores invalid invite codes', () => {
		expect(getInitialJoinCode('?code=TOO-SHORT')).toBe('');
	});
});

describe('joinErrorMessage', () => {
	it('explains missing WGs in user language', () => {
		expect(joinErrorMessage(404, 'wg_not_found')).toBe('Diesen WG-Code gibt es nicht.');
	});

	it('explains duplicate member names', () => {
		expect(joinErrorMessage(409, 'name_taken')).toBe('Der Name ist in dieser WG schon vergeben.');
	});

	it('explains failed member inserts while joining', () => {
		expect(joinErrorMessage(500, 'insert_failed')).toBe(
			'Beitritt konnte nicht gespeichert werden: Prüfe die WG und versuche es erneut.',
		);
	});

	it('explains retryable server failures while joining', () => {
		expect(joinErrorMessage(500, 'server_error')).toBe(
			'Beitritt konnte nicht abgeschlossen werden: Versuche es gleich erneut.',
		);
		expect(joinErrorMessage(503, 'db_error')).toBe(
			'Beitritt konnte nicht abgeschlossen werden: Versuche es gleich erneut.',
		);
	});

	it('explains invalid join names specifically', () => {
		expect(joinErrorMessage(400, 'name_invalid')).toBe('Dein Name muss 1 bis 80 Zeichen haben.');
	});

	it('explains when new joins are disabled', () => {
		expect(joinErrorMessage(403, 'joining_disabled')).toBe(
			'Diese WG nimmt gerade keine neuen Beitritte an.',
		);
	});

	it('explains network failures while joining a WG', () => {
		expect(joinErrorMessage(0, '')).toBe(
			'Beitritt konnte nicht abgeschlossen werden: Prüfe deine Verbindung und versuche es erneut.',
		);
	});
});

describe('shouldFallbackToDirectJoin', () => {
	it('falls back to the WG route when invite verification incorrectly demands a member id', () => {
		expect(shouldFallbackToDirectJoin(401, 'member_id_required')).toBe(true);
	});

	it('does not hide normal join errors behind a route fallback', () => {
		expect(shouldFallbackToDirectJoin(404, 'wg_not_found')).toBe(false);
		expect(shouldFallbackToDirectJoin(403, 'joining_disabled')).toBe(false);
	});
});
