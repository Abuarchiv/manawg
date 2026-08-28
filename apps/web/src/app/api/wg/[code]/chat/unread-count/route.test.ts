import { E2E_EXISTING_WG } from '@/core/infra/e2e-db-down';
import { MEMBER_ID_HEADER } from '@manawg/shared/lib/member-header';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('chat unread-count route', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('rejects invalid share code', async () => {
		const { GET } = await import('./route');
		const res = await GET(new NextRequest('https://manawg.test/api/wg/zzz/chat/unread-count'), {
			params: Promise.resolve({ code: 'zzz' }),
		});
		expect(res.status).toBe(400);
	});

	it('BUG-571: returns a fixture unread count in DB-down mode without touching the database', async () => {
		vi.stubEnv('CI', 'true');
		vi.stubEnv('NEXT_PUBLIC_DB_DOWN', 'true');
		vi.stubEnv('POSTGRES_URL', '');
		vi.stubEnv('DATABASE_URL', '');

		const { GET } = await import('./route');
		const res = await GET(
			new NextRequest(`https://manawg.test/api/wg/${E2E_EXISTING_WG.shareCode}/chat/unread-count`, {
				headers: { [MEMBER_ID_HEADER]: E2E_EXISTING_WG.member.id },
			}),
			{ params: Promise.resolve({ code: E2E_EXISTING_WG.shareCode }) },
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ count: 0, overflow: false });
	});
});
