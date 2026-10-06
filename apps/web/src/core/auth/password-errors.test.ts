import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthWeakPasswordError } from '@supabase/supabase-js';
import { WEAK_PASSWORD_MESSAGE, classifyAuthError, isWeakPasswordError } from './password-errors';

test('classifies Supabase auth errors for German messages', () => {
	assert.equal(classifyAuthError({ code: 'invalid_credentials', status: 400 }), 'credentials');
	assert.equal(classifyAuthError({ code: 'email_not_confirmed', status: 400 }), 'unconfirmed');
	assert.equal(classifyAuthError({ status: 429 }), 'rate-limit');
	assert.equal(classifyAuthError({ code: 'over_email_send_rate_limit' }), 'rate-limit');
	assert.equal(classifyAuthError({ name: 'AuthRetryableFetchError' }), 'network');
	assert.equal(classifyAuthError(new Error('x')), 'other');
});

test('only rejected weak passwords get actionable feedback', () => {
	assert.equal(
		isWeakPasswordError(new AuthWeakPasswordError('Password is weak', 422, ['pwned'])),
		true,
	);
	assert.equal(isWeakPasswordError({ code: 'invalid_credentials' }), false);
	assert.equal(isWeakPasswordError({ weakPassword: { reasons: ['pwned'] } }), false);
	assert.match(WEAK_PASSWORD_MESSAGE, /wähle.*anderes/i);
});
