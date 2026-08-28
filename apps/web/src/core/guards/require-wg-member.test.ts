import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveMock = vi.hoisted(() => ({
	resolveWg: vi.fn(),
}));

const authMock = vi.hoisted(() => ({
	requireMember: vi.fn(),
}));

vi.mock('@/core/guards/resolve', () => ({
	resolveWg: (...args: unknown[]) => resolveMock.resolveWg(...args),
}));

vi.mock('@/core/guards/api-auth', () => ({
	requireMember: (...args: unknown[]) => authMock.requireMember(...args),
}));

const HTTP_NOT_FOUND = 404;
const HTTP_UNAUTHORIZED = 401;
const SHARE_CODE = 'MTE8PZAT';
const WG_ROW = { id: 'wg-1', name: 'Test WG', shareCode: SHARE_CODE };
const MEMBER = { memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973', name: 'Amina' };

function fakeRequest(): NextRequest {
	return {} as NextRequest;
}

describe('requireWgMember', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns 404 wg_not_found when the share code resolves to no WG', async () => {
		// Arrange
		const { requireWgMember } = await import('./require-wg-member');
		resolveMock.resolveWg.mockResolvedValue(null);

		// Act
		const result = await requireWgMember(fakeRequest(), SHARE_CODE);

		// Assert
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('expected failure result');
		expect(result.response.status).toBe(HTTP_NOT_FOUND);
		await expect(result.response.json()).resolves.toEqual({ error: 'wg_not_found' });
		expect(authMock.requireMember).not.toHaveBeenCalled();
	});

	it('passes the member auth failure response through unchanged', async () => {
		// Arrange
		const { requireWgMember } = await import('./require-wg-member');
		resolveMock.resolveWg.mockResolvedValue(WG_ROW);
		const failureResponse = { status: HTTP_UNAUTHORIZED };
		authMock.requireMember.mockResolvedValue({ ok: false, response: failureResponse });

		// Act
		const result = await requireWgMember(fakeRequest(), SHARE_CODE);

		// Assert
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('expected failure result');
		expect(result.response).toBe(failureResponse);
	});

	it('returns the WG row and verified member on success', async () => {
		// Arrange
		const { requireWgMember } = await import('./require-wg-member');
		resolveMock.resolveWg.mockResolvedValue(WG_ROW);
		authMock.requireMember.mockResolvedValue({ ok: true, member: MEMBER });
		const req = fakeRequest();

		// Act
		const result = await requireWgMember(req, SHARE_CODE);

		// Assert
		expect(result).toEqual({ ok: true, wg: WG_ROW, member: MEMBER });
		expect(resolveMock.resolveWg).toHaveBeenCalledWith(SHARE_CODE);
		expect(authMock.requireMember).toHaveBeenCalledWith(req, WG_ROW.id);
	});
});
