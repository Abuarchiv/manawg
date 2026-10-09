import assert from 'node:assert/strict';
import test from 'node:test';
import { authIntentQuery, authPageHref } from '@/core/auth/auth-intent';

test('keeps a valid share code and drops everything else', () => {
	assert.equal(authIntentQuery('code=mte8pzat&utm=1&token=secret'), 'code=MTE8PZAT');
});

test('keeps the create action and a safe return path', () => {
	assert.equal(
		authIntentQuery('action=create&next=%2Fwg%2FMTE8PZAT%2Feinkauf'),
		'action=create&next=%2Fwg%2FMTE8PZAT%2Feinkauf',
	);
});

test('a share code wins over the create action', () => {
	assert.equal(authIntentQuery('action=create&code=MTE8PZAT'), 'code=MTE8PZAT');
});

test('rejects invalid codes, foreign targets and the auth pages themselves', () => {
	assert.equal(authIntentQuery('code=abc'), '');
	assert.equal(authIntentQuery('next=https%3A%2F%2Fevil.com'), '');
	assert.equal(authIntentQuery('next=%2F%2Fevil.com'), '');
	assert.equal(authIntentQuery('next=%2Fneu%3Faction%3Dcreate'), '');
	assert.equal(authIntentQuery('next=%2Fregistrieren'), '');
	assert.equal(authIntentQuery('next=%2Fauth%2Freset'), '');
});

test('builds page links with and without intent', () => {
	assert.equal(authPageHref('/registrieren', ''), '/registrieren');
	assert.equal(authPageHref('/neu', 'code=MTE8PZAT'), '/neu?code=MTE8PZAT');
	assert.equal(authPageHref('/registrieren', 'action=create'), '/registrieren?action=create');
});
