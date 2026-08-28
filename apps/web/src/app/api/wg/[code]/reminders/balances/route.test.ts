import { E2E_EXISTING_WG } from '@/core/infra/e2e-db-down';
import { resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { MEMBER_ID_HEADER } from '@manawg/shared/lib/member-header';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('reminders balances route DB-down fixture mode', () => {
	beforeEach(() => {
		resetRouteHarness();
		vi.stubEnv('CI', 'true');
		vi.stubEnv('NEXT_PUBLIC_DB_DOWN', 'true');
		vi.stubEnv('POSTGRES_URL', '');
		vi.stubEnv('DATABASE_URL', '');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('BUG-569: returns fixture balances for a fixture member without touching the database', async () => {
		const { GET } = await import('./route');
		const res = await GET(
			new NextRequest(`https://mana.test/api/wg/${E2E_EXISTING_WG.shareCode}/reminders/balances`, {
				headers: { [MEMBER_ID_HEADER]: E2E_EXISTING_WG.member.id },
			}),
			{ params: Promise.resolve({ code: E2E_EXISTING_WG.shareCode }) },
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ balances: [] });
		expect(routeDb.select).not.toHaveBeenCalled();
		expect(routeMocks.requireMember).not.toHaveBeenCalled();
	});

	it('requires a member id in DB-down mode', async () => {
		const { GET } = await import('./route');
		const res = await GET(
			new NextRequest(`https://mana.test/api/wg/${E2E_EXISTING_WG.shareCode}/reminders/balances`),
			{ params: Promise.resolve({ code: E2E_EXISTING_WG.shareCode }) },
		);

		expect(res.status).toBe(401);
		await expect(res.json()).resolves.toMatchObject({ code: 'member_id_required' });
		expect(routeDb.select).not.toHaveBeenCalled();
	});
});
