import { E2E_EXISTING_WG } from '@/core/infra/e2e-db-down';
import { MEMBER_ID_HEADER } from '@manawg/shared/lib/member-header';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('search route', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	function enableDbDownMode(): void {
		vi.stubEnv('CI', 'true');
		vi.stubEnv('NEXT_PUBLIC_DB_DOWN', 'true');
		vi.stubEnv('POSTGRES_URL', '');
		vi.stubEnv('DATABASE_URL', '');
	}

	it('returns 401 when the member header is missing in DB-down mode', async () => {
		enableDbDownMode();
		const { GET } = await import('./route');

		const res = await GET(
			new NextRequest(`https://mana.test/api/wg/${E2E_EXISTING_WG.shareCode}/search?q=Miete`),
			{ params: Promise.resolve({ code: E2E_EXISTING_WG.shareCode }) },
		);

		expect(res.status).toBe(401);
		await expect(res.json()).resolves.toEqual({
			error: 'member_id_required',
			code: 'member_id_required',
		});
	});

	it('returns fixture results and suggestions for the E2E WG in DB-down mode', async () => {
		enableDbDownMode();
		const { GET } = await import('./route');

		const res = await GET(
			new NextRequest(`https://mana.test/api/wg/${E2E_EXISTING_WG.shareCode}/search?q=Miete`, {
				headers: { [MEMBER_ID_HEADER]: E2E_EXISTING_WG.member.id },
			}),
			{ params: Promise.resolve({ code: E2E_EXISTING_WG.shareCode }) },
		);

		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('private, no-store');
		await expect(res.json()).resolves.toMatchObject({
			results: [
				{
					id: 'e2e-expense-miete',
					module: 'ausgaben',
					title: 'Miete Mai',
					href: `/wg/${E2E_EXISTING_WG.shareCode}/ausgaben?highlight=e2e-expense-miete`,
				},
			],
			suggestions: expect.arrayContaining(['Hafermilch', 'Bad putzen', 'Internet']),
		});
	});

	it('returns 401 when the DB-down member is not part of the fixture WG', async () => {
		enableDbDownMode();
		const { GET } = await import('./route');

		const res = await GET(
			new NextRequest(`https://mana.test/api/wg/${E2E_EXISTING_WG.shareCode}/search?q=Miete`, {
				headers: { [MEMBER_ID_HEADER]: '00000000-0000-0000-0000-000000000000' },
			}),
			{ params: Promise.resolve({ code: E2E_EXISTING_WG.shareCode }) },
		);

		expect(res.status).toBe(401);
		await expect(res.json()).resolves.toEqual({
			error: 'not_a_member',
			code: 'not_a_member',
		});
	});
});
