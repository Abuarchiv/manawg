import { expect, test } from '@playwright/test';
import { deriveMemberToken, verifyMemberToken } from '../src/core/guards/member-token';

test('member token verification rejects trailing non-hex data', () => {
	const previousSecret = process.env.MEMBER_SESSION_SECRET;
	process.env.MEMBER_SESSION_SECRET = 'auth-regression-secret';

	try {
		const token = deriveMemberToken(
			'989ac820-58b7-431f-9c65-28721264f333',
			'7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
		);
		expect(token).toBeTruthy();
		expect(
			verifyMemberToken(
				'989ac820-58b7-431f-9c65-28721264f333',
				'7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
				token,
			),
		).toBe(true);
		expect(
			verifyMemberToken(
				'989ac820-58b7-431f-9c65-28721264f333',
				'7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
				`${token}g`,
			),
		).toBe(false);
	} finally {
		if (previousSecret === undefined) Reflect.deleteProperty(process.env, 'MEMBER_SESSION_SECRET');
		else process.env.MEMBER_SESSION_SECRET = previousSecret;
	}
});
