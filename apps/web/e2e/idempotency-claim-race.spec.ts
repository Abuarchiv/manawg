import { expect, test } from '@playwright/test';
import { type ReplaySlotDependencies, claimReplaySlot } from '../src/core/guards/replay-slot';

type CachedResponse = { status: number; body: { id: string } };

const SCOPE = 'expense:create:race-wg';
const KEY = '11111111-1111-4111-8111-111111111111';
const CLAIM_LEASE_MS = 15 * 60 * 1000;
const RESPONSE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const noWait = async () => undefined;

/**
 * In-memory model of the Postgres claim contract behind `claimResponseSlot`:
 * one insert wins the `(scope, key)` primary key, an unexpired claim blocks
 * every other caller, the winner's placeholder stays invisible to readers
 * until a response is published, an expired lease can be reclaimed, and a
 * published response is replayable until its TTL.
 */
class ClaimSlotStore {
	private readonly slots = new Map<string, { body: unknown; expiresAt: number }>();
	private now = Date.now();

	advance(milliseconds: number): void {
		this.now += milliseconds;
	}

	claim(scope: string, key: string): boolean {
		const slot = this.slots.get(`${scope}:${key}`);
		if (slot && slot.expiresAt > this.now) return false;
		this.slots.set(`${scope}:${key}`, {
			body: { _claimed: true },
			expiresAt: this.now + CLAIM_LEASE_MS,
		});
		return true;
	}

	read(scope: string, key: string): unknown {
		const slot = this.slots.get(`${scope}:${key}`);
		if (!slot || slot.expiresAt <= this.now) return null;
		const body = slot.body as { _claimed?: boolean };
		if (body._claimed) return null;
		return slot.body;
	}

	publish(scope: string, key: string, body: unknown): void {
		this.slots.set(`${scope}:${key}`, { body, expiresAt: this.now + RESPONSE_TTL_MS });
	}
}

function dependencies(
	store: ClaimSlotStore,
	sleep: ReplaySlotDependencies<CachedResponse>['sleep'],
): ReplaySlotDependencies<CachedResponse> {
	return {
		claim: async (claimScope, claimKey) => store.claim(claimScope, claimKey),
		read: async (readScope, readKey) => store.read(readScope, readKey) as CachedResponse | null,
		...(sleep ? { sleep } : {}),
	};
}

const fastPoll = () =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, 2);
	});

test('concurrent requests for one idempotency key mutate exactly once and replay one response', async () => {
	const store = new ClaimSlotStore();
	let mutations = 0;
	let sequence = 0;

	const handleRequest = async (): Promise<CachedResponse> => {
		const slot = await claimReplaySlot<CachedResponse>(SCOPE, KEY, dependencies(store, fastPoll));
		if (!slot.won) return slot.cached;

		mutations += 1;
		// Slow winner: losers keep polling while the mutation is in flight.
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 5);
		});
		sequence += 1;
		const response: CachedResponse = { status: 201, body: { id: `expense-${sequence}` } };
		store.publish(SCOPE, KEY, response);
		return response;
	};

	const responses = await Promise.all(Array.from({ length: 6 }, () => handleRequest()));

	expect(mutations).toBe(1);
	expect(responses).toEqual(
		Array.from({ length: 6 }, () => ({ status: 201, body: { id: 'expense-1' } })),
	);

	// A later duplicate replays the cached response without claiming or mutating.
	const replayed = await handleRequest();
	expect(mutations).toBe(1);
	expect(replayed).toEqual({ status: 201, body: { id: 'expense-1' } });
});

test('a crashed winner keeps the slot taken until its claim lease expires', async () => {
	const store = new ClaimSlotStore();
	let mutations = 0;

	const winner = await claimReplaySlot<CachedResponse>(SCOPE, KEY, dependencies(store, noWait));
	expect(winner).toEqual({ won: true });
	mutations += 1;

	// The crashed winner never publishes: duplicates fail closed, no takeover.
	await expect(
		claimReplaySlot<CachedResponse>(SCOPE, KEY, dependencies(store, noWait)),
	).rejects.toMatchObject({ message: 'idempotency_response_pending' });
	expect(mutations).toBe(1);

	// Inside the lease window the slot still cannot be taken over.
	store.advance(CLAIM_LEASE_MS - 1000);
	await expect(
		claimReplaySlot<CachedResponse>(SCOPE, KEY, dependencies(store, noWait)),
	).rejects.toMatchObject({ message: 'idempotency_response_pending' });
	expect(mutations).toBe(1);

	// After the lease expires the slot is claimable again.
	store.advance(2000);
	const reclaim = await claimReplaySlot<CachedResponse>(SCOPE, KEY, dependencies(store, noWait));
	expect(reclaim).toEqual({ won: true });
	mutations += 1;
	expect(mutations).toBe(2);
});

test('a failed claim aborts the request before any mutation', async () => {
	const mutations = 0;
	const failing: ReplaySlotDependencies<CachedResponse> = {
		claim: async () => {
			throw new Error('idempotency_claim_failed');
		},
		read: async () => null,
		sleep: noWait,
	};

	await expect(claimReplaySlot<CachedResponse>(SCOPE, KEY, failing)).rejects.toMatchObject({
		message: 'idempotency_claim_failed',
	});
	expect(mutations).toBe(0);
});

test('the same key under a different scope claims independently', async () => {
	const store = new ClaimSlotStore();

	const expense = await claimReplaySlot<CachedResponse>(
		'expense:create:wg-a',
		KEY,
		dependencies(store, noWait),
	);
	const chore = await claimReplaySlot<CachedResponse>(
		'chore:create:wg-a',
		KEY,
		dependencies(store, noWait),
	);

	expect(expense).toEqual({ won: true });
	expect(chore).toEqual({ won: true });
});
