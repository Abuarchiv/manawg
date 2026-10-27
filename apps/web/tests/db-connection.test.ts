import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Client } from 'pg';
import { resolveConnectionString } from '../src/core/db/connection.ts';

// Runtime connection settings and the live Preview transaction check.

const KEYS = [
	'DATABASE_MIGRATION_URL',
	'POSTGRES_URL_NON_POOLING',
	'DATABASE_URL_UNPOOLED',
	'POSTGRES_URL',
	'DATABASE_URL',
] as const;

/** Snapshots `keys` and returns a function that restores them. */
function snapshotEnv(keys: readonly string[]): () => void {
	const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
	return () => {
		for (const key of keys) {
			if (previous[key] === undefined) delete process.env[key];
			else process.env[key] = previous[key];
		}
	};
}

for (const migrationUrl of [
	'placeholder',
	'postgresql://migrator:example@other.example.test:5432/app?sslmode=verify-full',
]) {
	test(`application transactions ignore migration-only URL: ${migrationUrl === 'placeholder' ? 'invalid' : 'different database'}`, () => {
		const restore = snapshotEnv(KEYS);
		try {
			for (const key of KEYS) delete process.env[key];
			const runtimeUrl = 'postgresql://app:example@db.example.test:5432/app?sslmode=verify-full';
			process.env.POSTGRES_URL = runtimeUrl;
			process.env.DATABASE_MIGRATION_URL = migrationUrl;
			assert.equal(resolveConnectionString(), runtimeUrl);
		} finally {
			restore();
		}
	});
}

test('runtime aliases retain priority and ignore direct-connection variables', () => {
	const restore = snapshotEnv(KEYS);
	try {
		for (const key of KEYS) delete process.env[key];
		assert.throws(() => resolveConnectionString(), /POSTGRES_URL \(or DATABASE_URL\) is not set/);
		process.env.DATABASE_URL =
			'postgresql://app:example@db.example.test:5432/fallback?sslmode=verify-full';
		assert.equal(resolveConnectionString(), process.env.DATABASE_URL);
		process.env.POSTGRES_URL =
			'postgresql://app:example@db.example.test:5432/runtime?sslmode=verify-full';
		assert.equal(resolveConnectionString(), process.env.POSTGRES_URL);
		process.env.DATABASE_URL_UNPOOLED =
			'postgresql://app:example@db.example.test:5432/unpooled?sslmode=verify-full';
		process.env.POSTGRES_URL_NON_POOLING = 'placeholder';
		assert.equal(resolveConnectionString(), process.env.POSTGRES_URL);
		process.env.POSTGRES_URL = 'postgresql://app:example@db.example.test:5432/app';
		assert.equal(new URL(resolveConnectionString()).searchParams.get('sslmode'), 'verify-full');
	} finally {
		restore();
	}
});

test('Supabase connections use the official CA without disabling verification', () => {
	const restore = snapshotEnv(['POSTGRES_URL']);
	try {
		process.env.POSTGRES_URL =
			'postgresql://example:example@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';
		const result = resolveConnectionString();
		const certPath = new URL(result).searchParams.get('sslrootcert');
		assert.ok(certPath);
		const cert = new X509Certificate(readFileSync(certPath));
		assert.equal(
			cert.fingerprint256,
			'80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA',
		);
		const ssl = Reflect.get(new Client({ connectionString: result }), 'connectionParameters').ssl;
		assert.notEqual(ssl, false);
		assert.notEqual(ssl.rejectUnauthorized, false);
		assert.ok(ssl.ca);
		assert.equal(new URL(resolveConnectionString()).searchParams.get('sslrootcert'), certPath);
	} finally {
		restore();
	}
});

