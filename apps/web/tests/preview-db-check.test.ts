// The Preview CI database wrapper: session transport rewrite and secret-free failure output.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

describe('preview ci database', () => {
	const SOURCE =
		'postgresql://manawg_preview_ci:synthetic%40pass%3A%25@db.sthiwjebcwwiphashgla.supabase.co:5432/postgres?sslmode=verify-full';

	test('Preview CI changes only its transport and preserves encoded credentials and verified TLS', async () => {
		const { previewSessionDatabaseUrl } = await import(
			pathToFileURL(path.resolve(import.meta.dirname, '../scripts/db-migrate.mjs')).href
		);
		const source = new URL(SOURCE);
		const result = new URL(previewSessionDatabaseUrl(SOURCE));
		assert.equal(result.hostname, 'aws-0-eu-central-1.pooler.supabase.com');
		assert.equal(result.port, '5432');
		assert.equal(result.username, 'manawg_preview_ci.sthiwjebcwwiphashgla');
		assert.equal(result.password, source.password);
		assert.equal(result.pathname, '/postgres');
		assert.equal(result.search, '?sslmode=verify-full');
	});

	test('Preview CI rejects other projects, roles, transports and driver URL overrides', async () => {
		const { previewSessionDatabaseUrl } = await import(
			pathToFileURL(path.resolve(import.meta.dirname, '../scripts/db-migrate.mjs')).href
		);
		const invalid = [
			'not-a-url',
			SOURCE.replace('postgresql:', 'https:'),
			SOURCE.replace('sthiwjebcwwiphashgla', 'bwsvsvfgbrsonepffqff'),
			SOURCE.replace('manawg_preview_ci:', 'postgres:'),
			SOURCE.replace('synthetic%40pass%3A%25', ''),
			SOURCE.replace(':5432/', ':6543/'),
			SOURCE.replace('/postgres?', '/other?'),
			SOURCE.replace('verify-full', 'require'),
			`${SOURCE}#fragment`,
			...['host', 'hostaddr', 'port', 'user', 'password', 'options', 'sslrootcert', 'sslmode'].map(
				(key) => `${SOURCE}&${key}=override`,
			),
		];
		for (const value of invalid) assert.throws(() => previewSessionDatabaseUrl(value));
	});

	test('Preview wrapper fails closed without exposing child credentials or error streams', () => {
		const secret = 'SYNTHETIC_CREDENTIAL_MUST_NOT_APPEAR';
		const child = spawnSync(
			process.execPath,
			[path.resolve(import.meta.dirname, '../scripts/preview-db-check.mjs')],
			{
				encoding: 'utf8',
				env: {
					...process.env,
					DATABASE_MIGRATION_URL: `postgresql://postgres:${secret}@db.bwsvsvfgbrsonepffqff.supabase.co:5432/postgres?sslmode=verify-full`,
				},
				timeout: 10_000,
			},
		);
		assert.equal(child.error, undefined);
		assert.equal(child.status, 1);
		assert.equal(child.stdout, '');
		assert.equal(
			child.stderr.trim(),
			'[preview-db] migration failed (class=configuration, code=unknown, stage=connection-config, reason=unclassified, ledger=none, exit=1, signal=none).',
		);
		assert.ok(!child.stderr.includes(secret));
	});

	test('the ordinary migration entrypoint still rejects session endpoints before connecting', async () => {
		const { previewSessionDatabaseUrl } = await import(
			pathToFileURL(path.resolve(import.meta.dirname, '../scripts/db-migrate.mjs')).href
		);
		const child = spawnSync(
			process.execPath,
			[path.resolve(import.meta.dirname, '../scripts/db-migrate.mjs'), '--check'],
			{
				encoding: 'utf8',
				env: {
					...process.env,
					DATABASE_MIGRATION_URL: previewSessionDatabaseUrl(SOURCE),
					MANAWG_PREVIEW_CI_SESSION: '',
				},
				timeout: 10_000,
			},
		);
		assert.equal(child.error, undefined);
		assert.equal(child.status, 1);
		assert.ok(
			child.stderr.includes('must be a direct Supabase PostgreSQL connection on port 5432'),
		);
	});

	test('wrapper never forwards secret-bearing child output, including success and process errors', () => {
		const file = path.resolve(import.meta.dirname, '../scripts/preview-db-check.mjs');
		const secret = 'SYNTHETIC_CHILD_SECRET';
		for (const outcome of [
			{ status: 0, signal: null, error: undefined },
			{ status: 1, signal: null, error: undefined },
			{ status: null, signal: 'SIGTERM', error: undefined },
			{ status: null, signal: null, error: secret },
		]) {
			// The wrapper runs as its own process; a preload swaps in a migration child that reports
			// this outcome and prints the secret on both streams.
			const preload = `
				import childProcess from 'node:child_process';
				import { syncBuiltinESMExports } from 'node:module';
				const outcome = ${JSON.stringify(outcome)};
				const secret = ${JSON.stringify(secret)};
				childProcess.spawnSync = () => ({
					...outcome,
					error: outcome.error ? new Error(outcome.error) : undefined,
					stdout: secret,
					stderr: secret,
				});
				syncBuiltinESMExports();
			`;
			const wrapper = spawnSync(
				process.execPath,
				['--import', `data:text/javascript,${encodeURIComponent(preload)}`, file],
				{ encoding: 'utf8', env: { NODE_ENV: 'test' }, timeout: 10_000 },
			);
			const output = `${wrapper.stdout}${wrapper.stderr}`;
			assert.equal(wrapper.error, undefined);
			assert.ok(!output.includes(secret));
			assert.equal(output.trimEnd().split('\n').length, 1);
			assert.equal(wrapper.status, outcome.status === 0 ? 0 : 1);
		}
	});
});
