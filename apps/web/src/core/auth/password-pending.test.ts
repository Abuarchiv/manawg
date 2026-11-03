import assert from 'node:assert/strict';
import { test } from 'node:test';
import { choosePasswordHref } from './password-pending';

const CHOOSE = '/auth/reset?choose=1';

test('an invitation that travels through the sign-in page is kept for after the password is chosen', () => {
	assert.equal(
		choosePasswordHref('/login?next=%2Finvite%2Fabc'),
		`${CHOOSE}&next=${encodeURIComponent('/login?next=%2Finvite%2Fabc')}`,
	);
});

test('the create action on the sign-in page is kept', () => {
	assert.equal(
		choosePasswordHref('/login?action=create'),
		`${CHOOSE}&next=${encodeURIComponent('/login?action=create')}`,
	);
});

test('a sign-in page without intent, or with an unsafe or looping target, gives the bare page', () => {
	for (const next of ['/login', '/login?next=%2Flogin', '/login?next=%2F%2Fevil.com', '/', null]) {
		assert.equal(choosePasswordHref(next), CHOOSE);
	}
});

test('an ordinary page is carried along as the page to continue to', () => {
	assert.equal(choosePasswordHref('/invite/x'), `${CHOOSE}&next=%2Finvite%2Fx`);
});
