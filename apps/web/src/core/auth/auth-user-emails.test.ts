import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfirmedEmails } from './auth-user-emails';

const UID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

function withEnv(url: string, key: string, run: () => Promise<void>): Promise<void> {
	const saved = [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY];
	const originalFetch = globalThis.fetch;
	process.env.NEXT_PUBLIC_SUPABASE_URL = url;
	process.env.SUPABASE_SERVICE_ROLE_KEY = key;
	return run().finally(() => {
		globalThis.fetch = originalFetch;
		for (const [index, name] of [
			'NEXT_PUBLIC_SUPABASE_URL',
			'SUPABASE_SERVICE_ROLE_KEY',
		].entries()) {
			const value = saved[index];
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	});
}

test('missing service-role configuration throws instead of reporting nobody has an address', async () => {
	await withEnv('', '', async () => {
		await assert.rejects(loadConfirmedEmails([UID(1)]), /service-role configuration/);
		const none = await loadConfirmedEmails([]);
		assert.equal(none.emails.size + none.unresolved.size, 0);
	});
});

test('an Auth outage is unresolved, a missing or unconfirmed user is plainly absent', async () => {
	await withEnv('https://auth.example.test', 'service-key', async () => {
		globalThis.fetch = (async (input: string | URL | Request) => {
			const url = String(input);
			if (url.endsWith(UID(1)))
				return Response.json({
					id: UID(1),
					email: 'a@example.org',
					email_confirmed_at: '2026-01-01',
				});
			if (url.endsWith(UID(2)))
				return Response.json({ id: UID(2), email: 'b@example.org', email_confirmed_at: null });
			if (url.endsWith(UID(3)))
				return Response.json({ message: 'User not found' }, { status: 404 });
			return Response.json({ message: 'down' }, { status: 503 });
		}) as typeof fetch;
		const result = await loadConfirmedEmails([UID(1), UID(2), UID(3), UID(4)]);
		assert.deepEqual([...result.emails], [[UID(1), 'a@example.org']]);
		assert.deepEqual([...result.unresolved], [UID(4)]);
	});
});
