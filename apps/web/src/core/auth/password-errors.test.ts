import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyAuthError } from './password-errors';

test('classifies Supabase auth errors for German messages', () => {
	assert.equal(classifyAuthError({ code: 'invalid_credentials', status: 400 }), 'credentials');
	assert.equal(classifyAuthError({ code: 'email_not_confirmed', status: 400 }), 'unconfirmed');
	assert.equal(classifyAuthError({ status: 429 }), 'rate-limit');
	assert.equal(classifyAuthError({ code: 'over_email_send_rate_limit' }), 'rate-limit');
	assert.equal(classifyAuthError({ name: 'AuthRetryableFetchError' }), 'network');
	assert.equal(classifyAuthError(new Error('x')), 'other');
});
