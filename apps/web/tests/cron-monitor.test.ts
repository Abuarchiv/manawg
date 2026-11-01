import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mock, test } from 'node:test';

type CheckIn = { monitorSlug: string; status: string; checkInId?: string };
const checkIns: CheckIn[] = [];
let flushed = 0;

mock.module('@sentry/nextjs', {
	namedExports: {
		captureCheckIn: (checkIn: CheckIn) => {
			checkIns.push(checkIn);
			return 'check-in-1';
		},
		flush: async () => {
			flushed++;
			return true;
		},
	},
});

const { monitorCron } = await import('../src/core/infra/sentry.ts');

function run(response: () => Promise<Response>) {
	checkIns.length = 0;
	flushed = 0;
	return monitorCron('job', '10 6 * * *', response);
}

test('a 2xx run checks in ok, anything else as error, and both are flushed', async () => {
	await run(async () => new Response(null, { status: 200 }));
	assert.deepEqual(
		checkIns.map((c) => c.status),
		['in_progress', 'ok'],
	);
	assert.equal(checkIns[1]?.checkInId, 'check-in-1');
	assert.equal(flushed, 1);

	await run(async () => new Response(null, { status: 503 }));
	assert.deepEqual(
		checkIns.map((c) => c.status),
		['in_progress', 'error'],
	);
});

test('a thrown run checks in as error and still throws', async () => {
	await assert.rejects(
		run(async () => {
			throw new Error('boom');
		}),
		/boom/,
	);
	assert.equal(checkIns.at(-1)?.status, 'error');
	assert.equal(flushed, 1);
});

test('the monitored schedule matches the Vercel cron', async () => {
	const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
		crons: { path: string; schedule: string }[];
	};
	const route = readFileSync(
		new URL('../src/app/api/cron/recurring-advance/route.ts', import.meta.url),
		'utf8',
	);
	const schedule = route.match(/RECURRING_ADVANCE_SCHEDULE = '([^']+)'/)?.[1];
	assert.equal(
		schedule,
		vercel.crons.find((c) => c.path === '/api/cron/recurring-advance')?.schedule,
	);
});
