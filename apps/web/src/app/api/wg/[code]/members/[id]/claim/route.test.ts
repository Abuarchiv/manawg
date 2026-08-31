import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }));
const dbMock = vi.hoisted(() => ({ findFirst: vi.fn() }));
const tokenMock = vi.hoisted(() => ({ verifyMemberToken: vi.fn() }));

vi.mock('@/core/auth/server', () => ({
	getAuthenticatedUser: (...args: unknown[]) => authMock.getAuthenticatedUser(...args),
}));

vi.mock('@/core/db', () => ({
	db: { query: { wgs: { findFirst: (...args: unknown[]) => dbMock.findFirst(...args) } } },
	wgMembers: { authUserId: 'authUserId', id: 'id', wgId: 'wgId' },
}));

vi.mock('@/core/guards/member-token', () => ({
	verifyMemberToken: (...args: unknown[]) => tokenMock.verifyMemberToken(...args),
}));

const MEMBER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

describe('POST /api/wg/[code]/members/[id]/claim', () => {
	beforeEach(() => {
		authMock.getAuthenticatedUser.mockReset();
		dbMock.findFirst.mockReset();
		tokenMock.verifyMemberToken.mockReset();
		authMock.getAuthenticatedUser.mockResolvedValue({ id: 'auth-user-1' });
		dbMock.findFirst.mockResolvedValue({ id: 'wg-1' });
	});

	it('refuses to bind a member unless the old device proves the exact member token', async () => {
		tokenMock.verifyMemberToken.mockReturnValue(false);
		const { POST } = await import('./route');

		const response = await POST(
			new NextRequest(`https://mana.test/api/wg/MTE8PZAT/members/${MEMBER_ID}/claim`, {
				method: 'POST',
				headers: {
					'x-manawg-member-id': MEMBER_ID,
					'x-manawg-member-token': 'not-a-valid-token',
				},
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT', id: MEMBER_ID }) },
		);

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toEqual({
			error: 'legacy_proof_required',
			code: 'legacy_proof_required',
		});
		expect(tokenMock.verifyMemberToken).toHaveBeenCalledWith(
			'wg-1',
			MEMBER_ID,
			'not-a-valid-token',
		);
	});
});
