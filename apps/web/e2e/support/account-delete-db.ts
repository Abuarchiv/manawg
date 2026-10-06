// Shared setup of the account deletion database suite: it validates that ACCOUNT_DELETE_TEST_URL
// is a loopback PostgreSQL target before any test connects, points the app's database variables at
// it, and removes the deletion rows each test created.

import { test } from '@playwright/test';

const accountDeleteTestUrl = process.env.ACCOUNT_DELETE_TEST_URL?.trim() ?? '';
const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);
const accountDeleteDatabaseUrl = accountDeleteTestUrl ? new URL(accountDeleteTestUrl) : undefined;
if (accountDeleteDatabaseUrl) {
	const databaseUrl = accountDeleteDatabaseUrl;
	const hostname = databaseUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (
		!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
		!loopbackHosts.has(hostname) ||
		!databaseUrl.port ||
		!databaseUrl.username ||
		databaseUrl.search !== '' ||
		databaseUrl.hash !== ''
	) {
		throw new Error(
			'ACCOUNT_DELETE_TEST_URL must include a loopback host and explicit port, without query or fragment overrides.',
		);
	}
	process.env.ACCOUNT_DELETE_TEST_URL = accountDeleteTestUrl;
	for (const key of Object.keys(process.env)) {
		if (key.startsWith('PG')) Reflect.deleteProperty(process.env, key);
	}
	for (const key of [
		'POSTGRES_URL',
		'DATABASE_URL',
		'POSTGRES_URL_NON_POOLING',
		'DATABASE_URL_UNPOOLED',
	]) {
		process.env[key] = accountDeleteTestUrl;
	}
}

interface PgResolvedClient {
	connectionParameters: { host: string; port: number; database: string; user: string };
}

const deletionFixtureIds = new Set<string>();

/** Registers the target check and the per-test cleanup; call once at the top of each spec file. */
export function useAccountDeleteDatabase(): void {
	test.beforeAll(async () => {
		if (!accountDeleteTestUrl || !accountDeleteDatabaseUrl) return;

		const { Client } = await import('pg');
		const client = new Client({ connectionString: accountDeleteTestUrl });
		// pg resolves the final target (env, defaults) into this untyped field.
		const { host, port, database, user } = (client as unknown as PgResolvedClient)
			.connectionParameters;
		const actualHost = String(host)
			.toLowerCase()
			.replace(/^\[|\]$/g, '');
		const expectedHost = accountDeleteDatabaseUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
		const expectedDatabase = decodeURIComponent(accountDeleteDatabaseUrl.pathname.slice(1));
		const expectedUser = decodeURIComponent(accountDeleteDatabaseUrl.username);
		if (
			!loopbackHosts.has(actualHost) ||
			actualHost !== expectedHost ||
			Number(port) !== Number(accountDeleteDatabaseUrl.port) ||
			database !== expectedDatabase ||
			user !== expectedUser
		) {
			throw new Error(
				'Resolved account-delete PostgreSQL connection is not the validated loopback target.',
			);
		}
	});

	test.afterEach(async () => {
		const url = process.env.ACCOUNT_DELETE_TEST_URL;
		if (!url || deletionFixtureIds.size === 0) return;
		const { Client } = await import('pg');
		const client = new Client({ connectionString: url });
		await client.connect();
		try {
			await client.query('DELETE FROM account_deletions WHERE auth_user_id = ANY($1::uuid[])', [
				[...deletionFixtureIds],
			]);
		} finally {
			deletionFixtureIds.clear();
			await client.end();
		}
	});
}

export function trackDeletionFixture(authUserId: string): void {
	deletionFixtureIds.add(authUserId);
}

export function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve = () => {};
	const promise = new Promise<void>((ready) => {
		resolve = ready;
	});
	return { promise, resolve };
}

export async function waitForBlockedQuery(client: import('pg').Client, applicationName: string) {
	const deadline = Date.now() + 3_000;
	while (Date.now() < deadline) {
		const { rows } = await client.query(
			' SELECT cardinality(pg_blocking_pids(pid)) > 0 AS blocked FROM pg_stat_activity WHERE application_name = $1',
			[applicationName],
		);
		if (rows[0]?.blocked) return true;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	return false;
}
