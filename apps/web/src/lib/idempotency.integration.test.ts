/**
 * Real-database integration test for the Postgres-backed idempotency path.
 *
 * `idempotency.test.ts` (next to this file) only exercises the "no DB
 * configured" fallback branch of `claimResponseSlot` / `getCachedResponse` /
 * `setCachedResponse`. That is useful, but it never proves the *primary*
 * path — an actual row being written/read/raced under `POSTGRES_URL` — still
 * works. That primary path is exactly the mechanism behind the iter 13 P0
 * outage (Upstash empty-env silent disable), so it needs its own coverage
 * once schema or query changes land, not just the fallback's.
 *
 * Skipped unless POSTGRES_URL/DATABASE_URL is set — see
 * `route.integration.test.ts` for how the `db-integration` CI job activates
 * this file.
 */
import { db, idempotencyResponses } from '@/lib/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { claimResponseSlot, getCachedResponse, setCachedResponse } from './idempotency';

const hasRealDb = Boolean(process.env.POSTGRES_URL || process.env.DATABASE_URL);

describe.skipIf(!hasRealDb)('idempotency (real database)', () => {
	const scope = 'integration-test';
	const usedKeys: string[] = [];

	afterAll(async () => {
		for (const key of usedKeys) {
			await db
				.delete(idempotencyResponses)
				.where(and(eq(idempotencyResponses.scope, scope), eq(idempotencyResponses.key, key)));
		}
	});

	it('only one of two concurrent claims for the same key wins', async () => {
		const key = crypto.randomUUID();
		usedKeys.push(key);

		const [first, second] = await Promise.all([
			claimResponseSlot(scope, key),
			claimResponseSlot(scope, key),
		]);

		// Exactly one caller must win the (scope, key) primary key race — this
		// is the row-level locking semantic that cannot be faithfully mocked.
		expect([first, second].filter(Boolean)).toHaveLength(1);
	});

	it('a claimed-but-not-yet-set slot is not returned as a cached response', async () => {
		const key = crypto.randomUUID();
		usedKeys.push(key);

		const won = await claimResponseSlot(scope, key);
		expect(won).toBe(true);

		// The claim placeholder must not be mistaken for a real cached body.
		const cached = await getCachedResponse(scope, key);
		expect(cached).toBeNull();
	});

	it('round-trips a real response body through set/get', async () => {
		const key = crypto.randomUUID();
		usedKeys.push(key);
		const payload = { expenseId: crypto.randomUUID(), amountCents: 1234 };

		await setCachedResponse(scope, key, payload);
		const cached = await getCachedResponse<typeof payload>(scope, key);

		expect(cached).toEqual(payload);
	});

	it('setCachedResponse overwrites an earlier claim placeholder for the same key', async () => {
		const key = crypto.randomUUID();
		usedKeys.push(key);

		await claimResponseSlot(scope, key);
		await setCachedResponse(scope, key, { done: true });

		const cached = await getCachedResponse<{ done: boolean }>(scope, key);
		expect(cached).toEqual({ done: true });
	});
});
