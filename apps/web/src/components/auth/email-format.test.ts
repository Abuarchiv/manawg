import assert from 'node:assert/strict';
import test from 'node:test';
import { regexes } from 'zod/v4/core';
import { emailField } from '@/core/auth/route-schemas';
import { EMAIL_PATTERN, isValidEmail } from './email-format';

const REJECTED = [
	'anna@gmail.c',
	'anna..x@gmail.com',
	'anna.@gmail.com',
	'anna@gmail..com',
	'anna@',
	'@gmail.com',
	'anna gmail.com',
	`${'a'.repeat(245)}@gmail.com`,
];
const ACCEPTED = ['anna@gmail.com', 'a.b+wg@example.co.uk', '  Anna@Gmail.com  ', "o'neil@x.de"];

test('the form rejects every address the auth routes reject', () => {
	for (const address of REJECTED) {
		assert.equal(emailField.safeParse(address).success, false, `server accepts ${address}`);
		assert.equal(isValidEmail(address), false, address);
	}
});

test('the form accepts normal addresses the auth routes accept', () => {
	for (const address of ACCEPTED) {
		assert.equal(emailField.safeParse(address).success, true, `server rejects ${address}`);
		assert.equal(isValidEmail(address), true, address);
	}
});

test('the copied pattern is the one zod checks with', () => {
	assert.equal(EMAIL_PATTERN.source, regexes.email.source);
});
