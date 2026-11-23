import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

mock.module('@/core/infra/api-client', {
	namedExports: {
		anySignal: (signals: readonly AbortSignal[]) => AbortSignal.any([...signals]),
		apiFetch: async () => ({ ok: false, status: 422, error: 'weak_password' }),
		noteSessionExpiry: () => {},
		readApiErrorCode: async () => '',
		REQUEST_TIMEOUT_MS: 15_000,
	},
});

const { isNewPasswordTooShort, NEW_PASSWORD_MIN_LENGTH } = await import('./password-rules');
const { newPasswordFailure, WEAK_PASSWORD_MESSAGE } = await import('./password-errors');
const { updatePassword } = await import('./client');

test('new passwords are measured in code points, as GoTrue counts them', () => {
	assert.equal(NEW_PASSWORD_MIN_LENGTH, 8);
	// Four emoji are 8 UTF-16 units but only 4 characters for GoTrue.
	assert.equal(isNewPasswordTooShort('😀😀😀😀'), true);
	assert.equal(isNewPasswordTooShort('abcdef😀😀'), false);
	assert.equal(isNewPasswordTooShort('😀😀😀😀😀😀😀😀'), false);
	assert.equal(isNewPasswordTooShort('abcdefg'), true);
});

test('a weak_password answer from the server shows the weak-password message', async () => {
	const error = await updatePassword('😀😀😀😀😀😀😀😀').then(
		() => null,
		(caught: unknown) => caught,
	);
	assert.deepEqual(newPasswordFailure(error), WEAK_PASSWORD_MESSAGE);
	assert.deepEqual(newPasswordFailure({ code: 'same_password' }), { key: 'auth.reset.same' });
	assert.equal(newPasswordFailure({ code: 'unexpected_failure' }), null);
});
