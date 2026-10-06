// Database lane: connection settings, migration ledger integrity and live transaction checks.
// Live parts skip unless isolated database credentials are provided; they are the only hosted DB evidence.

import { spawnSync } from 'node:child_process';
import { X509Certificate, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { resolveConnectionString } from '../src/core/db/connection';

test.describe('db connection', () => {
	const keys = [
		'DATABASE_MIGRATION_URL',
		'POSTGRES_URL_NON_POOLING',
		'DATABASE_URL_UNPOOLED',
		'POSTGRES_URL',
		'DATABASE_URL',
	] as const;

	for (const migrationUrl of [
		'placeholder',
		'postgresql://migrator:example@other.example.test:5432/app?sslmode=verify-full',
	]) {
		test(`application transactions ignore migration-only URL: ${migrationUrl === 'placeholder' ? 'invalid' : 'different database'}`, () => {
			const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
			try {
				for (const key of keys) delete process.env[key];
				const runtimeUrl = 'postgresql://app:example@db.example.test:5432/app?sslmode=verify-full';
				process.env.POSTGRES_URL = runtimeUrl;
				process.env.DATABASE_MIGRATION_URL = migrationUrl;
				expect(resolveConnectionString()).toBe(runtimeUrl);
			} finally {
				for (const key of keys) {
					if (previous[key] === undefined) delete process.env[key];
					else process.env[key] = previous[key];
				}
			}
		});
	}

	test('runtime aliases retain priority and ignore direct-connection variables', () => {
		const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
		try {
			for (const key of keys) delete process.env[key];
			expect(() => resolveConnectionString()).toThrow('POSTGRES_URL (or DATABASE_URL) is not set');
			process.env.DATABASE_URL =
				'postgresql://app:example@db.example.test:5432/fallback?sslmode=verify-full';
			expect(resolveConnectionString()).toBe(process.env.DATABASE_URL);
			process.env.POSTGRES_URL =
				'postgresql://app:example@db.example.test:5432/runtime?sslmode=verify-full';
			expect(resolveConnectionString()).toBe(process.env.POSTGRES_URL);
			process.env.DATABASE_URL_UNPOOLED =
				'postgresql://app:example@db.example.test:5432/unpooled?sslmode=verify-full';
			process.env.POSTGRES_URL_NON_POOLING = 'placeholder';
			expect(resolveConnectionString()).toBe(process.env.POSTGRES_URL);
			process.env.POSTGRES_URL = 'postgresql://app:example@db.example.test:5432/app';
			expect(new URL(resolveConnectionString()).searchParams.get('sslmode')).toBe('verify-full');
		} finally {
			for (const key of keys) {
				if (previous[key] === undefined) delete process.env[key];
				else process.env[key] = previous[key];
			}
		}
	});

	test('Supabase connections use the official CA without disabling verification', () => {
		const previous = process.env.POSTGRES_URL;
		try {
			process.env.POSTGRES_URL =
				'postgresql://example:example@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';
			const result = resolveConnectionString();
			const certPath = new URL(result).searchParams.get('sslrootcert');
			expect(certPath).toBeTruthy();
			if (!certPath) throw new Error('Missing Supabase root CA');
			const cert = new X509Certificate(readFileSync(certPath));
			expect(cert.fingerprint256).toBe(
				'80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA',
			);
			const ssl = Reflect.get(new Client({ connectionString: result }), 'connectionParameters').ssl;
			expect(ssl).not.toBe(false);
			expect(ssl.rejectUnauthorized).not.toBe(false);
			expect(ssl.ca).toBeTruthy();
			expect(new URL(resolveConnectionString()).searchParams.get('sslrootcert')).toBe(certPath);
		} finally {
			if (previous === undefined) Reflect.deleteProperty(process.env, 'POSTGRES_URL');
			else process.env.POSTGRES_URL = previous;
		}
	});

	test('remote runtime connections enforce certificate-verified TLS', () => {
		const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
		try {
			for (const key of keys) delete process.env[key];
			for (const mode of ['', 'disable', 'no-verify', 'require', 'verify-ca', 'verify-full']) {
				const url = new URL('postgresql://app:example@db.example.test:6543/app');
				if (mode) url.searchParams.set('sslmode', mode);
				url.searchParams.set('application_name', 'release-check');
				url.searchParams.set('ssl', 'false');
				url.searchParams.set('uselibpqcompat', 'true');
				url.searchParams.set('sslrootcert', '/private/certs/database-ca.pem');
				process.env.POSTGRES_URL = url.href;
				const result = new URL(resolveConnectionString());
				expect(result.searchParams.get('sslmode')).toBe('verify-full');
				expect(result.searchParams.get('application_name')).toBe('release-check');
				expect(result.searchParams.get('sslrootcert')).toBe('/private/certs/database-ca.pem');
				expect(result.hostname).toBe(url.hostname);
			}
			process.env.POSTGRES_URL = 'postgresql://app:example@localhost/app';
			expect(resolveConnectionString()).toBe(process.env.POSTGRES_URL);
			process.env.POSTGRES_URL = 'postgresql://app:example@[::1]/app';
			expect(resolveConnectionString()).toBe(process.env.POSTGRES_URL);
			process.env.POSTGRES_URL = 'https://db.example.test:5432/app';
			expect(() => resolveConnectionString()).toThrow('must be a PostgreSQL URL');
			process.env.POSTGRES_URL =
				'postgresql://app:example@localhost:5432/app?host=remote.example.test&sslmode=disable';
			expect(() => resolveConnectionString()).toThrow('must not override its host');
		} finally {
			for (const key of keys) {
				if (previous[key] === undefined) delete process.env[key];
				else process.env[key] = previous[key];
			}
		}
	});
});

test.describe('db migrate ledger', () => {
	test('migrations still reject transaction-pooler connections', async () => {
		const { validateDatabaseUrl } = await import(
			pathToFileURL(path.resolve(process.cwd(), 'scripts/db-migrate.mjs')).href
		);
		expect(() =>
			validateDatabaseUrl(
				'postgresql://example:example@db.example.test:6543/app?sslmode=verify-full',
				'migration',
			),
		).toThrow('must not use port 6543');
	});

	test('rejects unknown pre-baseline ledger rows fail-closed', async () => {
		const { assertMigrationLedgerPrefix } = await import(
			pathToFileURL(path.resolve(process.cwd(), 'scripts/db-migrate.mjs')).href
		);
		const arbitraryHash = 'ab'.repeat(32);
		const client = {
			query: async (sql: unknown) => {
				if (String(sql).includes('pg_catalog.pg_class')) return { rows: [{}] };
				if (String(sql).includes('__drizzle_migrations')) {
					return { rows: [{ id: 1, hash: arbitraryHash, created_at: '0' }] };
				}
				throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
			},
		};

		await expect(assertMigrationLedgerPrefix(client)).rejects.toThrow(
			`Database check failed: unexpected migration row 1 outside the canonical ledger (hash ${arbitraryHash}, created_at 0).`,
		);
	});

	test('accepts the reviewed historical hash at its canonical ledger position', async () => {
		const { assertMigrationLedgerPrefix } = await import(
			pathToFileURL(path.resolve(process.cwd(), 'scripts/db-migrate.mjs')).href
		);
		const migrationsDir = path.resolve(process.cwd(), 'drizzle');
		const journal = JSON.parse(
			readFileSync(path.join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
		);
		const rows = journal.entries.map((entry, index) => ({
			id: index + 1,
			hash:
				index === 7
					? '88916329fbe6f5e5f4e4174e5db393aa3d7c4516790c4dbf3d1a41301f335aa0'
					: index === 10
						? 'fb524f9b63dd0b63b84d8d1bf6d916781e7cc206682bf23bdd0106d9e9dbbb0e'
						: createHash('sha256')
								.update(readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), 'utf8'))
								.digest('hex'),
			created_at: String(entry.when),
		}));
		const client = {
			query: async (sql: unknown) => {
				if (String(sql).includes('pg_catalog.pg_class')) return { rows: [{}] };
				if (String(sql).includes('__drizzle_migrations')) return { rows };
				throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
			},
		};

		const ledger = await assertMigrationLedgerPrefix(client);
		expect(ledger.appliedCount).toBe(ledger.entries.length);
	});

	test('keeps a missing migration ledger as missing', async () => {
		const { assertMigrationLedgerPrefix } = await import(
			pathToFileURL(path.resolve(process.cwd(), 'scripts/db-migrate.mjs')).href
		);
		const client = {
			query: async (sql: unknown) => {
				if (String(sql).includes('pg_catalog.pg_class')) return { rows: [] };
				throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
			},
		};

		await expect(assertMigrationLedgerPrefix(client)).rejects.toThrow(
			'Database check failed: Drizzle migration ledger is missing.',
		);
	});

	test('propagates permission errors for an existing unreadable migration ledger', async () => {
		const { assertMigrationLedgerPrefix } = await import(
			pathToFileURL(path.resolve(process.cwd(), 'scripts/db-migrate.mjs')).href
		);
		const client = {
			query: async (sql: unknown) => {
				if (String(sql).includes('pg_catalog.pg_class')) return { rows: [{}] };
				if (String(sql).includes('__drizzle_migrations')) {
					throw new Error('permission denied for table drizzle.__drizzle_migrations');
				}
				throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
			},
		};

		await expect(assertMigrationLedgerPrefix(client)).rejects.toThrow(
			'permission denied for table drizzle.__drizzle_migrations',
		);
	});

	test('recognizes a complete canonical migration ledger without a fixed count', async () => {
		const { assertMigrationLedgerPrefix } = await import(
			pathToFileURL(path.resolve(process.cwd(), 'scripts/db-migrate.mjs')).href
		);
		const migrationsDir = path.resolve(process.cwd(), 'drizzle');
		const journal = JSON.parse(
			readFileSync(path.join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
		);
		const client = {
			query: async (sql: unknown) => {
				if (String(sql).includes('pg_catalog.pg_class')) return { rows: [{}] };
				if (String(sql).includes('__drizzle_migrations')) {
					return {
						rows: journal.entries.map((entry) => ({
							id: entry.idx + 1,
							hash: createHash('sha256')
								.update(readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), 'utf8'))
								.digest('hex'),
							created_at: String(entry.when),
						})),
					};
				}
				throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
			},
		};

		const ledger = await assertMigrationLedgerPrefix(client);
		expect(ledger.appliedCount).toBe(ledger.entries.length);
	});
});

