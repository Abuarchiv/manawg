import assert from 'node:assert/strict';
import test from 'node:test';
import { withEnv } from '../../../tests/support/env';
import { loadConfirmedEmails } from './auth-user-emails';

const UID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const SUPABASE_ENV = (url: string, key: string) => ({
	NEXT_PUBLIC_SUPABASE_URL: url,
	SUPABASE_SERVICE_ROLE_KEY: key,
});

test('missing service-role configuration throws instead of reporting nobody has an address', async () => {
	await withEnv(SUPABASE_ENV('', ''), async () => {
		await assert.rejects(loadConfirmedEmails([UID(1)]), /service-role configuration/);
		const none = await loadConfirmedEmails([]);
		assert.equal(none.emails.size + none.unresolved.size, 0);
	});
});

test('an Auth outage is unresolved, a missing or unconfirmed user is plainly absent', async () => {
	await withEnv(SUPABASE_ENV('https://auth.example.test', 'service-key'), async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: string | URL | Request) => {
			const url = String(input);
			if (url.endsWith(UID(1)))
				return Response.json({
					id: UID(1),
					email: 'a@example.org',
					email_confirmed_at: '2026-01-01',
					user_metadata: { locale: 'en' },
				});
			if (url.endsWith(UID(2)))
				return Response.json({ id: UID(2), email: 'b@example.org', email_confirmed_at: null });
			if (url.endsWith(UID(3)))
				return Response.json({ message: 'User not found' }, { status: 404 });
			return Response.json({ message: 'down' }, { status: 503 });
		}) as typeof fetch;
		let result: Awaited<ReturnType<typeof loadConfirmedEmails>>;
		try {
			result = await loadConfirmedEmails([UID(1), UID(2), UID(3), UID(4)]);
		} finally {
			globalThis.fetch = originalFetch;
		}
		assert.deepEqual([...result.emails], [[UID(1), 'a@example.org']]);
		assert.deepEqual([...result.locales], [[UID(1), 'en']]);
		assert.deepEqual([...result.unresolved], [UID(4)]);
	});
});
