import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveMemberToken, verifyMemberToken } from './member-token';

const WG_ID = '989ac820-58b7-431f-9c65-28721264f333';
const OTHER_WG_ID = 'aaaaaaaa-58b7-431f-9c65-28721264f333';
const MEMBER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const OTHER_MEMBER_ID = 'bbbbbbbb-5ad7-4f5d-abed-8c3e99a76973';

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('deriveMemberToken', () => {
	it('returns null when MEMBER_SESSION_SECRET is unset', () => {
		vi.stubEnv('MEMBER_SESSION_SECRET', '');
		expect(deriveMemberToken(WG_ID, MEMBER_ID)).toBeNull();
	});

	it('returns null when MEMBER_SESSION_SECRET is blank', () => {
		vi.stubEnv('MEMBER_SESSION_SECRET', '   ');
		expect(deriveMemberToken(WG_ID, MEMBER_ID)).toBeNull();
	});

	it('is deterministic for the same wgId + memberId + secret', () => {
		vi.stubEnv('MEMBER_SESSION_SECRET', 'test-secret');
		expect(deriveMemberToken(WG_ID, MEMBER_ID)).toBe(deriveMemberToken(WG_ID, MEMBER_ID));
	});

	it('differs when the memberId differs', () => {
		vi.stubEnv('MEMBER_SESSION_SECRET', 'test-secret');
		expect(deriveMemberToken(WG_ID, MEMBER_ID)).not.toBe(deriveMemberToken(WG_ID, OTHER_MEMBER_ID));
	});

	it('differs when the wgId differs', () => {
		vi.stubEnv('MEMBER_SESSION_SECRET', 'test-secret');
		expect(deriveMemberToken(WG_ID, MEMBER_ID)).not.toBe(deriveMemberToken(OTHER_WG_ID, MEMBER_ID));
	});

	it('differs when the secret differs', () => {
		vi.stubEnv('MEMBER_SESSION_SECRET', 'secret-a');
		const tokenA = deriveMemberToken(WG_ID, MEMBER_ID);
		vi.stubEnv('MEMBER_SESSION_SECRET', 'secret-b');
		const tokenB = deriveMemberToken(WG_ID, MEMBER_ID);
		expect(tokenA).not.toBe(tokenB);
	});
});

describe('verifyMemberToken', () => {
	it('accepts a correctly derived token', () => {
		vi.stubEnv('MEMBER_SESSION_SECRET', 'test-secret');
		const token = deriveMemberToken(WG_ID, MEMBER_ID);
		expect(verifyMemberToken(WG_ID, MEMBER_ID, token)).toBe(true);
	});

	it('rejects a token derived for a different member', () => {
		vi.stubEnv('MEMBER_SESSION_SECRET', 'test-secret');
		const token = deriveMemberToken(WG_ID, OTHER_MEMBER_ID);
		expect(verifyMemberToken(WG_ID, MEMBER_ID, token)).toBe(false);
	});

	it('rejects a token derived for a different WG', () => {
		vi.stubEnv('MEMBER_SESSION_SECRET', 'test-secret');
		const token = deriveMemberToken(OTHER_WG_ID, MEMBER_ID);
		expect(verifyMemberToken(WG_ID, MEMBER_ID, token)).toBe(false);
	});

	it('rejects missing tokens', () => {
		vi.stubEnv('MEMBER_SESSION_SECRET', 'test-secret');
		expect(verifyMemberToken(WG_ID, MEMBER_ID, null)).toBe(false);
		expect(verifyMemberToken(WG_ID, MEMBER_ID, undefined)).toBe(false);
		expect(verifyMemberToken(WG_ID, MEMBER_ID, '')).toBe(false);
	});

	it('rejects garbage tokens without throwing, including mismatched lengths', () => {
		vi.stubEnv('MEMBER_SESSION_SECRET', 'test-secret');
		expect(verifyMemberToken(WG_ID, MEMBER_ID, 'not-hex')).toBe(false);
		expect(verifyMemberToken(WG_ID, MEMBER_ID, 'ab')).toBe(false);
		expect(verifyMemberToken(WG_ID, MEMBER_ID, 'deadbeef')).toBe(false);
	});

	it('fails closed when MEMBER_SESSION_SECRET is unset, even for a well-formed hex token', () => {
		vi.stubEnv('MEMBER_SESSION_SECRET', '');
		const fakeToken = 'a'.repeat(64);
		expect(verifyMemberToken(WG_ID, MEMBER_ID, fakeToken)).toBe(false);
	});
});
