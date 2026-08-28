import { deriveMemberToken } from '@/lib/wg/member-token';
import { MEMBER_ID_HEADER, MEMBER_TOKEN_HEADER } from '@manawg/shared/lib/member-header';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findFirst = vi.fn();

vi.mock('@/lib/db', () => ({
	db: { query: { wgMembers: { findFirst: (...args: unknown[]) => findFirst(...args) } } },
	wgMembers: { deactivatedAt: 'deactivatedAt', id: 'id', wgId: 'wgId' },
}));

vi.mock('drizzle-orm', () => ({
	and: (...args: unknown[]) => ({ and: args }),
	eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
}));

import { isUuid, requireMember } from './api-auth';

const WG_ID = '989ac820-58b7-431f-9c65-28721264f333';
const MEMBER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

const requestWith = (headers?: Record<string, string>): NextRequest =>
	new NextRequest('https://manawg.test/api/wg/MTE8PZAT/expenses', headers ? { headers } : {});

describe('isUuid', () => {
	it('accepts a well-formed uuid regardless of case', () => {
		expect(isUuid(MEMBER_ID)).toBe(true);
		expect(isUuid(MEMBER_ID.toUpperCase())).toBe(true);
	});

	it.each([
		['a number', 42],
		['null', null],
		['undefined', undefined],
		['an object', {}],
		['a truncated uuid', MEMBER_ID.slice(0, -1)],
		['a uuid with sql appended', `${MEMBER_ID}' OR '1'='1`],
	])('rejects %s', (_label, value) => {
		expect(isUuid(value)).toBe(false);
	});
});

