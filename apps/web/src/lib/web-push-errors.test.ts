import { describe, expect, it } from 'vitest';
import {
	formatPushActivationError,
	formatPushDeactivationError,
	parseWebPushStatusCode,
} from './web-push-errors';

describe('formatPushActivationError', () => {
	it('preserves expected German activation errors', () => {
		expect(formatPushActivationError(new Error('Push ist noch nicht konfiguriert.'))).toBe(
			'Push ist noch nicht konfiguriert.',
		);
		expect(formatPushActivationError(new Error('Benachrichtigungen wurden nicht erlaubt.'))).toBe(
			'Benachrichtigungen wurden nicht erlaubt.',
		);
		expect(
			formatPushActivationError(
				new Error('Push-Abo konnte nicht gespeichert werden: Aktiviere Web Push neu.'),
			),
		).toBe('Push-Abo konnte nicht gespeichert werden: Aktiviere Web Push neu.');
		expect(
			formatPushActivationError(
				new Error('Push-Abo konnte nicht gespeichert werden: Tritt der WG erneut bei.'),
			),
		).toBe('Push-Abo konnte nicht gespeichert werden: Tritt der WG erneut bei.');
		expect(
			formatPushActivationError(
				new Error('Push-Abo konnte nicht gespeichert werden: Versuche es gleich erneut.'),
			),
		).toBe('Push-Abo konnte nicht gespeichert werden: Versuche es gleich erneut.');
	});

	it('maps browser permission errors to the permission hint', () => {
		const error = new Error('Registration failed - permission denied');
		error.name = 'NotAllowedError';

		expect(formatPushActivationError(error)).toBe('Benachrichtigungen wurden nicht erlaubt.');
	});

	it('explains service worker registration failures without raw browser errors', () => {
		expect(
			formatPushActivationError(
				new Error('DOMException: Failed to register a ServiceWorker for scope'),
			),
		).toBe('Web Push konnte nicht aktiviert werden: Lade die Seite neu und versuche es erneut.');
	});

	it('hides unexpected browser and runtime errors', () => {
		expect(formatPushActivationError('plain failure')).toBe(
			'Web Push konnte nicht aktiviert werden.',
		);
	});
});

describe('formatPushDeactivationError', () => {
	it('preserves expected German deactivation errors', () => {
		expect(
			formatPushDeactivationError(
				new Error('Push-Abo konnte nicht deaktiviert werden: Tritt der WG erneut bei.'),
			),
		).toBe('Push-Abo konnte nicht deaktiviert werden: Tritt der WG erneut bei.');
		expect(
			formatPushDeactivationError(
				new Error('Push-Abo konnte nicht deaktiviert werden: Versuche es gleich erneut.'),
			),
		).toBe('Push-Abo konnte nicht deaktiviert werden: Versuche es gleich erneut.');
	});

	it('hides unexpected browser and runtime errors behind a deactivation fallback', () => {
		expect(formatPushDeactivationError(new Error('raw browser failure'))).toBe(
			'Web Push konnte nicht deaktiviert werden.',
		);
	});
});

describe('parseWebPushStatusCode', () => {
	it('accepts numeric and string HTTP status codes', () => {
		expect(parseWebPushStatusCode({ statusCode: 410 })).toBe(410);
		expect(parseWebPushStatusCode({ statusCode: '404' })).toBe(404);
	});

	it('rejects missing, non-http, and ambiguous values', () => {
		expect(parseWebPushStatusCode(null)).toBe(0);
		expect(parseWebPushStatusCode({})).toBe(0);
		expect(parseWebPushStatusCode({ statusCode: '410 gone' })).toBe(0);
		expect(parseWebPushStatusCode({ statusCode: 99 })).toBe(0);
		expect(parseWebPushStatusCode({ statusCode: 410.5 })).toBe(0);
	});
});
