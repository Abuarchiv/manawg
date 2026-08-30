import { db, wgMembers, wgs } from '@/core/db';
import { deriveMemberToken } from '@/core/guards/member-token';
import { MEMBER_ID_HEADER, MEMBER_TOKEN_HEADER } from '@/shared/lib/member-header';
import { generateShareCode } from '@/shared/lib/share-code';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }));

vi.mock('@/core/auth/server', () => ({
	getAuthenticatedUser: (...args: unknown[]) => authMock.getAuthenticatedUser(...args),
}));

const hasRealDb = Boolean(process.env.POSTGRES_URL || process.env.DATABASE_URL);
const FIRST_USER_ID = 'f5d54a29-2d61-455b-bebe-9c0905889a65';
const SECOND_USER_ID = '0b4e9b1a-45be-44ea-9fb1-8dd7267b3d2a';
const THIRD_USER_ID = 'd9e8bf5d-d72d-4d5a-b8e8-4f6c5d8c0f65';

describe.skipIf(!hasRealDb)('POST /api/wg/[code]/members/[id]/claim (real database)', () => {
	let wgId: string;
	let shareCode: string;
	let firstMemberId: string;
	let secondMemberId: string;

	beforeAll(async () => {
		process.env.MEMBER_SESSION_SECRET = 'claim-integration-secret';
		const [wg] = await db
			.insert(wgs)
			.values({ name: 'Claim-Test-WG', shareCode: generateShareCode() })
			.returning();
		if (!wg) throw new Error('failed to seed wg');
		wgId = wg.id;
		shareCode = wg.shareCode;

		const seededMembers = await db
			.insert(wgMembers)
			.values([
				{ wgId, name: 'Erstes Mitglied' },
				{ wgId, name: 'Zweites Mitglied' },
			])
			.returning({ id: wgMembers.id });
		if (seededMembers.length !== 2) throw new Error('failed to seed members');
		firstMemberId = seededMembers[0]?.id ?? '';
		secondMemberId = seededMembers[1]?.id ?? '';
	});

	afterAll(async () => {
		await db.delete(wgs).where(eq(wgs.id, wgId));
	});

	function request(memberId: string, userId: string): NextRequest {
		const token = deriveMemberToken(wgId, memberId);
		if (!token) throw new Error('missing member token');
		authMock.getAuthenticatedUser.mockResolvedValueOnce({ id: userId });
		return new NextRequest(`https://mana.test/api/wg/${shareCode}/members/${memberId}/claim`, {
			method: 'POST',
			headers: {
				[MEMBER_ID_HEADER]: memberId,
				[MEMBER_TOKEN_HEADER]: token,
			},
		});
	}

	it('binds a proven legacy profile to the signed-in account', async () => {
		const { POST } = await import('./route');
		const response = await POST(request(firstMemberId, FIRST_USER_ID), {
			params: Promise.resolve({ code: shareCode, id: firstMemberId }),
		});

		expect(response.status).toBe(200);
		const [member] = await db
			.select({ authUserId: wgMembers.authUserId })
			.from(wgMembers)
			.where(eq(wgMembers.id, firstMemberId));
		expect(member?.authUserId).toBe(FIRST_USER_ID);
	});

	it('does not let one account claim a second profile in the same WG', async () => {
		const { POST } = await import('./route');
		const response = await POST(request(secondMemberId, FIRST_USER_ID), {
			params: Promise.resolve({ code: shareCode, id: secondMemberId }),
		});

		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toMatchObject({ code: 'account_already_linked' });
	});

	it('serializes competing claims for the same legacy profile', async () => {
		const { POST } = await import('./route');
		const responses = await Promise.all([
			POST(request(secondMemberId, SECOND_USER_ID), {
				params: Promise.resolve({ code: shareCode, id: secondMemberId }),
			}),
			POST(request(secondMemberId, THIRD_USER_ID), {
				params: Promise.resolve({ code: shareCode, id: secondMemberId }),
			}),
		]);

		expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
	});
});