test('remote runtime connections enforce certificate-verified TLS', () => {
	const restore = snapshotEnv(KEYS);
	try {
		for (const key of KEYS) delete process.env[key];
		for (const mode of ['', 'disable', 'no-verify', 'require', 'verify-ca', 'verify-full']) {
			const url = new URL('postgresql://app:example@db.example.test:6543/app');
			if (mode) url.searchParams.set('sslmode', mode);
			url.searchParams.set('application_name', 'release-check');
			url.searchParams.set('ssl', 'false');
			url.searchParams.set('uselibpqcompat', 'true');
			url.searchParams.set('sslrootcert', '/private/certs/database-ca.pem');
			process.env.POSTGRES_URL = url.href;
			const result = new URL(resolveConnectionString());
			assert.equal(result.searchParams.get('sslmode'), 'verify-full');
			assert.equal(result.searchParams.get('application_name'), 'release-check');
			assert.equal(result.searchParams.get('sslrootcert'), '/private/certs/database-ca.pem');
			assert.equal(result.hostname, url.hostname);
		}
		process.env.POSTGRES_URL = 'postgresql://app:example@localhost/app';
		assert.equal(resolveConnectionString(), process.env.POSTGRES_URL);
		process.env.POSTGRES_URL = 'postgresql://app:example@[::1]/app';
		assert.equal(resolveConnectionString(), process.env.POSTGRES_URL);
		process.env.POSTGRES_URL = 'https://db.example.test:5432/app';
		assert.throws(() => resolveConnectionString(), /must be a PostgreSQL URL/);
		process.env.POSTGRES_URL =
			'postgresql://app:example@localhost:5432/app?host=remote.example.test&sslmode=disable';
		assert.throws(() => resolveConnectionString(), /must not override its host/);
	} finally {
		restore();
	}
});

// Live check against a disposable loopback database (`pnpm test:db`); skipped without TEST_DATABASE_URL.
test(
	'Preview transactions use runtime credentials and roll back writes',
	{
		skip: process.env.TEST_DATABASE_URL ? false : 'Requires TEST_DATABASE_URL (see pnpm test:db).',
	},
	async () => {
		const runtimeUrl = process.env.TEST_DATABASE_URL ?? '';
		assert.ok(
			['localhost', '127.0.0.1', '[::1]'].includes(new URL(runtimeUrl).hostname),
			'TEST_DATABASE_URL must be a loopback database',
		);
		const restore = snapshotEnv([
			'POSTGRES_URL',
			'DATABASE_MIGRATION_URL',
			'POSTGRES_URL_NON_POOLING',
			'DATABASE_URL_UNPOOLED',
		]);
		try {
			process.env.POSTGRES_URL = runtimeUrl;
			process.env.DATABASE_MIGRATION_URL = 'placeholder';
			Reflect.deleteProperty(process.env, 'POSTGRES_URL_NON_POOLING');
			Reflect.deleteProperty(process.env, 'DATABASE_URL_UNPOOLED');
			const { withTransaction } = await import('../src/core/db/transaction.ts');
			const { sql } = await import('drizzle-orm');
			const rollback = new Error('intentional release-check rollback');
			let backendPid: unknown;
			await assert.rejects(
				withTransaction(async (tx) => {
					await tx.execute(
						sql`create temporary table manawg_release_transaction_probe (id integer)`,
					);
					await tx.execute(sql`insert into manawg_release_transaction_probe values (1)`);
					const result = await tx.execute(
						sql`select count(*)::integer as count from manawg_release_transaction_probe`,
					);
					assert.equal(result.rows[0]?.count, 1);
					backendPid = (await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0]?.pid;
					throw rollback;
				}),
				(error) => error === rollback,
			);
			const result = await withTransaction((tx) =>
				tx.execute(
					sql`select pg_backend_pid() as pid, to_regclass('pg_temp.manawg_release_transaction_probe') is null as rolled_back`,
				),
			);
			assert.equal(result.rows[0]?.rolled_back, true);
			assert.equal(typeof backendPid, 'number');
			assert.equal(result.rows[0]?.pid, backendPid);
		} finally {
			restore();
		}
	},
);
