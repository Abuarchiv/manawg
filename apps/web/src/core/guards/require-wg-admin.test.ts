import { wgWriteLimiter } from '@/core/rate-limit';
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
	findFirst: vi.fn(),
}));

const authMock = vi.hoisted(() => ({
	requireMember: vi.fn(),
}));

const adminMock = vi.hoisted(() => ({
	checkWgAdminAccess: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
}));

vi.mock('@/core/db', () => ({
	db: { query: { wgs: { findFirst: (...args: unknown[]) => dbMock.findFirst(...args) } } },
}));

vi.mock('@/core/guards/api-auth', () => ({
	requireMember: (...args: unknown[]) => authMock.requireMember(...args),
}));

vi.mock('@/core/guards/admin', () => ({
	checkWgAdminAccess: (...args: unknown[]) => adminMock.checkWgAdminAccess(...args),
}));

vi.mock('@/core/rate-limit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/core/rate-limit')>()),
	checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
}));

const HTTP_NOT_FOUND = 404;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY = 429;
const SHARE_CODE = 'MTE8PZAT';
const SCOPE = 'wg-settings';
const WG_ROW = { id: 'wg-1', name: 'Küche 4', joiningEnabled: true };
const MEMBER = { memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973', name: 'Ava', verified: true };

function fakeRequest(): NextRequest {
	return {} as NextRequest;
}

describe('requireWgAdmin', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: true, remaining: 9, reset: 0 });
	});

	it('returns 404 wg_not_found when the share code resolves to no WG', async () => {
		const { requireWgAdmin } = await import('./require-wg-admin');
		dbMock.findFirst.mockResolvedValue(undefined);

		const result = await requireWgAdmin(fakeRequest(), SHARE_CODE, SCOPE);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('expected failure result');
		expect(result.response.status).toBe(HTTP_NOT_FOUND);
		await expect(result.response.json()).resolves.toEqual({ error: 'wg_not_found' });
		expect(authMock.requireMember).not.toHaveBeenCalled();
		expect(adminMock.checkWgAdminAccess).not.toHaveBeenCalled();
	});

	it('passes the member auth failure response through unchanged', async () => {
		const { requireWgAdmin } = await import('./require-wg-admin');
		dbMock.findFirst.mockResolvedValue(WG_ROW);
		const failureResponse = { status: 401 };
		authMock.requireMember.mockResolvedValue({ ok: false, response: failureResponse });

		const result = await requireWgAdmin(fakeRequest(), SHARE_CODE, SCOPE);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('expected failure result');
		expect(result.response).toBe(failureResponse);
		expect(adminMock.checkWgAdminAccess).not.toHaveBeenCalled();
	});

	it('refuses an unverified member with member_not_verified before checking rate limits', async () => {
		const { requireWgAdmin } = await import('./require-wg-admin');
		dbMock.findFirst.mockResolvedValue(WG_ROW);
		authMock.requireMember.mockResolvedValue({
			ok: true,
			member: { ...MEMBER, verified: false },
		});
		adminMock.checkWgAdminAccess.mockResolvedValue({ allowed: false, reason: 'not_verified' });

		const result = await requireWgAdmin(fakeRequest(), SHARE_CODE, SCOPE);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('expected failure result');
		expect(result.response.status).toBe(HTTP_FORBIDDEN);
		await expect(result.response.json()).resolves.toEqual({
			error: 'member_not_verified',
			code: 'member_not_verified',
		});
		expect(rateLimitMock.checkRateLimit).not.toHaveBeenCalled();
	});

	it('refuses a verified non-admin member with not_admin before checking rate limits', async () => {
		const { requireWgAdmin } = await import('./require-wg-admin');
		dbMock.findFirst.mockResolvedValue(WG_ROW);
		authMock.requireMember.mockResolvedValue({ ok: true, member: MEMBER });
		adminMock.checkWgAdminAccess.mockResolvedValue({ allowed: false, reason: 'not_admin' });

		const result = await requireWgAdmin(fakeRequest(), SHARE_CODE, SCOPE);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('expected failure result');
		expect(result.response.status).toBe(HTTP_FORBIDDEN);
		await expect(result.response.json()).resolves.toEqual({
			error: 'not_admin',
			code: 'not_admin',
		});
		expect(rateLimitMock.checkRateLimit).not.toHaveBeenCalled();
	});

	it('returns 429 too_many_requests when the verified admin is rate-limited', async () => {
		const { requireWgAdmin } = await import('./require-wg-admin');
		dbMock.findFirst.mockResolvedValue(WG_ROW);
		authMock.requireMember.mockResolvedValue({ ok: true, member: MEMBER });
		adminMock.checkWgAdminAccess.mockResolvedValue({ allowed: true });
		rateLimitMock.checkRateLimit.mockResolvedValue({ success: false, remaining: 0, reset: 0 });

		const result = await requireWgAdmin(fakeRequest(), SHARE_CODE, SCOPE);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('expected failure result');
		expect(result.response.status).toBe(HTTP_TOO_MANY);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			wgWriteLimiter,
			`${SCOPE}:${WG_ROW.id}:${MEMBER.memberId}`,
		);
	});

	it('returns the WG and verified admin member on success', async () => {
		const { requireWgAdmin } = await import('./require-wg-admin');
		dbMock.findFirst.mockResolvedValue(WG_ROW);
		authMock.requireMember.mockResolvedValue({ ok: true, member: MEMBER });
		adminMock.checkWgAdminAccess.mockResolvedValue({ allowed: true });

		const result = await requireWgAdmin(fakeRequest(), SHARE_CODE, SCOPE);

		expect(result).toEqual({ ok: true, wg: WG_ROW, member: MEMBER });
		expect(adminMock.checkWgAdminAccess).toHaveBeenCalledWith(
			WG_ROW.id,
			MEMBER.memberId,
			MEMBER.verified,
		);
	});
});
