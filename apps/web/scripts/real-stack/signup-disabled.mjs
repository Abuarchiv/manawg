// Registration on an instance without signups (Auth started with GOTRUE_DISABLE_SIGNUP=true):
// a new and an existing address get the same answer, so the endpoint does not reveal which
// addresses have an account, and no account is created. Run it instead of signup-flows.mjs, which
// needs signups on.
import { request } from '@playwright/test';
import { BASE, expect, finish, SB, SERVICE, sql } from './modules-lib.mjs';

const stamp = Date.now();
const address = (tag) => `${tag}${stamp}@example.test`;
const known = address('bekannt');
const created = await fetch(`${SB}/auth/v1/admin/users`, {
	method: 'POST',
	headers: {
		apikey: SERVICE,
		authorization: `Bearer ${SERVICE}`,
		'content-type': 'application/json',
	},
	body: JSON.stringify({ email: known, email_confirm: true }),
});
expect(created.ok, 'an account can still be created by the admin API', String(created.status));

const api = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { origin: BASE } });
const unknown = address('neu');
const forNew = await api.post('/api/auth/code-request', { data: { email: unknown, name: 'Neu' } });
const forKnown = await api.post('/api/auth/code-request', { data: { email: known, name: 'Alt' } });
expect(
	forNew.status() === forKnown.status() &&
		JSON.stringify(await forNew.json()) === JSON.stringify(await forKnown.json()),
	'a new and an existing address are answered alike',
	`${forNew.status()} ${forKnown.status()}`,
);
expect(forNew.ok(), 'the answer is a success', String(forNew.status()));
expect(
	sql(`select count(*) from auth.users where email='${unknown}'`) === '0',
	'no account is created',
);
finish();
