/**
 * Real-database integration test for the GDPR/data-export route.
 *
 * `export.test.ts` (formatting helpers) and the route's own `route.test.ts`
 * both mock `@/core/db`, so a schema change (renamed/added column) that isn't
 * reflected in the export route's select statements would only be caught by
 * a user noticing missing data in their export. This test seeds one row per
 * exportable entity into a real database, hits the actual GET handler, and
 * asserts every section's fields round-trip in the export payload.
 *
 * Skipped unless POSTGRES_URL/DATABASE_URL is set — see
 * `route.integration.test.ts` (apps/web/src/app/api/wg) for how the
 * `db-integration` CI job activates this file.
 */
import { generateShareCode } from '@/shared/lib/share-code';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }));

vi.mock('@/core/auth/server', () => ({
	getAuthenticatedUser: (...args: unknown[]) => authMock.getAuthenticatedUser(...args),
}));

const hasRealDb = Boolean(process.env.POSTGRES_URL || process.env.DATABASE_URL);
const AUTH_USER_ID = 'b827e8e7-d6dd-464d-af89-28ddb7911565';

describe.skipIf(!hasRealDb)('GET /api/wg/[code]/export (real database)', () => {
	let wgId: string;
	let shareCode: string;
	let memberId: string;

	beforeAll(async () => {
		authMock.getAuthenticatedUser.mockResolvedValue({ id: AUTH_USER_ID });
		const {
			db,
			wgs,
			wgMembers,
			expenses,
			expenseSplits,
			recurringExpenses,
			shoppingItems,
			chores,
			memberAbsences,
			announcements,
			auditEvents,
		} = await import('@/core/db');

		// Must be a valid share code (Crockford base32 minus look-alikes) — an
		// ad-hoc uppercased UUID slice can contain '0'/'1', which `isValidShareCode`
		// rejects, and `readShareCode` in the route preamble runs before auth, so
		// an invalid code here fails the whole request with 400 before ever
		// touching membership/db logic.
		shareCode = generateShareCode();
		const [wg] = await db.insert(wgs).values({ name: 'Export-Test-WG', shareCode }).returning();
		if (!wg) throw new Error('failed to seed wg');
		wgId = wg.id;

		const [member] = await db
			.insert(wgMembers)
			.values({ wgId, name: 'Export Tester', authUserId: AUTH_USER_ID })
			.returning();
		if (!member) throw new Error('failed to seed member');
		memberId = member.id;

		const [expense] = await db
			.insert(expenses)
			.values({
				wgId,
				paidByMemberId: memberId,
				amountCents: 4200,
				description: 'Integrationstest-Ausgabe',
			})
			.returning();
		if (!expense) throw new Error('failed to seed expense');

		await db.insert(expenseSplits).values({
			expenseId: expense.id,
			debtorMemberId: memberId,
			amountCents: 4200,
		});

		await db.insert(recurringExpenses).values({
			wgId,
			createdByMemberId: memberId,
			paidByMemberId: memberId,
			description: 'Integrationstest-Fixkosten',
			amountCents: 999,
			nextDueAt: new Date(),
			splitsJson: JSON.stringify([{ debtorMemberId: memberId, amountCents: 999 }]),
		});

		await db.insert(shoppingItems).values({
			wgId,
			addedByMemberId: memberId,
			name: 'Integrationstest-Einkauf',
		});

		await db.insert(chores).values({
			wgId,
			title: 'Integrationstest-Putzplan',
			assignedMemberId: memberId,
		});

		await db.insert(memberAbsences).values({
			wgId,
			memberId,
			startDate: new Date(),
			endDate: new Date(Date.now() + 86_400_000),
			reason: 'Integrationstest-Abwesenheit',
		});

		await db.insert(announcements).values({
			wgId,
			authorMemberId: memberId,
			content: 'Integrationstest-Pinnwand',
		});

		await db.insert(auditEvents).values({
			wgId,
			memberId,
			eventType: 'test.seeded',
			entityType: 'test',
			summary: 'Integrationstest-Audit',
		});
	});

	afterAll(async () => {
		const { db, wgs } = await import('@/core/db');
		const { eq } = await import('drizzle-orm');
		// Deleting `wgs` alone is enough: every dependent table's `wgId` FK
		// cascades from `wgs.id`, including `wgMembers`. Deleting `wgMembers`
		// directly (as a separate, earlier statement) is wrong here — outrunning
		// that cascade — because `announcements.authorMemberId` references
		// `wgMembers.id` with `onDelete: 'restrict'`, so a member row with a
		// still-existing announcement cannot be deleted directly, only via the
		// wg-level cascade that removes both in the right order.
		await db.delete(wgs).where(eq(wgs.id, wgId));
	});

	it('round-trips one row per exportable section', async () => {
		const { GET } = await import('../../app/api/wg/[code]/export/route');

		const req = new NextRequest(`https://mana.test/api/wg/${shareCode}/export?format=json`);
		const res = await GET(req, { params: Promise.resolve({ code: shareCode }) });
		expect(res.status).toBe(200);
		const data = await res.json();

		expect(data.wg).toEqual({ name: 'Export-Test-WG', shareCode });
		expect(data.sections.members).toHaveLength(1);
		expect(data.sections.members[0].name).toBe('Export Tester');

		expect(data.sections.expenses).toHaveLength(1);
		expect(data.sections.expenses[0]).toMatchObject({
			description: 'Integrationstest-Ausgabe',
			amountCents: 4200,
			paidBy: 'Export Tester',
		});
		expect(data.sections.expenses[0].splits).toEqual([
			expect.objectContaining({ debtor: 'Export Tester', amountCents: 4200 }),
		]);

		expect(data.sections.recurringExpenses).toHaveLength(1);
		expect(data.sections.recurringExpenses[0]).toMatchObject({
			description: 'Integrationstest-Fixkosten',
			amountCents: 999,
			paidBy: 'Export Tester',
		});

		expect(data.sections.shoppingItems).toHaveLength(1);
		expect(data.sections.shoppingItems[0]).toMatchObject({
			name: 'Integrationstest-Einkauf',
			status: 'offen',
		});

		expect(data.sections.chores).toHaveLength(1);
		expect(data.sections.chores[0]).toMatchObject({
			title: 'Integrationstest-Putzplan',
			assignedName: 'Export Tester',
		});

		expect(data.sections.absences).toHaveLength(1);
		expect(data.sections.absences[0]).toMatchObject({
			memberName: 'Export Tester',
			reason: 'Integrationstest-Abwesenheit',
		});

		expect(data.sections.announcements).toHaveLength(1);
		expect(data.sections.announcements[0]).toMatchObject({
			content: 'Integrationstest-Pinnwand',
			authorName: 'Export Tester',
		});

		expect(data.sections.auditEvents).toHaveLength(1);
		expect(data.sections.auditEvents[0]).toMatchObject({
			eventType: 'test.seeded',
			memberName: 'Export Tester',
			summary: 'Integrationstest-Audit',
		});
	});
});
