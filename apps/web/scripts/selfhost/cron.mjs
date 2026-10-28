#!/usr/bin/env node
/**
 * Cron runner for self-hosted stacks: calls each route in the `crons` list of vercel.json on its
 * schedule (UTC, like Vercel) with `Authorization: Bearer $CRON_SECRET`. Runs missed while the
 * container was down are skipped, as on Vercel.
 *
 *   CRON_TARGET_URL=http://app:3000 CRON_SECRET=... node scripts/selfhost/cron.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const log = (line) => process.stdout.write(`${line}\n`);

const RANGES = [
	[0, 59],
	[0, 23],
	[1, 31],
	[1, 12],
	[0, 6],
];

/** The values one cron field allows: `*`, `5`, `1-5`, `1,15`, `*\/10`, `0-30/10`. */
function fieldValues(field, [min, max]) {
	const values = new Set();
	for (const part of field.split(',')) {
		const [range, stepText] = part.split('/');
		const step = stepText ? Number(stepText) : 1;
		const [from, to] =
			range === '*'
				? [min, max]
				: range.includes('-')
					? range.split('-').map(Number)
					: [Number(range), Number(range)];
		if (
			![from, to, step].every(Number.isInteger) ||
			step < 1 ||
			from < min ||
			to > max ||
			from > to
		) {
			throw new Error(`Invalid cron field "${field}".`);
		}
		for (let value = from; value <= to; value += step) values.add(value);
	}
	return values;
}

/** Whether a five-field cron expression fires at this minute (UTC). */
export function cronMatches(expression, date) {
	const fields = expression.trim().split(/\s+/);
	if (fields.length !== 5) throw new Error(`Invalid cron expression "${expression}".`);
	const [minute, hour, day, month, weekday] = fields.map((field, i) =>
		fieldValues(field, RANGES[i]),
	);
	const dayMatches = day.has(date.getUTCDate());
	const weekdayMatches = weekday.has(date.getUTCDay());
	// Standard cron: with both day fields restricted, either one may match.
	const dayOk =
		fields[2] !== '*' && fields[4] !== '*'
			? dayMatches || weekdayMatches
			: dayMatches && weekdayMatches;
	return (
		minute.has(date.getUTCMinutes()) &&
		hour.has(date.getUTCHours()) &&
		month.has(date.getUTCMonth() + 1) &&
		dayOk
	);
}

async function call(target, secret, route) {
	try {
		const response = await fetch(`${target}${route}`, {
			headers: { Authorization: `Bearer ${secret}` },
			signal: AbortSignal.timeout(300_000),
		});
		log(`[cron] ${route} -> ${response.status}`);
	} catch (error) {
		console.error(`[cron] ${route} failed: ${error instanceof Error ? error.message : error}`);
	}
}

function run() {
	const target = process.env.CRON_TARGET_URL?.trim().replace(/\/$/, '');
	const secret = process.env.CRON_SECRET?.trim();
	if (!target || !secret) {
		console.error('[cron] CRON_TARGET_URL and CRON_SECRET are required.');
		process.exit(1);
	}
	const configPath = path.join(
		path.dirname(fileURLToPath(import.meta.url)),
		'..',
		'..',
		'vercel.json',
	);
	const crons = JSON.parse(readFileSync(configPath, 'utf8')).crons ?? [];
	for (const { schedule } of crons) cronMatches(schedule, new Date());
	log(`[cron] ${crons.length} jobs: ${crons.map((c) => `${c.path} (${c.schedule})`).join(', ')}`);

	const tick = () => {
		const now = new Date();
		for (const { path: route, schedule } of crons) {
			if (cronMatches(schedule, now)) void call(target, secret, route);
		}
		setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
	};
	setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