describe('requireMember', () => {
	beforeEach(() => {
		findFirst.mockReset();
	});

	describe('header handling', () => {
		it('rejects a request without the member header', async () => {
			const result = await requireMember(requestWith(), WG_ID);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.response.status).toBe(401);
				await expect(result.response.json()).resolves.toMatchObject({
					error: 'member_id_required',
				});
			}
		});

		it('rejects a blank header value', async () => {
			const result = await requireMember(requestWith({ [MEMBER_ID_HEADER]: '   ' }), WG_ID);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				await expect(result.response.json()).resolves.toMatchObject({
					error: 'member_id_required',
				});
			}
		});

		it('tolerates surrounding whitespace around a valid id', async () => {
			findFirst.mockResolvedValue({ id: MEMBER_ID, name: 'Mina' });

			const result = await requireMember(
				requestWith({ [MEMBER_ID_HEADER]: ` ${MEMBER_ID} ` }),
				WG_ID,
			);

			expect(result.ok).toBe(true);
		});

		it('rejects a malformed id before it ever reaches the database', async () => {
			const result = await requireMember(
				requestWith({ [MEMBER_ID_HEADER]: "not-a-uuid' OR 1=1--" }),
				WG_ID,
			);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				await expect(result.response.json()).resolves.toMatchObject({
					error: 'member_id_invalid',
				});
			}
			expect(findFirst).not.toHaveBeenCalled();
		});
	});

	describe('membership', () => {
		it('returns the verified member when the row exists', async () => {
			findFirst.mockResolvedValue({ id: MEMBER_ID, name: 'Mina' });

			const result = await requireMember(requestWith({ [MEMBER_ID_HEADER]: MEMBER_ID }), WG_ID);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.member).toEqual({ memberId: MEMBER_ID, name: 'Mina', verified: false });
			}
		});

		/**
		 * The whole point of the helper: a member id is only valid inside the WG
		 * it belongs to. A real id from another WG must not unlock this one.
		 */
		it('rejects a real member id that belongs to a different WG', async () => {
			findFirst.mockResolvedValue(undefined);

			const result = await requireMember(requestWith({ [MEMBER_ID_HEADER]: MEMBER_ID }), WG_ID);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.response.status).toBe(401);
				await expect(result.response.json()).resolves.toMatchObject({ error: 'not_a_member' });
			}
		});

		it('scopes the lookup to the requested WG rather than the member id alone', async () => {
			findFirst.mockResolvedValue({ id: MEMBER_ID, name: 'Mina' });

			await requireMember(requestWith({ [MEMBER_ID_HEADER]: MEMBER_ID }), WG_ID);

			expect(findFirst).toHaveBeenCalledTimes(1);
			expect(findFirst.mock.calls[0]?.[0]).toHaveProperty('where');
		});

		/**
		 * Deactivation ("Auszug") is a reversible soft-delete. A deactivated
		 * member row still exists, so admission must reject it even though the
		 * client's stored id is still technically valid.
		 */
		it('excludes deactivated members from admission', async () => {
			findFirst.mockResolvedValue({ id: MEMBER_ID, name: 'Mina', deactivatedAt: new Date() });

			const result = await requireMember(requestWith({ [MEMBER_ID_HEADER]: MEMBER_ID }), WG_ID);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.response.status).toBe(401);
				await expect(result.response.json()).resolves.toMatchObject({
					error: 'member_deactivated',
				});
			}
		});
	});

	describe('token verification', () => {
		it('marks the member verified when a valid signed token is supplied', async () => {
			vi.stubEnv('MEMBER_SESSION_SECRET', 'test-secret');
			findFirst.mockResolvedValue({ id: MEMBER_ID, name: 'Mina' });
			const token = deriveMemberToken(WG_ID, MEMBER_ID);

			const result = await requireMember(
				requestWith({ [MEMBER_ID_HEADER]: MEMBER_ID, [MEMBER_TOKEN_HEADER]: token ?? '' }),
				WG_ID,
			);

			expect(result.ok).toBe(true);
			if (result.ok) expect(result.member.verified).toBe(true);
			vi.unstubAllEnvs();
		});

		it('leaves the member unverified when the token header is missing', async () => {
			vi.stubEnv('MEMBER_SESSION_SECRET', 'test-secret');
			findFirst.mockResolvedValue({ id: MEMBER_ID, name: 'Mina' });

			const result = await requireMember(requestWith({ [MEMBER_ID_HEADER]: MEMBER_ID }), WG_ID);

			expect(result.ok).toBe(true);
			if (result.ok) expect(result.member.verified).toBe(false);
			vi.unstubAllEnvs();
		});

		it('leaves the member unverified when the token is garbage or forged', async () => {
			vi.stubEnv('MEMBER_SESSION_SECRET', 'test-secret');
			findFirst.mockResolvedValue({ id: MEMBER_ID, name: 'Mina' });

			const result = await requireMember(
				requestWith({
					[MEMBER_ID_HEADER]: MEMBER_ID,
					[MEMBER_TOKEN_HEADER]: 'deadbeef'.repeat(8),
				}),
				WG_ID,
			);

			expect(result.ok).toBe(true);
			if (result.ok) expect(result.member.verified).toBe(false);
			vi.unstubAllEnvs();
		});

		it('fails closed: never verifies when MEMBER_SESSION_SECRET is unset, even with a token', async () => {
			vi.stubEnv('MEMBER_SESSION_SECRET', '');
			findFirst.mockResolvedValue({ id: MEMBER_ID, name: 'Mina' });

			const result = await requireMember(
				requestWith({
					[MEMBER_ID_HEADER]: MEMBER_ID,
					[MEMBER_TOKEN_HEADER]: 'anything-at-all',
				}),
				WG_ID,
			);

			expect(result.ok).toBe(true);
			if (result.ok) expect(result.member.verified).toBe(false);
			vi.unstubAllEnvs();
		});
	});

	describe('database failure', () => {
		/**
		 * Unlike the rate limiter, authorization must fail CLOSED: an unreachable
		 * database may not turn into "everyone is a member".
		 */
		it('denies access instead of failing open', async () => {
			findFirst.mockRejectedValue(new Error('ECONNREFUSED'));
			vi.spyOn(console, 'error').mockImplementation(() => undefined);

			const result = await requireMember(requestWith({ [MEMBER_ID_HEADER]: MEMBER_ID }), WG_ID);

			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.response.status).toBe(503);
		});

		it('does not leak the database error to the caller', async () => {
			findFirst.mockRejectedValue(new Error('password authentication failed for user "admin"'));
			vi.spyOn(console, 'error').mockImplementation(() => undefined);

			const result = await requireMember(requestWith({ [MEMBER_ID_HEADER]: MEMBER_ID }), WG_ID);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				const body = await result.response.text();
				expect(body).not.toContain('password');
				expect(body).not.toContain('admin');
			}
		});
	});
});
