// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
	buildDraftKey,
	buildQueueEditDraft,
	buildQueueEditHref,
	parseDraft,
	readDraft,
	removeDraft,
	writeDraft,
} from './drafts';

describe('draft helpers', () => {
	it('uses stable per-WG draft keys', () => {
		expect(buildDraftKey('ABC12345', 'expense')).toBe('manawg:draft:ABC12345:expense');
	});

	it('builds encoded edit links for queued action modules', () => {
		expect(buildQueueEditHref('WG/123?x=1', 'shopping')).toBe('/wg/WG%2F123%3Fx%3D1/einkauf');
		expect(buildQueueEditHref('WG/123?x=1', 'announcement')).toBe('/wg/WG%2F123%3Fx%3D1/pinnwand');
		expect(buildQueueEditHref('WG/123?x=1', 'expense')).toBe('/wg/WG%2F123%3Fx%3D1/ausgaben');
		expect(buildQueueEditHref('WG/123?x=1', 'chore')).toBe('/wg/WG%2F123%3Fx%3D1/putzen');
		expect(buildQueueEditHref('WG/123?x=1', 'chore', { openAbsencesPanel: true })).toBe(
			'/wg/WG%2F123%3Fx%3D1/putzen?panel=absences',
		);
	});

	it('parses only object drafts', () => {
		expect(parseDraft<{ text: string }>('{"text":"Hallo"}')).toEqual({ text: 'Hallo' });
		expect(parseDraft('[]')).toBeNull();
		expect(parseDraft('nope')).toBeNull();
	});

	it('reads, writes, and removes drafts through safe storage helpers', () => {
		const key = buildDraftKey('ABC12345', 'shopping');

		expect(writeDraft(key, { name: 'Milch', quantity: '2x' })).toBe(true);
		expect(readDraft<{ name: string; quantity: string }>(key)).toEqual({
			name: 'Milch',
			quantity: '2x',
		});

		removeDraft(key);
		expect(readDraft(key)).toBeNull();
	});

	it('does not throw when browser storage is blocked', () => {
		const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
		try {
			Object.defineProperty(window, 'localStorage', {
				configurable: true,
				get() {
					throw new Error('blocked');
				},
			});

			expect(writeDraft('draft', { text: 'Hallo' })).toBe(false);
			expect(readDraft('draft')).toBeNull();
			expect(() => removeDraft('draft')).not.toThrow();
		} finally {
			if (original) Object.defineProperty(window, 'localStorage', original);
		}
	});

	it('converts queued actions into editable form drafts', () => {
		expect(
			buildQueueEditDraft({
				id: 'q1',
				type: 'shopping.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T10:00:00.000Z',
				payload: { name: 'Milch', quantity: '2x' },
			}),
		).toEqual({
			module: 'shopping',
			draft: {
				queueEditId: 'q1',
				queueEditType: 'shopping.create',
				name: 'Milch',
				quantity: '2x',
			},
		});
		expect(
			buildQueueEditDraft({
				id: 'q-chore',
				type: 'chore.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T10:00:00.000Z',
				payload: { title: 'Bad putzen', intervalDays: 7, assignedMemberId: 'm2' },
			}),
		).toEqual({
			module: 'chore',
			draft: {
				queueEditId: 'q-chore',
				queueEditType: 'chore.create',
				title: 'Bad putzen',
				intervalDays: 7,
				assignedMemberId: 'm2',
			},
		});
		expect(
			buildQueueEditDraft({
				id: 'q-absence',
				type: 'absence.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T10:00:00.000Z',
				payload: {
					memberId: 'm2',
					startDate: '2026-05-20T00:00:00.000Z',
					endDate: '2026-05-22T23:59:59.000Z',
					reason: 'Urlaub',
				},
			}),
		).toEqual({
			module: 'chore',
			draft: {
				queueEditId: 'q-absence',
				queueEditType: 'absence.create',
				absenceMemberId: 'm2',
				absenceStartDate: '2026-05-20T00:00:00.000Z',
				absenceEndDate: '2026-05-22T23:59:59.000Z',
				absenceReason: 'Urlaub',
				openAbsencesPanel: true,
			},
		});
	});

	it('preserves manual expense splits when editing queued expenses', () => {
		expect(
			buildQueueEditDraft({
				id: 'q2',
				type: 'expense.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T10:00:00.000Z',
				payload: {
					description: 'Pizza',
					amountCents: 2750,
					paidByMemberId: 'm1',
					splits: [
						{ debtorMemberId: 'm1', amountCents: 1000 },
						{ debtorMemberId: 'm2', amountCents: 1750 },
					],
				},
			}),
		).toEqual({
			module: 'expense',
			draft: {
				queueEditId: 'q2',
				queueEditType: 'expense.create',
				description: 'Pizza',
				amountStr: '27,50',
				imageUrl: null,
				paidByMemberId: 'm1',
				splitMode: 'manual',
				manualSplits: { m1: '10,00', m2: '17,50' },
			},
		});
		expect(
			buildQueueEditDraft({
				id: 'q-recurring',
				type: 'recurring.create',
				shareCode: 'ABC12345',
				memberId: 'm1',
				createdAt: '2026-05-18T10:00:00.000Z',
				payload: {
					description: 'Internet',
					amountCents: 3290,
					paidByMemberId: 'm1',
					intervalMonths: 1,
					nextDueAt: '2026-06-20T00:00:00.000Z',
					splits: [{ debtorMemberId: 'm1', amountCents: 3290 }],
				},
			}),
		).toEqual({
			module: 'expense',
			draft: {
				queueEditId: 'q-recurring',
				queueEditType: 'recurring.create',
				description: 'Internet',
				amountStr: '32,90',
				imageUrl: null,
				paidByMemberId: 'm1',
				splitMode: 'manual',
				recurringIntervalMonths: 1,
				recurringNextDueAt: '2026-06-20T00:00:00.000Z',
				manualSplits: { m1: '32,90' },
			},
		});
	});
});