test.describe('db transaction live', () => {
	test('Preview transactions use runtime credentials and roll back writes', async () => {
		const runtimeUrl = process.env.PREVIEW_TRANSACTION_TEST_URL;
		if (!runtimeUrl) {
			test.skip(true, 'Requires explicit isolated Preview database credentials.');
			return;
		}
		const project = process.env.PREVIEW_TRANSACTION_PROJECT_REF;
		expect(project).toMatch(/^[a-z]{20}$/);
		expect(new URL(runtimeUrl).hostname).toBe(`db.${project}.supabase.co`);
		const keys = [
			'POSTGRES_URL',
			'DATABASE_MIGRATION_URL',
			'POSTGRES_URL_NON_POOLING',
			'DATABASE_URL_UNPOOLED',
		] as const;
		const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
		try {
			process.env.POSTGRES_URL = runtimeUrl;
			process.env.DATABASE_MIGRATION_URL = 'placeholder';
			Reflect.deleteProperty(process.env, 'POSTGRES_URL_NON_POOLING');
			Reflect.deleteProperty(process.env, 'DATABASE_URL_UNPOOLED');
			const { withTransaction } = await import('../src/core/db/transaction');
			const { sql } = await import('drizzle-orm');
			const rollback = new Error('intentional release-check rollback');
			let backendPid: unknown;
			await expect(
				withTransaction(async (tx) => {
					await tx.execute(
						sql`create temporary table manawg_release_transaction_probe (id integer)`,
					);
					await tx.execute(sql`insert into manawg_release_transaction_probe values (1)`);
					const result = await tx.execute(
						sql`select count(*)::integer as count from manawg_release_transaction_probe`,
					);
					expect(result.rows[0]?.count).toBe(1);
					backendPid = (await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0]?.pid;
					throw rollback;
				}),
			).rejects.toBe(rollback);
			const result = await withTransaction((tx) =>
				tx.execute(
					sql`select pg_backend_pid() as pid, to_regclass('pg_temp.manawg_release_transaction_probe') is null as rolled_back`,
				),
			);
			expect(result.rows[0]?.rolled_back).toBe(true);
			expect(typeof backendPid).toBe('number');
			expect(result.rows[0]?.pid).toBe(backendPid);
		} finally {
			for (const key of keys) {
				if (previous[key] === undefined) delete process.env[key];
				else process.env[key] = previous[key];
			}
		}
	});
});

