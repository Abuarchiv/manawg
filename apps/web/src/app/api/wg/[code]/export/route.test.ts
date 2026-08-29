import { E2E_EXISTING_WG } from '@/core/infra/e2e-db-down';
import { MEMBER_ID_HEADER } from '@/shared/lib/member-header';
import { chainOf, chainRejecting, resetRouteHarness, routeDb } from '@/test/route-harness';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const guardMock = vi.hoisted(() => ({ requireWgMember: vi.fn() }));

vi.mock('@/core/guards/require-wg-member', () => ({
	requireWgMember: (...args: unknown[]) => guardMock.requireWgMember(...args),
}));

describe('export route E2E fallback auth', () => {
	beforeEach(() => {
		resetRouteHarness();
		vi.stubEnv('CI', 'true');
		vi.stubEnv('NEXT_PUBLIC_DB_DOWN', 'true');
		vi.stubEnv('POSTGRES_URL', '');
		vi.stubEnv('DATABASE_URL', '');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('requires a member id in DB-down mode', async () => {
		const res = await GET(
			new NextRequest(`https://mana.test/api/wg/${E2E_EXISTING_WG.shareCode}/export`),
			{ params: Promise.resolve({ code: E2E_EXISTING_WG.shareCode }) },
		);

		expect(res.status).toBe(401);
		await expect(res.json()).resolves.toMatchObject({
			code: 'member_id_required',
		});
	});

	it('allows fixture members in DB-down mode', async () => {
		const res = await GET(
			new NextRequest(`https://mana.test/api/wg/${E2E_EXISTING_WG.shareCode}/export`, {
				headers: {
					[MEMBER_ID_HEADER]: E2E_EXISTING_WG.member.id,
				},
			}),
			{ params: Promise.resolve({ code: E2E_EXISTING_WG.shareCode }) },
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({
			wg: {
				shareCode: E2E_EXISTING_WG.shareCode,
			},
		});
	});

	it('rejects unknown CSV sections instead of downloading the wrong section', async () => {
		const res = await GET(
			new NextRequest(
				`https://mana.test/api/wg/${E2E_EXISTING_WG.shareCode}/export?format=csv&section=unknown`,
				{
					headers: {
						[MEMBER_ID_HEADER]: E2E_EXISTING_WG.member.id,
					},
				},
			),
			{ params: Promise.resolve({ code: E2E_EXISTING_WG.shareCode }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'section_invalid' });
	});

	it('rejects unknown export formats instead of falling back to JSON', async () => {
		const res = await GET(
			new NextRequest(`https://mana.test/api/wg/${E2E_EXISTING_WG.shareCode}/export?format=xml`, {
				headers: {
					[MEMBER_ID_HEADER]: E2E_EXISTING_WG.member.id,
				},
			}),
			{ params: Promise.resolve({ code: E2E_EXISTING_WG.shareCode }) },
		);

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ error: 'format_invalid' });
	});
});

describe('export route database export', () => {
	beforeEach(() => {
		resetRouteHarness();
		vi.stubEnv('NEXT_PUBLIC_DB_DOWN', '');
		guardMock.requireWgMember.mockResolvedValue({
			ok: true,
			wg: { id: 'wg1', name: 'Test WG', shareCode: E2E_EXISTING_WG.shareCode },
			member: { memberId: E2E_EXISTING_WG.member.id, name: 'Ava' },
		});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('exports expense splits with debtor ids, names, amounts, and settledAt', async () => {
		const settledAt = new Date('2026-05-20T10:00:00.000Z');
		routeDb.select
			.mockReturnValueOnce(
				chainOf([
					{ id: 'm1', name: 'Ava', createdAt: new Date('2026-05-18T10:00:00.000Z') },
					{ id: 'm2', name: 'Ben', createdAt: new Date('2026-05-18T11:00:00.000Z') },
				]),
			)
			.mockReturnValueOnce(
				chainOf([
					{
						id: 'e1',
						description: 'Miete',
						amountCents: 50000,
						currency: 'EUR',
						paidByMemberId: 'm1',
						imageUrl: null,
						occurredAt: new Date('2026-05-19T10:00:00.000Z'),
					},
				]),
			)
			.mockReturnValueOnce(chainOf([]))
			.mockReturnValueOnce(chainOf([]))
			.mockReturnValueOnce(chainOf([]))
			.mockReturnValueOnce(chainOf([]))
			.mockReturnValueOnce(chainOf([]))
			.mockReturnValueOnce(chainOf([]))
			.mockReturnValueOnce(
				chainOf([
					{ expenseId: 'e1', debtorMemberId: 'm2', amountCents: 25000, settledAt },
					{ expenseId: 'e1', debtorMemberId: 'missing', amountCents: 25000, settledAt: null },
				]),
			);

		const res = await GET(
			new NextRequest(`https://mana.test/api/wg/${E2E_EXISTING_WG.shareCode}/export`),
			{ params: Promise.resolve({ code: E2E_EXISTING_WG.shareCode }) },
		);

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({
			sections: {
				expenses: [
					{
						id: 'e1',
						splits: [
							{
								debtorMemberId: 'm2',
								debtor: 'Ben',
								amountCents: 25000,
								settledAt: '2026-05-20T10:00:00.000Z',
							},
							{
								debtorMemberId: 'missing',
								debtor: 'missing',
								amountCents: 25000,
								settledAt: null,
							},
						],
					},
				],
			},
		});
	});

	it('exports requested members CSV without loading unrelated export tables', async () => {
		routeDb.select
			.mockReturnValueOnce(
				chainOf([{ id: 'm1', name: 'Ava', createdAt: new Date('2026-05-18T10:00:00.000Z') }]),
			)
			.mockImplementation(() => chainRejecting(new Error('unrelated export table unavailable')));

		const res = await GET(
			new NextRequest(
				`https://mana.test/api/wg/${E2E_EXISTING_WG.shareCode}/export?format=csv&section=members`,
				{
					headers: {
						[MEMBER_ID_HEADER]: E2E_EXISTING_WG.member.id,
					},
				},
			),
			{ params: Promise.resolve({ code: E2E_EXISTING_WG.shareCode }) },
		);

		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
		expect(res.headers.get('content-disposition')).toBe(
			`attachment; filename="${E2E_EXISTING_WG.shareCode}-members.csv"`,
		);
		await expect(res.text()).resolves.toBe('id,name,createdAt\nm1,Ava,2026-05-18T10:00:00.000Z');
		expect(routeDb.select).toHaveBeenCalledTimes(1);
	});

	it('RED BUG-271: fails the export when audit rows cannot be loaded', async () => {
		routeDb.select
			.mockReturnValueOnce(
				chainOf([{ id: 'm1', name: 'Ava', createdAt: new Date('2026-05-18T10:00:00.000Z') }]),
			)
			.mockReturnValueOnce(chainOf([]))
			.mockReturnValueOnce(chainOf([]))
			.mockReturnValueOnce(chainOf([]))
			.mockReturnValueOnce(chainOf([]))
			.mockReturnValueOnce(chainOf([]))
			.mockReturnValueOnce(chainOf([]))
			.mockReturnValueOnce(chainRejecting(new Error('audit table unavailable')));

		const res = await GET(
			new NextRequest(`https://mana.test/api/wg/${E2E_EXISTING_WG.shareCode}/export`),
			{ params: Promise.resolve({ code: E2E_EXISTING_WG.shareCode }) },
		);

		expect(res.status).toBe(500);
	});
});
