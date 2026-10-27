import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthApiError } from '@supabase/supabase-js';
import {
	type Captured,
	call,
	installAuthRouteMocks,
	kit,
} from '../../../../../tests/support/auth-route-kit';

installAuthRouteMocks();
const { POST } = await import('./route');

test('creates the account with the name as metadata and the callback on this origin', async () => {
	let received = {} as Captured;
	kit.auth.signUp = async (args) => {
		received = args;
		return { data: { session: null }, error: null };
	};
	const res = await call(POST, '/api/auth/sign-up', {
		email: 'Neu@Example.test',
		password: 'langes-passwort',
		name: ' Mina ',
		next: '/wg/ABCD2345',
	});
	assert.deepEqual(res.json, { sessionEstablished: false });
	assert.equal(received.email, 'neu@example.test');
	assert.deepEqual(received.options.data, { full_name: 'Mina' });
	assert.equal(
		received.options.emailRedirectTo,
		'https://app.example.test/auth/callback?next=%2Fwg%2FABCD2345',
	);
});

test('an external next target falls back to the start page', async () => {
	let redirect = '';
	kit.auth.signUp = async (args) => {
		redirect = args.options.emailRedirectTo;
		return { data: { session: { access_token: 't' } }, error: null };
	};
	const res = await call(POST, '/api/auth/sign-up', {
		email: 'a@b.test',
		password: 'langes-passwort',
		name: 'Mina',
		next: '//evil.test',
	});
	assert.deepEqual(res.json, { sessionEstablished: true });
	assert.equal(redirect, 'https://app.example.test/auth/callback?next=%2F');
});

test('passes weak_password through and requires a name', async () => {
	kit.auth.signUp = async () => ({
		data: { session: null },
		error: new AuthApiError('weak', 422, 'weak_password'),
	});
	const weak = await call(POST, '/api/auth/sign-up', {
		email: 'a@b.test',
		password: 'x',
		name: 'M',
	});
	assert.equal(weak.status, 422);
	assert.equal(weak.json.code, 'weak_password');
	const nameless = await call(POST, '/api/auth/sign-up', { email: 'a@b.test', password: 'x' });
	assert.equal(nameless.status, 400);
});

test('rejects a breached password as weak_password without creating the account', async () => {
	kit.auth.signUp = async () => assert.fail('must not run');
	kit.pwnedPasswords.add('passwort123');
	const res = await call(POST, '/api/auth/sign-up', {
		email: 'neu@example.test',
		password: 'passwort123',
		name: 'Mina',
	});
	assert.equal(res.status, 422);
	assert.equal(res.json.code, 'weak_password');
});
