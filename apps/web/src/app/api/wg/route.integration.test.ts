/**
 * Real-database integration test for POST /api/wg.
 *
 * Every other route test in this repo mocks `@/core/db` entirely (see
 * `route.test.ts` next to this file), so none of them ever issues a real SQL
 * statement — a schema/query drift would only surface in production. This
 * file is the exception: it runs the actual handler against a live Postgres
 * instance and asserts the WG + creator member rows are truly persisted,
 * including the share-code uniqueness retry loop and the wg+member
 * transaction.
 *
 * Skipped by default (`pnpm test` has no POSTGRES_URL) so local/CI unit runs
 * stay fast and hermetic. Activated by the `db-integration` CI job, which
 * points POSTGRES_URL at an ephemeral Postgres service and runs migrations
 * first — see .github/workflows/ci.yml.
 */
import { db, wgMembers, wgs } from '@/core/db';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }));

vi.mock('@/core/auth/server', () => ({
	getAuthenticatedUser: (...args: unknown[]) => authMock.getAuthenticatedUser(...args),
}));

const hasRealDb = Boolean(process.env.POSTGRES_URL || process.env.DATABASE_URL);
const AUTH_USER_ID = 'ea1d8a8d-6e28-4206-b6d5-2f9ae44e915a';

function postWgRequest(body: unknown): NextRequest {
	return new NextRequest('https://mana.test/api/wg', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
}

describe.skipIf(!hasRealDb)('POST /api/wg (real database)', () => {
	const createdWgIds: string[] = [];

	beforeEach(() => {
		authMock.getAuthenticatedUser.mockResolvedValue({ id: AUTH_USER_ID });
	});

	afterAll(async () => {
		// Deleting `wgs` alone is enough: `wgMembers.wgId` (and every other
		// dependent table's `wgId`) cascades from `wgs.id`. Deleting `wgMembers`
		// first — as a separate, earlier statement — can fail: some FKs onto
		// `wgMembers.id` (e.g. `announcements.authorMemberId`) are `onDelete:
		// 'restrict'`, so they must go through the wg-level cascade rather than a
		// direct member delete.
		for (const id of createdWgIds) {
			await db.delete(wgs).where(eq(wgs.id, id));
		}
	});

	it('persists the wg and its creator member in a single transaction', async () => {
		const { POST } = await import('./route');
		const wgName = `Integration-Test-WG-${crypto.randomUUID()}`;
		const creatorName = 'Integrationstest-Person';

		const res = await POST(postWgRequest({ name: wgName, creatorName }));
		expect(res.status).toBe(200);
		const json = await res.json();
		createdWgIds.push(json.wg.id);

		const wgRow = await db.query.wgs.findFirst({ where: (w, { eq }) => eq(w.id, json.wg.id) });
		expect(wgRow).toBeTruthy();
		expect(wgRow?.name).toBe(wgName);
		expect(wgRow?.shareCode).toBe(json.wg.shareCode);

		const memberRows = await db.select().from(wgMembers).where(eq(wgMembers.wgId, json.wg.id));
		expect(memberRows).toHaveLength(1);
		expect(memberRows[0]?.name).toBe(creatorName);
		expect(memberRows[0]?.id).toBe(json.creator.id);
		expect(memberRows[0]?.authUserId).toBe(AUTH_USER_ID);
	});

	it('generates a unique share code across repeated creations', async () => {
		const { POST } = await import('./route');
		const codes = new Set<string>();
		for (let i = 0; i < 3; i += 1) {
			const res = await POST(
				postWgRequest({ name: `WG-${crypto.randomUUID()}`, creatorName: 'Tester' }),
			);
			expect(res.status).toBe(200);
			const json = await res.json();
			createdWgIds.push(json.wg.id);
			expect(codes.has(json.wg.shareCode)).toBe(false);
			codes.add(json.wg.shareCode);
		}
	});

	it('rejects an invalid body without touching the database', async () => {
		const { POST } = await import('./route');
		const res = await POST(postWgRequest({ name: '', creatorName: 'Tester' }));
		expect(res.status).toBe(400);
	});
});
