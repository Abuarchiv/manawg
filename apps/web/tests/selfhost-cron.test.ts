import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cronMatches } from '../scripts/selfhost/cron.mjs';

const at = (iso: string) => new Date(iso);

test('cron expressions match their minutes in UTC', () => {
	assert.equal(cronMatches('0 8 * * *', at('2026-10-28T08:00:00Z')), true);
	assert.equal(cronMatches('0 8 * * *', at('2026-10-28T08:01:00Z')), false);
	assert.equal(cronMatches('10 6 * * *', at('2026-10-28T06:10:30Z')), true);
	assert.equal(cronMatches('0 7 1-5 * *', at('2026-11-05T07:00:00Z')), true);
	assert.equal(cronMatches('0 7 1-5 * *', at('2026-11-06T07:00:00Z')), false);
	assert.equal(cronMatches('*/15 * * * *', at('2026-11-06T13:45:00Z')), true);
	assert.equal(
		cronMatches('0 0 1 * 1', at('2026-11-02T00:00:00Z')),
		true,
		'Monday, day field restricted too',
	);
	assert.throws(() => cronMatches('0 25 * * *', new Date()), /Invalid cron field/);
});

test('every schedule in vercel.json parses', () => {
	const { crons } = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
	assert.ok(crons.length > 0);
	for (const { schedule } of crons) cronMatches(schedule, new Date());
});
