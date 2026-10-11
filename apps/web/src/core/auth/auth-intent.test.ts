import assert from 'node:assert/strict';
import test from 'node:test';
import { authIntentQuery, authPageHref } from '@/core/auth/auth-intent';

test('drops an old share code and everything unknown; an invitation travels as next', () => {
	assert.equal(authIntentQuery('code=mte8pzat&utm=1&token=secret'), '');
	assert.equal(authIntentQuery('next=%2Feinladung%2Fabc123&utm=1'), 'next=%2Feinladung%2Fabc123');
});

test('keeps the create action and a safe return path', () => {
	assert.equal(
		authIntentQuery('action=create&next=%2Fwg%2FMTE8PZAT%2Feinkauf'),
		'action=create&next=%2Fwg%2FMTE8PZAT%2Feinkauf',
	);
});

test('rejects invalid codes, foreign targets and the auth pages themselves', () => {
	assert.equal(authIntentQuery('next=https%3A%2F%2Fevil.com'), '');
	assert.equal(authIntentQuery('next=%2F%2Fevil.com'), '');
	assert.equal(authIntentQuery('next=%2Fneu%3Faction%3Dcreate'), '');
	assert.equal(authIntentQuery('next=%2Fregistrieren'), '');
	assert.equal(authIntentQuery('next=%2Fauth%2Freset'), '');
});

test('builds page links with and without intent', () => {
	assert.equal(authPageHref('/registrieren', ''), '/registrieren');
	assert.equal(
		authPageHref('/neu', 'next=%2Feinladung%2Fabc123'),
		'/neu?next=%2Feinladung%2Fabc123',
	);
	assert.equal(authPageHref('/registrieren', 'action=create'), '/registrieren?action=create');
});
