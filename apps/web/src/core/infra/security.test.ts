import { describe, expect, it } from 'vitest';
import { buildSecurityOverview } from './security';

describe('buildSecurityOverview', () => {
	it('summarizes local identity and join-code safety state', () => {
		expect(
			buildSecurityOverview({
				memberName: 'Ava',
				memberCount: 2,
				joiningEnabled: false,
				shareCodeRotatedAt: '2026-05-18T10:00:00.000Z',
			}),
		).toEqual([
			{ label: 'Identität', value: 'Ava auf diesem Gerät' },
			{ label: 'Mitglieder', value: '2 Personen in der WG' },
			{ label: 'Beitritt', value: 'Neue Beitritte gesperrt' },
			{ label: 'Code erneuert', value: '18.05.2026' },
		]);
	});

	it('keeps the join-code rotation date readable when stored data is invalid', () => {
		expect(
			buildSecurityOverview({
				memberName: 'Ava',
				memberCount: 1,
				joiningEnabled: true,
				shareCodeRotatedAt: 'kein-datum',
			}).find((item) => item.label === 'Code erneuert')?.value,
		).toBe('Datum unbekannt');
	});
});
