import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	claimResponseSlot,
	getCachedResponse,
	readIdempotencyKey,
	setCachedResponse,
} from './idempotency';

describe('readIdempotencyKey', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns null when the header is missing', () => {
		const req = new Request('https://mana.test/', { method: 'POST' });
		expect(readIdempotencyKey(req)).toBeNull();
	});

	it('returns the lowercased uuid when the header is well-formed', () => {
		const req = new Request('https://mana.test/', {
			method: 'POST',
			headers: { 'Idempotency-Key': '7D898F9E-5AD7-4F5D-ABED-8C3E99A76973' },
		});
		expect(readIdempotencyKey(req)).toBe('7d898f9e-5ad7-4f5d-abed-8c3e99a76973');
	});

	it('returns null for non-uuid header values', () => {
		const req = new Request('https://mana.test/', {
			method: 'POST',
			headers: { 'Idempotency-Key': 'not-a-uuid' },
		});
		expect(readIdempotencyKey(req)).toBeNull();
	});

	it('trims surrounding whitespace before validating', () => {
		const req = new Request('https://mana.test/', {
			method: 'POST',
			headers: { 'Idempotency-Key': '  7d898f9e-5ad7-4f5d-abed-8c3e99a76973  ' },
		});
		expect(readIdempotencyKey(req)).toBe('7d898f9e-5ad7-4f5d-abed-8c3e99a76973');
	});
});

describe('claimResponseSlot (no-db fallback)', () => {
	// When DB is not configured in test/CI, claimResponseSlot must fail open
	// (return true) so the caller proceeds with the mutation.

	it('fails open (returns true) when DB is not configured', async () => {
		const result = await claimResponseSlot(
			'expenses-create',
			'7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
		);
		expect(result).toBe(true);
	});
});

describe('response-cache helpers (no-db fallback)', () => {
	// When DB env vars are absent in test/CI, both helpers must short-
	// circuit cleanly so the caller falls through to its normal code path.
	// This is the contract that makes the Idempotency-Key feature backwards-
	// compatible: routes can call it unconditionally and tests don't need a
	// DB mock to exercise the happy path.

	it('getCachedResponse returns null when DB is not configured', async () => {
		const result = await getCachedResponse(
			'expenses-create',
			'7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
		);
		expect(result).toBeNull();
	});

	it('setCachedResponse resolves without throwing when DB is not configured', async () => {
		await expect(
			setCachedResponse('expenses-create', '7d898f9e-5ad7-4f5d-abed-8c3e99a76973', { ok: true }),
		).resolves.toBeUndefined();
	});
});
