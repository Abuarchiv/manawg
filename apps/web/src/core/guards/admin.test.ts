import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const whereMock = vi.fn();
const limitMock = vi.fn();

vi.mock('drizzle-orm', () => ({
	and: (...args: unknown[]) => ({ and: args }),
	asc: (...args: unknown[]) => ({ asc: args }),
	eq: (...args: unknown[]) => ({ eq: args }),
	isNull: (...args: unknown[]) => ({ isNull: args }),
}));

vi.mock('@/core/db', () => ({
	db: {
		select: () => ({
			from: () => ({
				where: (...whereArgs: unknown[]) => {
					whereMock(...whereArgs);
					return {
						orderBy: () => ({
							limit: (...args: unknown[]) => limitMock(...args),
						}),
					};
				},
			}),
		}),
	},
	wgMembers: { id: 'id', wgId: 'wgId', createdAt: 'createdAt', deactivatedAt: 'deactivatedAt' },
}));

import { checkWgAdminAccess, isVerifiedWgAdmin, isWgAdmin } from './admin';

const WG_ID = '989ac820-58b7-431f-9c65-28721264f333';
const ADMIN_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const OTHER_ID = 'bbbbbbbb-5ad7-4f5d-abed-8c3e99a76973';

describe('isWgAdmin', () => {
	beforeEach(() => {
		limitMock.mockReset();
	});

	it('returns true when the given member is the oldest member of the WG', async () => {
		limitMock.mockResolvedValue([{ id: ADMIN_ID }]);
		expect(await isWgAdmin(WG_ID, ADMIN_ID)).toBe(true);
	});

	it('returns false when the given member is not the oldest member', async () => {
		limitMock.mockResolvedValue([{ id: ADMIN_ID }]);
		expect(await isWgAdmin(WG_ID, OTHER_ID)).toBe(false);
	});

	it('returns false when the WG has no members', async () => {
		limitMock.mockResolvedValue([]);
		expect(await isWgAdmin(WG_ID, ADMIN_ID)).toBe(false);
	});

	it('excludes deactivated members from admin resolution', async () => {
		limitMock.mockResolvedValue([{ id: ADMIN_ID }]);

		await isWgAdmin(WG_ID, ADMIN_ID);

		expect(whereMock).toHaveBeenCalledWith(
			expect.objectContaining({
				and: expect.arrayContaining([expect.objectContaining({ isNull: ['deactivatedAt'] })]),
			}),
		);
	});

	it('treats the oldest active member as admin once deactivated members are filtered out', async () => {
		limitMock.mockResolvedValue([{ id: ADMIN_ID }]);
		expect(await isWgAdmin(WG_ID, ADMIN_ID)).toBe(true);
	});
});

describe('isVerifiedWgAdmin', () => {
	beforeEach(() => {
		limitMock.mockReset();
	});

	it('returns false immediately when verified is false, without querying the db', async () => {
		const result = await isVerifiedWgAdmin(WG_ID, ADMIN_ID, false);

		expect(result).toBe(false);
		expect(limitMock).not.toHaveBeenCalled();
	});

	it('delegates to isWgAdmin and returns true when verified and the oldest member', async () => {
		limitMock.mockResolvedValue([{ id: ADMIN_ID }]);

		expect(await isVerifiedWgAdmin(WG_ID, ADMIN_ID, true)).toBe(true);
	});

	it('delegates to isWgAdmin and returns false when verified but not the oldest member', async () => {
		limitMock.mockResolvedValue([{ id: ADMIN_ID }]);

		expect(await isVerifiedWgAdmin(WG_ID, OTHER_ID, true)).toBe(false);
	});
});

describe('checkWgAdminAccess', () => {
	beforeEach(() => {
		limitMock.mockReset();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('rejects with not_verified when the request is unverified, even for the real admin', async () => {
		limitMock.mockResolvedValue([{ id: ADMIN_ID }]);

		const result = await checkWgAdminAccess(WG_ID, ADMIN_ID, false);

		expect(result).toEqual({ allowed: false, reason: 'not_verified' });
	});

	it('rejects with not_admin when verified but not the oldest member', async () => {
		limitMock.mockResolvedValue([{ id: ADMIN_ID }]);

		const result = await checkWgAdminAccess(WG_ID, OTHER_ID, true);

		expect(result).toEqual({ allowed: false, reason: 'not_admin' });
	});

	it('allows verified requests from the real admin', async () => {
		limitMock.mockResolvedValue([{ id: ADMIN_ID }]);

		const result = await checkWgAdminAccess(WG_ID, ADMIN_ID, true);

		expect(result).toEqual({ allowed: true });
	});

	it('denies with not_admin when the WG has no active members (deactivated oldest member)', async () => {
		limitMock.mockResolvedValue([]);

		const result = await checkWgAdminAccess(WG_ID, ADMIN_ID, true);

		expect(result).toEqual({ allowed: false, reason: 'not_admin' });
	});

	it('never calls isWgAdmin (and therefore the database) when unverified', async () => {
		await checkWgAdminAccess(WG_ID, ADMIN_ID, false);

		expect(limitMock).not.toHaveBeenCalled();
	});
});
