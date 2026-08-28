import { resetRouteHarness, routeDb, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const commitMock = vi.hoisted(() => ({
	commitImport: vi.fn(),
	hashPayload: vi.fn((..._args: unknown[]) => 'h'),
}));
const idempotencyMock = vi.hoisted(() => ({
	claimResponseSlot: vi.fn(),
	getCachedResponse: vi.fn(),
	readIdempotencyKey: vi.fn(),
	setCachedResponse: vi.fn(),
}));

// resolveWg now runs `db.select(...).from(wgs).where(...).limit(1)`. The chain
// resolves to the seeded WG row so the route can look up the WG before auth.
const WG_ROW = { id: 'wg-1', name: 'Küche', shareCode: 'MTE8PZAT' };

function seedWgSelect(): void {
	const chain = {
		from: () => chain,
		where: () => chain,
		limit: () => Promise.resolve([WG_ROW]),
	};
	routeDb.select.mockReturnValue(chain);
}

vi.mock('@/features/expenses/import-commit', () => ({
	commitImport: (...args: unknown[]) => commitMock.commitImport(...args),
}));

vi.mock('@/features/expenses/import-hash', () => ({
	hashPayload: (...args: unknown[]) => commitMock.hashPayload(...args),
}));

vi.mock('@/core/idempotency', () => ({
	claimResponseSlot: (...args: unknown[]) => idempotencyMock.claimResponseSlot(...args),
	getCachedResponse: (...args: unknown[]) => idempotencyMock.getCachedResponse(...args),
	readIdempotencyKey: (...args: unknown[]) => idempotencyMock.readIdempotencyKey(...args),
	setCachedResponse: (...args: unknown[]) => idempotencyMock.setCachedResponse(...args),
}));

describe('imports/commit route', () => {
	beforeEach(() => {
		resetRouteHarness();
		idempotencyMock.readIdempotencyKey.mockReturnValue(null);
		idempotencyMock.getCachedResponse.mockResolvedValue(null);
		idempotencyMock.claimResponseSlot.mockResolvedValue(true);
		idempotencyMock.setCachedResponse.mockResolvedValue(undefined);
	});

	it('rejects payload above 5MB for CSV', async () => {
		const { POST } = await import('./route');
		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/imports/commit', {
				method: 'POST',
				body: JSON.stringify({
					source: 'splitwise_csv',
					payload: 'a'.repeat(6 * 1024 * 1024),
					memberMapping: {},
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'payload_too_large' });
	});

	it('rejects oversized raw bodies before parsing JSON', async () => {
		const { POST } = await import('./route');
		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/imports/commit', {
				method: 'POST',
				body: 'x'.repeat(6 * 1024 * 1024),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'payload_too_large' });
	});

	it('returns mapping_incomplete when names are unmapped', async () => {
		seedWgSelect();
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973', name: 'Lisa' },
		});
		const csv = 'Date,Description,Cost,Currency,Lisa,Tom\n2026-04-01,Pizza,20.00,EUR,10.00,-10.00';
		const { POST } = await import('./route');
		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/imports/commit', {
				method: 'POST',
				headers: { 'x-member-id': '7d898f9e-5ad7-4f5d-abed-8c3e99a76973' },
				body: JSON.stringify({
					source: 'splitwise_csv',
					payload: csv,
					memberMapping: { Lisa: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973' },
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string; conflicts: string[] };
		expect(body.error).toBe('mapping_incomplete');
		expect(body.conflicts).toContain('Tom');
	});

	it('rejects skip indexes outside the reparsed payload', async () => {
		seedWgSelect();
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973', name: 'Lisa' },
		});
		const csv = 'Date,Description,Cost,Currency,Lisa\n2026-04-01,Pizza,20.00,EUR,20.00';
		const { POST } = await import('./route');
		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/imports/commit', {
				method: 'POST',
				headers: { 'x-member-id': '7d898f9e-5ad7-4f5d-abed-8c3e99a76973' },
				body: JSON.stringify({
					source: 'splitwise_csv',
					payload: csv,
					memberMapping: { Lisa: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973' },
					previewPayloadHash: 'h',
					skipIndexes: [1],
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'invalid_skip_indexes' });
		expect(commitMock.commitImport).not.toHaveBeenCalled();
	});

	it('RED BUG-082: rejects commits when the payload no longer matches the preview hash', async () => {
		seedWgSelect();
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973', name: 'Lisa' },
		});
		commitMock.commitImport.mockResolvedValue({
			importId: 'imp-1',
			inserted: 1,
			skipped: 0,
			errors: [],
		});
		const csv = 'Date,Description,Cost,Currency,Lisa\n2026-04-01,Pasta,20.00,EUR,20.00';
		const { POST } = await import('./route');
		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/imports/commit', {
				method: 'POST',
				headers: { 'x-member-id': '7d898f9e-5ad7-4f5d-abed-8c3e99a76973' },
				body: JSON.stringify({
					source: 'splitwise_csv',
					payload: csv,
					previewPayloadHash: 'hash-from-preview-of-different-same-length-payload',
					memberMapping: { Lisa: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973' },
					skipIndexes: [0],
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'payload_changed' });
		expect(commitMock.commitImport).not.toHaveBeenCalled();
	});

	it('RED BUG-386: rejects skip indexes when no preview payload hash is provided', async () => {
		seedWgSelect();
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973', name: 'Lisa' },
		});
		commitMock.commitImport.mockResolvedValue({
			importId: 'imp-1',
			inserted: 1,
			skipped: 1,
			errors: [],
		});
		const csv = [
			'Date,Description,Cost,Currency,Lisa',
			'2026-04-01,Pizza,20.00,EUR,20.00',
			'2026-04-02,Pasta,10.00,EUR,10.00',
		].join('\n');
		const { POST } = await import('./route');
		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/imports/commit', {
				method: 'POST',
				headers: { 'x-member-id': '7d898f9e-5ad7-4f5d-abed-8c3e99a76973' },
				body: JSON.stringify({
					source: 'splitwise_csv',
					payload: csv,
					memberMapping: { Lisa: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973' },
					skipIndexes: [1],
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'preview_hash_required' });
		expect(commitMock.commitImport).not.toHaveBeenCalled();
	});

	it('delegates to commitImport on success', async () => {
		seedWgSelect();
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973', name: 'Lisa' },
		});
		commitMock.commitImport.mockResolvedValue({
			importId: 'imp-1',
			inserted: 1,
			skipped: 0,
			errors: [],
		});
		const csv = 'Date,Description,Cost,Currency,Lisa\n2026-04-01,Pizza,20.00,EUR,20.00';
		const { POST } = await import('./route');
		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/imports/commit', {
				method: 'POST',
				headers: { 'x-member-id': '7d898f9e-5ad7-4f5d-abed-8c3e99a76973' },
				body: JSON.stringify({
					source: 'splitwise_csv',
					payload: csv,
					memberMapping: { Lisa: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973' },
				}),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { importId: string; inserted: number };
		expect(body.importId).toBe('imp-1');
		expect(body.inserted).toBe(1);
		expect(commitMock.commitImport).toHaveBeenCalledOnce();
	});

	it('replays the cached result instead of committing twice for a retried Idempotency-Key', async () => {
		seedWgSelect();
		routeMocks.requireMember.mockResolvedValue({
			ok: true,
			member: { memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973', name: 'Lisa' },
		});
		idempotencyMock.readIdempotencyKey.mockReturnValue('retry-key');
		commitMock.commitImport.mockResolvedValue({
			importId: 'imp-1',
			inserted: 1,
			skipped: 0,
			errors: [],
		});
		const csv = 'Date,Description,Cost,Currency,Lisa\n2026-04-01,Pizza,20.00,EUR,20.00';
		const { POST } = await import('./route');
		const makeRequest = () =>
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/imports/commit', {
				method: 'POST',
				headers: {
					'x-member-id': '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
					'Idempotency-Key': 'retry-key',
				},
				body: JSON.stringify({
					source: 'splitwise_csv',
					payload: csv,
					memberMapping: { Lisa: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973' },
					skipDuplicates: false,
				}),
			});

		const first = await POST(makeRequest(), { params: Promise.resolve({ code: 'MTE8PZAT' }) });
		const second = await POST(makeRequest(), { params: Promise.resolve({ code: 'MTE8PZAT' }) });

		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		expect(await second.json()).toEqual(await first.json());
		expect(commitMock.commitImport).toHaveBeenCalledOnce();
		expect(idempotencyMock.setCachedResponse).toHaveBeenCalledTimes(1);
	});
});
