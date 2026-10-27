import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, test } from 'node:test';
import { isWeakPasswordError } from './password-errors';
import { assertPasswordNotPwned, isPwnedPassword } from './pwned-password';

const realFetch = globalThis.fetch;
const requested: string[] = [];

function serve(body: string | Error, status = 200): void {
	globalThis.fetch = (async (input: string | URL) => {
		requested.push(String(input));
		if (body instanceof Error) throw body;
		return new Response(body, { status });
	}) as typeof fetch;
}

function suffixOf(password: string): string {
	return createHash('sha1').update(password).digest('hex').toUpperCase().slice(5);
}

afterEach(() => {
	globalThis.fetch = realFetch;
	requested.length = 0;
});

test('only the five-character hash prefix leaves the server', async () => {
	serve('');
	await isPwnedPassword('password');
	// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
	assert.deepEqual(requested, ['https://api.pwnedpasswords.com/range/5BAA6']);
});

test('a breached password is rejected with the weak-password error clients already map', async () => {
	serve(`0000000000000000000000000000000000A:0\r\n${suffixOf('password')}:10434004\r\n`);
	assert.equal(await isPwnedPassword('password'), true);
	await assert.rejects(assertPasswordNotPwned('password'), (error) => isWeakPasswordError(error));
});

test('padding entries and other suffixes do not count', async () => {
	serve(
		`${suffixOf('correct horse battery staple 42')}:0\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:3\r\n`,
	);
	assert.equal(await isPwnedPassword('correct horse battery staple 42'), false);
});

test('an unreachable or failing service never blocks the account', async () => {
	serve(new TypeError('fetch failed'));
	assert.equal(await isPwnedPassword('password'), false);
	serve('', 503);
	await assertPasswordNotPwned('password');
});
