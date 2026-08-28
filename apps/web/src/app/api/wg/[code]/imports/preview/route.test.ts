import { queueSelects, resetRouteHarness, routeMocks } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';

const WG_ROW = { id: 'wg-1', name: 'Küche', shareCode: 'MTE8PZAT' };
const MEMBER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

function authenticate(memberRows: unknown[]): void {
	routeMocks.requireMember.mockResolvedValue({
		ok: true,
		member: { memberId: MEMBER_ID, name: 'Lisa' },
	});
	queueSelects([WG_ROW], memberRows);
}

describe('imports/preview route', () => {
	beforeEach(() => {
		resetRouteHarness();
	});

	it('rejects invalid share codes', async () => {
		const { POST } = await import('./route');
		const res = await POST(
			new NextRequest('https://mana.test/api/wg/BAD/imports/preview', {
				method: 'POST',
				body: '{}',
			}),
			{ params: Promise.resolve({ code: 'BAD' }) },
		);
		expect(res.status).toBe(400);
	});

	it('rejects payload larger than 5MB', async () => {
		const { POST } = await import('./route');
		const big = 'a'.repeat(6 * 1024 * 1024);
		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/imports/preview', {
				method: 'POST',
				body: JSON.stringify({ source: 'splitwise_csv', payload: big }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'payload_too_large' });
	});

	it('rejects oversized raw bodies before parsing JSON', async () => {
		const { POST } = await import('./route');
		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/imports/preview', {
				method: 'POST',
				body: 'x'.repeat(6 * 1024 * 1024),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'payload_too_large' });
	});

	it('returns parsed expenses and an auto-mapped mapping', async () => {
		authenticate([
			{ id: 'id-lisa', name: 'Lisa' },
			{ id: 'id-tom', name: 'Tom' },
		]);

		const csv = 'Date,Description,Cost,Currency,Lisa,Tom\n2026-04-01,Pizza,20.00,EUR,10.00,-10.00';
		const { POST } = await import('./route');
		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/imports/preview', {
				method: 'POST',
				headers: { 'x-member-id': MEMBER_ID },
				body: JSON.stringify({ source: 'splitwise_csv', payload: csv }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			parsed: Array<{ description: string }>;
			memberMapping: Record<string, string | null>;
			conflicts: string[];
		};
		expect(body.parsed).toHaveLength(1);
		expect(body.parsed[0]?.description).toBe('Pizza');
		expect(body.memberMapping.Lisa).toBe('id-lisa');
		expect(body.memberMapping.Tom).toBe('id-tom');
		expect(body.conflicts).toEqual([]);
	});

	it('RED BUG-082: returns a payload hash that commit can bind skip indexes to', async () => {
		authenticate([{ id: 'id-lisa', name: 'Lisa' }]);

		const csv = 'Date,Description,Cost,Currency,Lisa\n2026-04-01,Pizza,20.00,EUR,20.00';
		const { POST } = await import('./route');
		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/imports/preview', {
				method: 'POST',
				headers: { 'x-member-id': MEMBER_ID },
				body: JSON.stringify({ source: 'splitwise_csv', payload: csv }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual(
			expect.objectContaining({
				payloadHash: expect.any(String),
			}),
		);
	});

	it('returns conflicts when names cannot be matched', async () => {
		authenticate([{ id: 'id-lisa', name: 'Lisa' }]);

		const csv =
			'Date,Description,Cost,Currency,Lisa,Zacharias\n2026-04-01,Pizza,20.00,EUR,10.00,-10.00';
		const { POST } = await import('./route');
		const res = await POST(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT/imports/preview', {
				method: 'POST',
				headers: { 'x-member-id': MEMBER_ID },
				body: JSON.stringify({ source: 'splitwise_csv', payload: csv }),
			}),
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
		);
		const body = (await res.json()) as { conflicts: string[] };
		expect(body.conflicts).toContain('Zacharias');
	});
});
