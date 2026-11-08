import assert from 'node:assert/strict';
import test from 'node:test';
import { authIntentQuery, authPageHref, unwrapSignInNext } from '@/core/auth/auth-intent';

test('drops an old share code and everything unknown; an invitation travels as next', () => {
	assert.equal(authIntentQuery('code=mte8pzat&utm=1&token=secret'), '');
	assert.equal(authIntentQuery('next=%2Finvite%2Fabc123&utm=1'), 'next=%2Finvite%2Fabc123');
});

test('keeps the create action and a safe return path', () => {
	assert.equal(
		authIntentQuery('action=create&next=%2Fwg%2FMTE8PZAT%2Fshopping'),
		'action=create&next=%2Fwg%2FMTE8PZAT%2Fshopping',
	);
});

test('rejects invalid codes, foreign targets and the auth pages themselves', () => {
	assert.equal(authIntentQuery('next=https%3A%2F%2Fevil.com'), '');
	assert.equal(authIntentQuery('next=%2F%2Fevil.com'), '');
	assert.equal(authIntentQuery('next=%2Flogin%3Faction%3Dcreate'), '');
	assert.equal(authIntentQuery('next=%2Fsignup'), '');
	assert.equal(authIntentQuery('next=%2Fauth%2Freset'), '');
});

test('builds page links with and without intent', () => {
	assert.equal(authPageHref('/signup', ''), '/signup');
	assert.equal(authPageHref('/login', 'next=%2Finvite%2Fabc123'), '/login?next=%2Finvite%2Fabc123');
	assert.equal(authPageHref('/signup', 'action=create'), '/signup?action=create');
});

test('looks through the sign-in page to the invitation behind it', () => {
	assert.equal(unwrapSignInNext('/login?next=%2Finvite%2Fabc123'), '/invite/abc123');
	assert.equal(unwrapSignInNext('/signup?next=%2Fwg%2FMTE8PZAT'), '/wg/MTE8PZAT');
	assert.equal(unwrapSignInNext('/invite/abc123'), '/invite/abc123');
	assert.equal(unwrapSignInNext('/login'), '/login');
	assert.equal(unwrapSignInNext('/login?action=create'), '/login?action=create');
	assert.equal(unwrapSignInNext('/login?next=%2Flogin'), '/login?next=%2Flogin');
	assert.equal(
		unwrapSignInNext('/login?next=https%3A%2F%2Fevil.com'),
		'/login?next=https%3A%2F%2Fevil.com',
	);
});
