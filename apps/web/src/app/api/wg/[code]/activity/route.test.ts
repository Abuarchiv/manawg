import { E2E_EXISTING_WG } from '@/core/infra/e2e-db-down';
import { MEMBER_ID_HEADER } from '@/shared/lib/member-header';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

describe('activity route E2E fallback auth', () => {
	beforeEach(() => {
		vi.stubEnv('CI', 'true');
		vi.stubEnv('NEXT_PUBLIC_DB_DOWN', 'true');
		vi.stubEnv('POSTGRES_URL', '');
		vi.stubEnv('DATABASE_URL', '');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('requires a member id in DB-down mode', async () => {
		const res = await GET(
			new NextRequest(`https://mana.test/api/wg/${E2E_EXISTING_WG.shareCode}/activity`),
			{ params: Promise.resolve({ code: E2E_EXISTING_WG.shareCode }) },
		);

		expect(res.status).toBe(401);
		await expect(res.json()).resolves.toMatchObject({
			code: 'member_id_required',
		});
	});

	it('rejects non-fixture members in DB-down mode', async () => {
		const res = await GET(
			new NextRequest(`https://mana.test/api/wg/${E2E_EXISTING_WG.shareCode}/activity`, {
				headers: {
					[MEMBER_ID_HEADER]: '00000000-0000-0000-0000-000000000000',
				},
			}),
			{ params: Promise.resolve({ code: E2E_EXISTING_WG.shareCode }) },
		);

		expect(res.status).toBe(401);
		await expect(res.json()).resolves.toMatchObject({
			code: 'not_a_member',
		});
	});
});
