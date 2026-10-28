import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { withEnv } from '../../../tests/support/env';
import { supabaseFetch } from './supabase-fetch';

async function fetchedUrl(input: string, env: Record<string, string | undefined>) {
	const original = globalThis.fetch;
	let seen = '';
	globalThis.fetch = (async (target: RequestInfo | URL) => {
		seen = typeof target === 'string' ? target : target instanceof URL ? target.href : target.url;
		return new Response(null);
	}) as typeof fetch;
	try {
		await withEnv(env, () => supabaseFetch(input));
	} finally {
		globalThis.fetch = original;
	}
	return seen;
}

test('server requests to the public Supabase origin go to the internal URL', async () => {
	const env = {
		NEXT_PUBLIC_SUPABASE_URL: 'https://wg.example.com',
		SUPABASE_INTERNAL_URL: 'http://gateway:8000/',
	};
	assert.equal(
		await fetchedUrl('https://wg.example.com/auth/v1/user?x=1', env),
		'http://gateway:8000/auth/v1/user?x=1',
	);
	assert.equal(
		await fetchedUrl('https://wg.example.com.evil.test/auth/v1/user', env),
		'https://wg.example.com.evil.test/auth/v1/user',
	);
	assert.equal(
		await fetchedUrl('https://api.resend.com/emails', env),
		'https://api.resend.com/emails',
	);
});

test('without an internal URL requests stay untouched', async () => {
	assert.equal(
		await fetchedUrl('https://project.supabase.co/auth/v1/user', {
			NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
			SUPABASE_INTERNAL_URL: undefined,
		}),
		'https://project.supabase.co/auth/v1/user',
	);
});

test('every Supabase client in the app routes its requests through supabaseFetch', () => {
	const src = fileURLToPath(new URL('../../', import.meta.url));
	const creating = readdirSync(src, { recursive: true, encoding: 'utf8' })
		.filter((file) => /\.tsx?$/.test(file) && !file.includes('.test.'))
		.filter((file) =>
			/\bcreate(?:Server|Browser)?Client\(/.test(readFileSync(path.join(src, file), 'utf8')),
		);

	assert.ok(creating.length > 0);
	for (const file of creating) {
		assert.match(readFileSync(path.join(src, file), 'utf8'), /\bsupabaseFetch\b/, file);
	}
});
