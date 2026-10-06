import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../../src/core/db/schema';
import { mockDb } from './db-mock';

/**
 * A disposable PostgreSQL schema for the private-image deletion tests, which need real row locks
 * and advisory locks. They run only when `PRIVATE_IMAGE_TEST_DATABASE_URL` names a loopback
 * database; every run creates and drops its own schema.
 */
export const connectionString = process.env.PRIVATE_IMAGE_TEST_DATABASE_URL;
export const skipWithoutDatabase = { skip: !connectionString };
const APPLICATION_NAME = 'manawg_private_image_test';

type TestDb = NodePgDatabase<typeof schema>;

export interface PrivateImageDb {
	db: TestDb;
	/** A separate connection for fixtures and lock inspection, outside the app's pool. */
	setup: pg.Client;
	schemaName: string;
	close: () => Promise<void>;
}

const live: { db: TestDb | null } = { db: null };

function currentDb(): TestDb {
	assert.ok(live.db, 'the test database is not open');
	return live.db;
}

/**
 * Mock `@/core/db` with the real schema and a `db` that forwards to the test database once it
 * is open, so modules under test can be imported before the database exists.
 */
export function mockLiveDb(): void {
	mockDb({
		db: new Proxy(
			{},
			{
				get: (_target, key) => {
					const target = currentDb();
					const value = Reflect.get(target, key);
					return typeof value === 'function' ? value.bind(target) : value;
				},
			},
		),
		withTransaction: <T>(operation: Parameters<TestDb['transaction']>[0]) =>
			currentDb().transaction(operation) as Promise<T>,
	});
}

const TABLES = [
	`expenses (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		wg_id uuid,
		paid_by_member_id uuid,
		amount_cents integer DEFAULT 100,
		currency text DEFAULT 'EUR',
		description text DEFAULT 'Test',
		image_url text,
		recurring_expense_id uuid,
		recurring_due_at timestamptz,
		import_id uuid,
		import_duplicate_key text,
		occurred_at timestamptz DEFAULT now(),
		created_at timestamptz DEFAULT now(),
		updated_at timestamptz DEFAULT now()
	)`,
	`expense_splits (
		id uuid DEFAULT gen_random_uuid(),
		expense_id uuid,
		debtor_member_id uuid,
		amount_cents integer,
		settled_at timestamptz
	)`,
	'wgs (id uuid PRIMARY KEY)',
	`account_deletions (
		auth_user_id uuid PRIMARY KEY,
		requested_at timestamptz DEFAULT now(),
		completed_at timestamptz,
		last_attempt_at timestamptz
	)`,
	`wg_members (
		id uuid PRIMARY KEY,
		wg_id uuid,
		auth_user_id uuid,
		name text,
		role text,
		deactivated_at timestamptz,
		created_at timestamptz DEFAULT now(),
		paypal_merchant_id text,
		push_opt_in boolean DEFAULT false
	)`,
	'expense_payments (id uuid, wg_id uuid, from_member_id uuid, status text)',
	'shopping_items (wg_id uuid)',
	'chores (wg_id uuid)',
	'recurring_expenses (wg_id uuid)',
	`announcements (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		wg_id uuid,
		author_member_id uuid,
		content text,
		image_url text
	)`,
	`wg_chat_messages (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		wg_id uuid,
		sender_member_id uuid,
		kind text,
		body text,
		image_url text,
		system_kind text,
		system_payload jsonb,
		reply_to_message_id uuid,
		edited_at timestamptz,
		deleted_at timestamptz,
		created_at timestamptz DEFAULT now()
	)`,
	`private_image_deletions (
		object_key text PRIMARY KEY,
		requested_at timestamptz NOT NULL DEFAULT now(),
		last_attempt_at timestamptz,
		storage_deleted_at timestamptz
	)`,
	`idempotency_responses (
		scope text NOT NULL,
		key text NOT NULL,
		response_body jsonb NOT NULL,
		expires_at timestamptz NOT NULL,
		created_at timestamptz DEFAULT now(),
		PRIMARY KEY (scope, key)
	)`,
];

/** Create the schema and its tables and point the mocked `db` at it. */
export async function openPrivateImageDb(): Promise<PrivateImageDb> {
	assert.ok(connectionString, 'PRIVATE_IMAGE_TEST_DATABASE_URL is required');
	const parsed = new URL(connectionString);
	const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
	assert.ok(
		(parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:') &&
			loopbackHosts.has(parsed.hostname) &&
			parsed.port !== '' &&
			!parsed.search &&
			!parsed.hash,
		'test database must be a query-free loopback URL',
	);

	const schemaName = `private_image_test_${process.pid}_${Date.now()}`;
	const setup = new pg.Client({ connectionString });
	const target = setup as unknown as { connectionParameters: { host: string; port: number } };
	assert.ok(
		loopbackHosts.has(target.connectionParameters.host),
		'pg driver target must remain on loopback',
	);
	assert.equal(Number(target.connectionParameters.port), Number(parsed.port));
	await setup.connect();
	await setup.query(`CREATE SCHEMA ${schemaName}`);
	for (const table of TABLES) await setup.query(`CREATE TABLE ${schemaName}.${table}`);

	const pool = new pg.Pool({
		connectionString,
		max: 5,
		application_name: APPLICATION_NAME,
		options: `-c search_path=${schemaName},public`,
	});
	const db = drizzle(pool, { schema });
	live.db = db;
	return {
		db,
		setup,
		schemaName,
		close: async () => {
			live.db = null;
			await pool.end();
			await setup.query(`DROP SCHEMA ${schemaName} CASCADE`);
			await setup.end();
		},
	};
}

/** A private image stored under an origin other than the app's, as older rows are. */
export function imageUrl(id: string, wgId: string): { key: string; url: string } {
	const key = `manawg/${wgId}/expense/${id}.jpg`;
	return { key, url: `https://old-preview.example/api/upload/read?key=${encodeURIComponent(key)}` };
}

/** The query of a test connection that waits on a lock, polled briefly; null when none waits. */
export async function lockedQuery(setup: pg.Client): Promise<string | null> {
	for (let attempt = 0; attempt < 30; attempt++) {
		const waiting = await setup.query<{ query: string }>(
			`SELECT query FROM pg_stat_activity WHERE application_name = '${APPLICATION_NAME}' AND wait_event_type = 'Lock' LIMIT 1`,
		);
		if (waiting.rows[0]) return waiting.rows[0].query;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	return null;
}

/** A promise with its resolver, for holding a transaction open at a gate. */
export function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve: () => void = () => undefined;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

/** Whether `gate` resolves before `work` settles: the transaction reached its held-lock point. */
export function reachesFirst(gate: Promise<void>, work: Promise<unknown>): Promise<boolean> {
	return Promise.race([gate.then(() => true), work.then(() => false)]);
}
