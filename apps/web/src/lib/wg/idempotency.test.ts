import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const claimResponseSlotMock = vi.fn();
const getCachedResponseMock = vi.fn();

vi.mock('@/lib/idempotency', () => ({
	claimResponseSlot: (...args: unknown[]) => claimResponseSlotMock(...args),
	getCachedResponse: (...args: unknown[]) => getCachedResponseMock(...args),
	setCachedResponse: vi.fn(),
}));

import { ReplayCache, claimReplaySlotWithRetry, replayKey } from './idempotency';

describe('replayKey', () => {
	it('namespaces the raw key under the scope', () => {
		expect(replayKey('settle-batch', 'abc123')).toBe('settle-batch:abc123');
	});
});

describe('ReplayCache', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns null for a key that was never reserved', () => {
		const cache = new ReplayCache<string>(1000);
		expect(cache.get('missing')).toBeNull();
	});

	it('remembers a resolved value until it is read back', async () => {
		const cache = new ReplayCache<string>(1000);
		cache.remember('key', 'body');
		await expect(cache.get('key')).resolves.toBe('body');
	});

	it('expires an entry once its TTL has elapsed', () => {
		const cache = new ReplayCache<string>(1000);
		cache.remember('key', 'body');
		vi.advanceTimersByTime(1001);
		expect(cache.get('key')).toBeNull();
	});

	it('gives the first caller ownership and later callers the same promise', () => {
		const cache = new ReplayCache<string>(1000);
		const first = cache.reserve('key');
		const second = cache.reserve('key');

		expect(first.owned).toBe(true);
		expect(second.owned).toBe(false);
	});

	it('resolves the shared promise for every waiter once the owner resolves', async () => {
		const cache = new ReplayCache<string>(1000);
		const first = cache.reserve('key');
		const second = cache.reserve('key');

		if (!first.owned) throw new Error('expected first reservation to be owned');
		first.resolve('done');

		if (second.owned) throw new Error('expected second reservation to not be owned');
		await expect(second.promise).resolves.toBe('done');
		await expect(cache.get('key')).resolves.toBe('done');
	});

	it('frees the slot when the owner rejects, letting the next caller own it', async () => {
		const cache = new ReplayCache<string>(1000);
		const first = cache.reserve('key');
		if (!first.owned) throw new Error('expected first reservation to be owned');
		first.reject(new Error('boom'));

		expect(cache.get('key')).toBeNull();
		const retry = cache.reserve('key');
		expect(retry.owned).toBe(true);
	});
});

describe('claimReplaySlotWithRetry', () => {
	beforeEach(() => {
		claimResponseSlotMock.mockReset();
		getCachedResponseMock.mockReset();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('reports a win when the claim succeeds', async () => {
		claimResponseSlotMock.mockResolvedValue(true);

		const result = await claimReplaySlotWithRetry('scope', 'key');

		expect(result).toEqual({ won: true });
		expect(getCachedResponseMock).not.toHaveBeenCalled();
	});

	it('returns the cached body immediately when the winner already finished', async () => {
		claimResponseSlotMock.mockResolvedValue(false);
		getCachedResponseMock.mockResolvedValueOnce({ ok: true });

		const result = await claimReplaySlotWithRetry('scope', 'key');

		expect(result).toEqual({ won: false, cached: { ok: true } });
	});

	it('polls until a cached response appears', async () => {
		claimResponseSlotMock.mockResolvedValue(false);
		getCachedResponseMock
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ ok: true });

		const resultPromise = claimReplaySlotWithRetry('scope', 'key');
		await vi.runAllTimersAsync();
		const result = await resultPromise;

		expect(result).toEqual({ won: false, cached: { ok: true } });
		expect(getCachedResponseMock).toHaveBeenCalledTimes(3);
	});

	it('gives up after exhausting all retries and reports the slot as failed', async () => {
		claimResponseSlotMock.mockResolvedValue(false);
		getCachedResponseMock.mockResolvedValue(null);

		const resultPromise = claimReplaySlotWithRetry('scope', 'key');
		await vi.runAllTimersAsync();
		const result = await resultPromise;

		expect(result).toEqual({ won: false, cached: null });
		// 1 immediate check + 14 poll attempts (backoff up to ~10s total)
		expect(getCachedResponseMock).toHaveBeenCalledTimes(15);
	});
});