test.describe('preview ci database', () => {
	const SOURCE =
		'postgresql://manawg_preview_ci:synthetic%40pass%3A%25@db.sthiwjebcwwiphashgla.supabase.co:5432/postgres?sslmode=verify-full';

	test('Preview CI changes only its transport and preserves encoded credentials and verified TLS', async () => {
		const { previewSessionDatabaseUrl } = await import(
			pathToFileURL(path.resolve(__dirname, '../scripts/db-migrate.mjs')).href
		);
		const source = new URL(SOURCE);
		const result = new URL(previewSessionDatabaseUrl(SOURCE));
		expect(result.hostname).toBe('aws-0-eu-central-1.pooler.supabase.com');
		expect(result.port).toBe('5432');
		expect(result.username).toBe('manawg_preview_ci.sthiwjebcwwiphashgla');
		expect(result.password).toBe(source.password);
		expect(result.pathname).toBe('/postgres');
		expect(result.search).toBe('?sslmode=verify-full');
	});

	test('Preview CI rejects other projects, roles, transports and driver URL overrides', async () => {
		const { previewSessionDatabaseUrl } = await import(
			pathToFileURL(path.resolve(__dirname, '../scripts/db-migrate.mjs')).href
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
		for (const value of invalid) expect(() => previewSessionDatabaseUrl(value)).toThrow();
	});

	test('Preview wrapper fails closed without exposing child credentials or error streams', () => {
		const secret = 'SYNTHETIC_CREDENTIAL_MUST_NOT_APPEAR';
		const child = spawnSync(
			process.execPath,
			[path.resolve(__dirname, '../scripts/preview-db-check.mjs')],
			{
				encoding: 'utf8',
				env: {
					...process.env,
					DATABASE_MIGRATION_URL: `postgresql://postgres:${secret}@db.bwsvsvfgbrsonepffqff.supabase.co:5432/postgres?sslmode=verify-full`,
				},
				timeout: 10_000,
			},
		);
		expect(child.error).toBeUndefined();
		expect(child.status).toBe(1);
		expect(child.stdout).toBe('');
		expect(child.stderr.trim()).toBe(
			'[preview-db] migration failed (class=configuration, code=unknown, stage=connection-config, reason=unclassified, ledger=none, exit=1, signal=none).',
		);
		expect(child.stderr).not.toContain(secret);
	});

	test('the ordinary migration entrypoint still rejects session endpoints before connecting', async () => {
		const { previewSessionDatabaseUrl } = await import(
			pathToFileURL(path.resolve(__dirname, '../scripts/db-migrate.mjs')).href
		);
		const child = spawnSync(
			process.execPath,
			[path.resolve(__dirname, '../scripts/db-migrate.mjs'), '--check'],
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
		expect(child.error).toBeUndefined();
		expect(child.status).toBe(1);
		expect(child.stderr).toContain('must be a direct Supabase PostgreSQL connection on port 5432');
	});

	test('wrapper never forwards secret-bearing child output, including success and process errors', () => {
		const file = path.resolve(__dirname, '../scripts/preview-db-check.mjs');
		const source = readFileSync(file, 'utf8')
			.replace(/^import .*;\n/gm, '')
			.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(file).href));
		const secret = 'SYNTHETIC_CHILD_SECRET';
		for (const outcome of [
			{ status: 0, signal: null, error: undefined },
			{ status: 1, signal: null, error: undefined },
			{ status: null, signal: 'SIGTERM', error: undefined },
			{ status: null, signal: null, error: new Error(secret) },
		]) {
			const output: string[] = [];
			const childProcess = {
				argv: ['node', file],
				execPath: process.execPath,
				env: {},
				exitCode: 0,
				stdout: { write: (value: string) => output.push(value) },
			};
			runInNewContext(source, {
				URL,
				fileURLToPath,
				process: childProcess,
				console: { error: (value: string) => output.push(value) },
				spawnSync: () => ({ ...outcome, stdout: secret, stderr: secret }),
			});
			expect(output.join('')).not.toContain(secret);
			expect(output).toHaveLength(1);
			expect(childProcess.exitCode).toBe(outcome.status === 0 ? 0 : 1);
		}
	});
});
