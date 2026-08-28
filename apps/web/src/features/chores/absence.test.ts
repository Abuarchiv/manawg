import { describe, expect, it } from 'vitest';
import { formatAbsenceRange, getAbsentMemberIds, isMemberAbsent } from './absence';

describe('absence helpers', () => {
	it('detects members absent at a given point in time', () => {
		const absences = [
			{
				memberId: 'm1',
				startDate: '2026-05-18T00:00:00.000Z',
				endDate: '2026-05-20T23:59:59.000Z',
			},
			{
				memberId: 'm2',
				startDate: '2026-06-01T00:00:00.000Z',
				endDate: '2026-06-02T23:59:59.000Z',
			},
		];

		const now = new Date('2026-05-19T12:00:00.000Z').getTime();

		expect(isMemberAbsent(absences, 'm1', now)).toBe(true);
		expect(isMemberAbsent(absences, 'm2', now)).toBe(false);
		expect(getAbsentMemberIds(absences, now)).toEqual(['m1']);
	});

	it('ignores absence rows with invalid date boundaries', () => {
		const absences = [
			{
				memberId: 'm1',
				startDate: 'broken',
				endDate: '2026-05-20T23:59:59.000Z',
			},
			{
				memberId: 'm2',
				startDate: '2026-05-18T00:00:00.000Z',
				endDate: 'also-broken',
			},
		];
		const now = new Date('2026-05-19T12:00:00.000Z').getTime();

		expect(isMemberAbsent(absences, 'm1', now)).toBe(false);
		expect(getAbsentMemberIds(absences, now)).toEqual([]);
	});

	it('formats absence ranges without leaking invalid date labels', () => {
		expect(formatAbsenceRange('2026-05-18T00:00:00.000Z', 'broken')).toBe(
			'18.05. bis Datum unbekannt',
		);
	});
});
