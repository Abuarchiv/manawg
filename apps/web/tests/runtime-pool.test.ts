import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock, test } from 'node:test';
import * as realConnection from '@/core/db/connection';
import { sql } from 'drizzle-orm';
import { drizzle as realDrizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

// `@/core/db` is loaded once. Its pool class, drizzle factory and connection module are
// delegates, so the configuration check can use stand-ins and the optional integration run
// can switch to the real driver behind the same module.

type PoolOptions = ConstructorParameters<typeof pg.Pool>[0];
type Connection = Pick<
	typeof realConnection,
	'closeClientOnQueryTimeout' | 'resolveConnectionString'
>;

const driver = {
	Pool: pg.Pool as new (options: PoolOptions) => unknown,
	drizzle: realDrizzle as (pool: never) => unknown,
	connection: realConnection as Connection,
};

mock.module('@/core/db/connection', {
	namedExports: {
		closeClientOnQueryTimeout: (...args: Parameters<Connection['closeClientOnQueryTimeout']>) =>
			driver.connection.closeClientOnQueryTimeout(...args),
		resolveConnectionString: () => driver.connection.resolveConnectionString(),
	},
});
mock.module('@/core/db/schema', { namedExports: {} });
mock.module('pg', {
	defaultExport: pg,
	namedExports: {
		Pool: function DelegatingPool(options: PoolOptions) {
			return new driver.Pool(options);
		},
	},
});
mock.module('drizzle-orm/node-postgres', {
	namedExports: { drizzle: (pool: never) => driver.drizzle(pool) },
});

const runtimeDb = await import('@/core/db');

const env = process.env as Record<string, string | undefined>;
function setDatabaseUrl(url: string): void {
	env.POSTGRES_URL = url;
	Reflect.deleteProperty(env, 'DATABASE_URL');
}

function hasCauseCode(error: unknown, code: string): boolean {
	const cause = error instanceof Error ? error.cause : undefined;
	return typeof cause === 'object' && cause !== null && Reflect.get(cause, 'code') === code;
}

test(
	'runtime database pools time out stalled, locked, and slow queries and recover',
	{ timeout: 60_000 },
	async (t) => {
		const previousUrls = [env.POSTGRES_URL, env.DATABASE_URL] as const;
		t.after(() => {
			for (const [name, value] of [
				['POSTGRES_URL', previousUrls[0]],
				['DATABASE_URL', previousUrls[1]],
			] as const) {
				if (value === undefined) Reflect.deleteProperty(env, name);
				else env[name] = value;
			}
		});
		t.mock.method(console, 'warn', () => undefined);
		const runtimeUrl = 'postgresql://postgres@127.0.0.1:6543/postgres?sslmode=disable';
		const expected = {
			connectionString: runtimeUrl,
			max: 5,
			connectionTimeoutMillis: 2_000,
			lock_timeout: 2_000,
			query_timeout: 5_500,
			statement_timeout: 5_000,
		};
		for (const parameter of ['lock_timeout', 'query_timeout', 'statement_timeout']) {
			const url = new URL(runtimeUrl);
			url.searchParams.set(parameter, '0');
			setDatabaseUrl(url.href);
			assert.throws(() => realConnection.resolveConnectionString(), new RegExp(parameter));
		}
		const configuredUrl = new URL(runtimeUrl);
		configuredUrl.searchParams.set('application_name', 'runtime-pool-test');
		configuredUrl.searchParams.set('connect_timeout', '0');
		setDatabaseUrl(configuredUrl.href);
		const preserved = new URL(realConnection.resolveConnectionString());
		assert.equal(preserved.searchParams.get('application_name'), 'runtime-pool-test');
		assert.equal(preserved.searchParams.get('connect_timeout'), '0');

		setDatabaseUrl(runtimeUrl);
		const configPools: ConfigPool[] = [];
		class ConfigPool {
			options: PoolOptions;
			constructor(options: PoolOptions) {
				this.options = options;
				configPools.push(this);
			}

			on() {}
		}
		driver.connection = {
			closeClientOnQueryTimeout: () => {},
			resolveConnectionString: () => runtimeUrl,
		};
		driver.Pool = ConfigPool;
		driver.drizzle = (pool: ConfigPool) => ({
			getConfig: () => pool.options,
			transaction: async () => pool.options,
		});
		// The stand-in drizzle instance exposes only what this check reads.
		const configDb = runtimeDb.db as unknown as { getConfig(): unknown };
		assert.deepEqual(configDb.getConfig(), expected);
		assert.deepEqual(await runtimeDb.withTransaction(async () => undefined), expected);
		assert.equal(configPools.length, 1, 'queries and transactions share one pool');

		if (process.env.RUN_DB_TIMEOUT_INTEGRATION !== '1') return;
		const initdb = spawnSync('which', ['initdb'], { encoding: 'utf8' });
		const pgCtl = spawnSync('which', ['pg_ctl'], { encoding: 'utf8' });
		if (initdb.status !== 0 || pgCtl.status !== 0 || process.getuid?.() === 0) {
			t.skip(
				'Requires local initdb and pg_ctl and a non-root user for a disposable PostgreSQL instance.',
			);
			return;
		}

		const dataDir = mkdtempSync(join(tmpdir(), 'manawg-db-timeouts-'));
		const portProbe = net.createServer();
		await new Promise<void>((resolve, reject) => {
			portProbe.once('error', reject);
			portProbe.listen(0, '127.0.0.1', resolve);
		});
		const address = portProbe.address();
		assert.ok(address && typeof address !== 'string');
		const pgPort = address.port;
		await new Promise<void>((resolve, reject) => {
			portProbe.close((error) => (error ? reject(error) : resolve()));
		});

		const run = (binary: string, args: string[]) => {
			const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 30_000 });
			assert.equal(result.status, 0, `${binary} failed: ${result.stderr || result.stdout}`);
		};
		let proxy: net.Server | undefined;
		let proxyStarted = false;
		let dropRepliesForQuery: string | null = null;
		let droppedReplyBytes = 0;
		const proxySockets = new Set<net.Socket>();
		const pools: pg.Pool[] = [];
		let pgStarted = false;
		try {
			run(initdb.stdout.trim(), [
				'--no-locale',
				'--encoding=UTF8',
				'--auth=trust',
				'--username=postgres',
				'-D',
				dataDir,
			]);
			run(pgCtl.stdout.trim(), [
				'-D',
				dataDir,
				'-l',
				join(dataDir, 'postgres.log'),
				'-o',
				`-h 127.0.0.1 -p ${pgPort} -F`,
				'-w',
				'start',
			]);
			pgStarted = true;

			let stalledConnections = 0;
			proxy = net.createServer((client) => {
				proxySockets.add(client);
				client.once('close', () => proxySockets.delete(client));
				if (stalledConnections > 0) {
					stalledConnections -= 1;
					const closeTimer = setTimeout(() => client.destroy(), 4_500);
					closeTimer.unref();
					client.once('close', () => clearTimeout(closeTimer));
					return;
				}
				const upstream = net.connect(pgPort, '127.0.0.1');
				proxySockets.add(upstream);
				upstream.once('close', () => proxySockets.delete(upstream));
				client.once('close', () => upstream.destroy());
				upstream.once('close', () => client.destroy());
				client.on('error', () => upstream.destroy());
				upstream.on('error', () => client.destroy());
				let requestText = '';
				let dropResponses = false;
				client.on('data', (chunk) => {
					if (!dropResponses && dropRepliesForQuery) {
						requestText += chunk.toString('utf8');
						if (requestText.toLowerCase().includes(dropRepliesForQuery)) {
							dropResponses = true;
							dropRepliesForQuery = null;
						}
						if (requestText.length > 16_384) requestText = requestText.slice(-8_192);
					}
					upstream.write(chunk);
				});
				upstream.on('data', (chunk) => {
					if (dropResponses) {
						droppedReplyBytes += chunk.length;
						return;
					}
					client.write(chunk);
				});
			});
			const server = proxy;
			await new Promise<void>((resolve, reject) => {
				server.once('error', reject);
				server.listen(0, '127.0.0.1', resolve);
			});
			proxyStarted = true;
			const proxyAddress = proxy.address();
			assert.ok(proxyAddress && typeof proxyAddress !== 'string');
			const testRuntimeUrl = `postgresql://postgres@127.0.0.1:${proxyAddress.port}/postgres?sslmode=disable`;
			setDatabaseUrl(testRuntimeUrl);
			const { Client } = pg;
			class TrackedPool extends pg.Pool {
				testEndPromise: Promise<void> | undefined;
				constructor(options: PoolOptions) {
					super(options);
					pools.push(this);
				}

				override end(): Promise<void> {
					this.testEndPromise ??= super.end();
					return this.testEndPromise;
				}
			}
			driver.connection = realConnection;
			driver.Pool = TrackedPool;
			driver.drizzle = realDrizzle;
			const db = runtimeDb;

			const expectConnectTimeout = async (operation: () => Promise<unknown>) => {
				stalledConnections += 1;
				const startedAt = Date.now();
				await assert.rejects(operation(), (error) => error instanceof Error);
				const elapsed = Date.now() - startedAt;
				assert.ok(elapsed >= 1_500 && elapsed < 3_500, `connection timeout took ${elapsed}ms`);
			};
			await expectConnectTimeout(() => db.db.execute(sql`select 1`));
			const readResult = await db.db.execute(sql`select 42::integer as answer`);
			assert.equal(readResult.rows[0]?.answer, 42);
			const readSettings = await db.db.execute(
				sql`select current_setting('statement_timeout') as statement, current_setting('lock_timeout') as lock`,
			);
			assert.equal(readSettings.rows[0]?.statement, '5s');
			assert.equal(readSettings.rows[0]?.lock, '2s');
			dropRepliesForQuery = 'select pg_sleep';
			const readTimeoutStartedAt = Date.now();
			await assert.rejects(
				db.db.execute(sql`select pg_sleep(0.1)`),
				(error) => error instanceof Error,
			);
			const readTimeoutElapsed = Date.now() - readTimeoutStartedAt;
			assert.ok(
				readTimeoutElapsed >= 5_000 && readTimeoutElapsed < 7_500,
				`client-side read timeout took ${readTimeoutElapsed}ms`,
			);
			assert.ok(droppedReplyBytes > 0, 'the proxy dropped the completed read response');
			const readRecovered = await db.db.execute(sql`select 43::integer as answer`);
			assert.equal(readRecovered.rows[0]?.answer, 43);

			const { withTransaction } = db;
			await expectConnectTimeout(() => withTransaction((tx) => tx.execute(sql`select 1`)));

			const transactionSettings = await withTransaction((tx) =>
				tx.execute(
					sql`select current_setting('statement_timeout') as statement, current_setting('lock_timeout') as lock`,
				),
			);
			assert.equal(transactionSettings.rows[0]?.statement, '5s');
			assert.equal(transactionSettings.rows[0]?.lock, '2s');

			const lockHolder = new Client({
				connectionString: `postgresql://postgres@127.0.0.1:${pgPort}/postgres?sslmode=disable`,
			});
			try {
				await lockHolder.connect();
				await lockHolder.query('BEGIN');
				await lockHolder.query('SELECT pg_advisory_xact_lock(147258369)');
				const lockStartedAt = Date.now();
				await assert.rejects(
					withTransaction((tx) => tx.execute(sql`select pg_advisory_xact_lock(147258369)`)),
					(error) => hasCauseCode(error, '55P03'),
				);
				assert.ok(
					Date.now() - lockStartedAt < 3_500,
					'lock timeout should precede statement timeout',
				);
			} finally {
				await lockHolder.query('ROLLBACK').catch(() => {});
				await lockHolder.end().catch(() => {});
			}

			await assert.rejects(
				withTransaction((tx) => tx.execute(sql`select pg_sleep(10)`)),
				(error) => hasCauseCode(error, '57014'),
			);
			const probeClient = new Client({
				connectionString: `postgresql://postgres@127.0.0.1:${pgPort}/postgres?sslmode=disable`,
			});
			await probeClient.connect();
			try {
				await probeClient.query(
					'CREATE TABLE manawg_runtime_timeout_probe (id integer PRIMARY KEY)',
				);
				dropRepliesForQuery = 'insert into manawg_runtime_timeout_probe';
				droppedReplyBytes = 0;
				const writeTimeoutStartedAt = Date.now();
				await assert.rejects(
					withTransaction((tx) =>
						tx.execute(sql.raw('insert into manawg_runtime_timeout_probe (id) values (1)')),
					),
					(error) => error instanceof Error,
				);
				const writeTimeoutElapsed = Date.now() - writeTimeoutStartedAt;
				assert.ok(
					writeTimeoutElapsed >= 5_000 && writeTimeoutElapsed < 7_500,
					`transaction read timeout took ${writeTimeoutElapsed}ms`,
				);
				assert.ok(droppedReplyBytes > 0, 'the proxy dropped the completed write response');
				const { rows } = await probeClient.query(
					'select count(*)::integer as count from manawg_runtime_timeout_probe',
				);
				assert.equal(rows[0]?.count, 0, 'the timed-out transaction must roll back');
				const recovered = await withTransaction((tx) =>
					tx.execute(sql`select 7::integer as answer`),
				);
				assert.equal(recovered.rows[0]?.answer, 7);
			} finally {
				await probeClient
					.query('DROP TABLE IF EXISTS manawg_runtime_timeout_probe')
					.catch(() => {});
				await probeClient.end().catch(() => {});
			}
		} finally {
			if (proxyStarted) {
				await Promise.all(pools.map((pool) => pool.end()));
				for (const socket of proxySockets) socket.destroy();
				await new Promise((resolve) => proxy?.close(resolve));
			}
			if (pgStarted) {
				const stopped = spawnSync(
					pgCtl.stdout.trim(),
					['-D', dataDir, '-m', 'immediate', '-w', 'stop'],
					{
						encoding: 'utf8',
						timeout: 30_000,
					},
				);
				assert.equal(stopped.status, 0, `pg_ctl stop failed: ${stopped.stderr || stopped.stdout}`);
			}
			rmSync(dataDir, { recursive: true, force: true });
		}
	},
);
