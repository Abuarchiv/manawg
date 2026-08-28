import { describe, expect, it } from 'vitest';

import {
	formatRecurringAdvanceConflictNote,
	formatRecurringTemplateConflictNote,
} from './offline-conflicts';

describe('offline conflict copy', () => {
	it('formats recurring template conflicts with a readable due date', () => {
		expect(
			formatRecurringTemplateConflictNote({
				description: 'Internet',
				amountCents: 3290,
				nextDueAt: '2026-06-20T00:00:00.000Z',
			}),
		).toBe(
			'Gleiche Fixkosten-Vorlage existiert schon. Nächste Fälligkeit dort: 20.6.2026. Prüfe vor dem Senden, ob es ein Duplikat wäre.',
		);
	});

	it('keeps recurring template conflicts readable when the due date is invalid', () => {
		expect(
			formatRecurringTemplateConflictNote({
				description: 'Internet',
				amountCents: 3290,
				nextDueAt: 'kein-datum',
			}),
		).toBe(
			'Gleiche Fixkosten-Vorlage existiert schon. Nächste Fälligkeit dort: Datum unbekannt. Prüfe vor dem Senden, ob es ein Duplikat wäre.',
		);
	});

	it('explains recurring advance conflicts against the expected due date', () => {
		expect(
			formatRecurringAdvanceConflictNote(
				{ nextDueAt: '2026-07-01T00:00:00.000Z' },
				'2026-06-20T00:00:00.000Z',
			),
		).toBe(
			'Server-Vorlage steht inzwischen auf 1.7.2026 statt 20.6.2026. Prüfe vor dem Senden, ob die Fälligkeit schon nachgeholt wurde.',
		);
	});

	it('confirms recurring advance actions when the expected due date still matches', () => {
		expect(
			formatRecurringAdvanceConflictNote(
				{ nextDueAt: '2026-06-20T00:00:00.000Z' },
				'2026-06-20T00:00:00.000Z',
			),
		).toBe(
			'Server-Vorlage ist noch auf der erwarteten Fälligkeit 20.6.2026. Du kannst die Offline-Aktion senden.',
		);
	});
});
