import { E2E_EXISTING_WG } from '@/core/infra/e2e-db-down';
import { MEMBER_ID_HEADER } from '@manawg/shared/lib/member-header';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/guards/api-auth', () => {
	throw new Error('api-auth must not load in dashboard DB-down mode');
});

vi.mock('@/core/db', () => {
	throw new Error('db must not load in dashboard DB-down mode');
});

vi.mock('@/core/reads/dashboard-data', () => {
	throw new Error('dashboard-data must not load in dashboard DB-down mode');
});

describe('dashboard route DB-down cold start', () => {
	beforeEach(() => {
		vi.stubEnv('CI', 'true');
		vi.stubEnv('NEXT_PUBLIC_DB_DOWN', 'true');
		vi.stubEnv('POSTGRES_URL', '');
		vi.stubEnv('DATABASE_URL', '');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('BUG-HUNT: returns fixture auth errors without loading DB-backed modules', async () => {
		const { GET } = await import('./route');

		const res = await GET(
			new NextRequest(`https://mana.test/api/wg/${E2E_EXISTING_WG.shareCode}/dashboard`),
			{ params: Promise.resolve({ code: E2E_EXISTING_WG.shareCode }) },
		);

		expect(res.status).toBe(401);
		await expect(res.json()).resolves.toEqual({
			error: 'member_id_required',
			code: 'member_id_required',
		});
	});

	it('returns fixture dashboard data for a fixture member', async () => {
		const { GET } = await import('./route');

		const res = await GET(
			new NextRequest(`https://mana.test/api/wg/${E2E_EXISTING_WG.shareCode}/dashboard`, {
				headers: { [MEMBER_ID_HEADER]: E2E_EXISTING_WG.member.id },
			}),
			{ params: Promise.resolve({ code: E2E_EXISTING_WG.shareCode }) },
		);

		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('private, no-store');
		await expect(res.json()).resolves.toMatchObject({
			totalSpendCents: 3290,
			openShoppingCount: 1,
			openShoppingTop: ['Hafermilch'],
		});
	});
});
