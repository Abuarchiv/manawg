import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { withEnv } from './support/env';

// The per-route tests replace `requireCronSecret` with a stub, and cron-auth.test.ts only covers
// the guard itself. This is the only place that proves each route actually calls it first, with
// the real guard and without any database or provider reachable.
const ROUTES = [
	'chore-reminders',
	'event-reminders',
	'maintenance',
	'monthly-statements',
	'recurring-advance',
] as const;

for (const name of ROUTES) {
	test(`${name} refuses a caller without the cron secret before doing any work`, async () => {
		const { GET } = (await import(`../src/app/api/cron/${name}/route.ts`)) as {
			GET: (req: NextRequest) => Promise<Response>;
		};
		const url = `http://localhost/api/cron/${name}`;
		await withEnv(
			{ CRON_SECRET: 's3cret-value', POSTGRES_URL: 'postgres://127.0.0.1:1/none' },
			async () => {
				assert.equal((await GET(new NextRequest(url))).status, 401);
				const wrong = new NextRequest(url, { headers: { authorization: 'Bearer nope' } });
				assert.equal((await GET(wrong)).status, 401);
			},
		);
		await withEnv(
			{ CRON_SECRET: undefined, POSTGRES_URL: 'postgres://127.0.0.1:1/none' },
			async () => {
				assert.equal((await GET(new NextRequest(url))).status, 503);
			},
		);
	});
}
