/**
 * Session-level advisory lock that serializes migrator runs. Polls pg_try_advisory_lock so a stuck
 * holder fails the run with a clear reason instead of blocking it until the job times out.
 */

const MIGRATION_LOCK = 'manawg:drizzle-migrate';
const LOCK_WAIT_MS = 60_000;
const LOCK_RETRY_MS = 1_000;

export class MigrationLockBusyError extends Error {
	constructor(waitMs) {
		super(
			`Migration advisory lock is held by another session; gave up after ${waitMs / 1000}s. Wait for the other migration to finish before retrying.`,
		);
		this.name = 'MigrationLockBusyError';
	}
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function acquireMigrationLock(
	client,
	{ waitMs = LOCK_WAIT_MS, retryMs = LOCK_RETRY_MS, now = Date.now, sleep = defaultSleep } = {},
) {
	const deadline = now() + waitMs;
	for (;;) {
		const { rows } = await client.query('select pg_try_advisory_lock(hashtext($1)) as locked', [
			MIGRATION_LOCK,
		]);
		if (rows[0]?.locked === true) return;
		const remaining = deadline - now();
		if (remaining <= 0) throw new MigrationLockBusyError(waitMs);
		await sleep(Math.min(retryMs, remaining));
	}
}

export async function releaseMigrationLock(client) {
	await client.query('select pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK]);
}
