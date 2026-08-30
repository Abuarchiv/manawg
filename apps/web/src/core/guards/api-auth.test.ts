import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findFirst = vi.fn();
const authMock = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }));

vi.mock('@/core/auth/server', () => ({
	getAuthenticatedUser: (...args: unknown[]) => authMock.getAuthenticatedUser(...args),
}));

vi.mock('@/core/db', () => ({
	db: { query: { wgMembers: { findFirst: (...args: unknown[]) => findFirst(...args) } } },
	wgMembers: { authUserId: 'authUserId', deactivatedAt: 'deactivatedAt', wgId: 'wgId' },
}));

vi.mock('drizzle-orm', () => ({
	and: (...args: unknown[]) => ({ and: args }),
	eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
}));

import { isUuid, requireMember } from './api-auth';

const WG_ID = '989ac820-58b7-431f-9c65-28721264f333';
const MEMBER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const AUTH_USER_ID = 'f1f4d07d-bc88-4df8-a5a4-b0103d4c91b8';

const requestWith = (headers?: Record<string, string>): NextRequest =>
	new NextRequest('https://manawg.test/api/wg/MTE8PZAT/expenses', {
		...(headers ? { headers } : {}),
	});

describe('isUuid', () => {
	it('accepts a well-formed uuid regardless of case', () => {
		expect(isUuid(MEMBER_ID)).toBe(true);
		expect(isUuid(MEMBER_ID.toUpperCase())).toBe(true);
	});

	it.each([
		['a number', 42],
		['null', null],
		['a truncated uuid', MEMBER_ID.slice(0, -1)],
	])('rejects %s', (_label, value) => expect(isUuid(value)).toBe(false));
});

describe('requireMember', () => {
	beforeEach(() => {
		findFirst.mockReset();
		authMock.getAuthenticatedUser.mockReset();
	});

	it('rejects a request without a verified Supabase user before querying the database', async () => {
		authMock.getAuthenticatedUser.mockResolvedValue(null);

		const result = await requireMember(requestWith(), WG_ID);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.response.status).toBe(401);
			await expect(result.response.json()).resolves.toMatchObject({ error: 'auth_required' });
		}
		expect(findFirst).not.toHaveBeenCalled();
	});

	it('uses the verified Supabase subject, never an x-manawg-member-id header', async () => {
		authMock.getAuthenticatedUser.mockResolvedValue({ id: AUTH_USER_ID });
		findFirst.mockResolvedValue({ id: MEMBER_ID, name: 'Mina', deactivatedAt: null });

		const result = await requireMember(
			requestWith({ 'x-manawg-member-id': '00000000-0000-4000-8000-000000000000' }),
			WG_ID,
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.member).toEqual({ memberId: MEMBER_ID, name: 'Mina', verified: true });
		}
		expect(findFirst).toHaveBeenCalledTimes(1);
		expect(findFirst.mock.calls[0]?.[0]).toHaveProperty('where');
	});

	it('rejects an authenticated account that is not linked to this WG', async () => {
		authMock.getAuthenticatedUser.mockResolvedValue({ id: AUTH_USER_ID });
		findFirst.mockResolvedValue(undefined);

		const result = await requireMember(requestWith(), WG_ID);

		expect(result.ok).toBe(false);
		if (!result.ok)
			await expect(result.response.json()).resolves.toMatchObject({ error: 'not_a_member' });
	});

	it('excludes a deactivated linked member', async () => {
		authMock.getAuthenticatedUser.mockResolvedValue({ id: AUTH_USER_ID });
		findFirst.mockResolvedValue({ id: MEMBER_ID, name: 'Mina', deactivatedAt: new Date() });

		const result = await requireMember(requestWith(), WG_ID);

		expect(result.ok).toBe(false);
		if (!result.ok)
			await expect(result.response.json()).resolves.toMatchObject({ error: 'member_deactivated' });
	});

	it('fails closed when the membership lookup fails', async () => {
		authMock.getAuthenticatedUser.mockResolvedValue({ id: AUTH_USER_ID });
		findFirst.mockRejectedValue(new Error('ECONNREFUSED'));
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const result = await requireMember(requestWith(), WG_ID);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.response.status).toBe(503);
	});
});
