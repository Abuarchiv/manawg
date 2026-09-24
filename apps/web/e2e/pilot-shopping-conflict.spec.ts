import { randomUUID } from 'node:crypto';
import { type Page, expect, test } from '@playwright/test';
import { DrizzleQueryError } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../src/core/db/schema';
import { isOpenShoppingItemDuplicate } from '../src/features/shopping/shopping-duplicate';
import {
	clearBoughtErrorMessage,
	shoppingAddErrorMessage,
} from '../src/features/shopping/shopping-errors';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

const testDatabaseUrl = process.env.PILOT_SHOPPING_DATABASE_URL?.trim() ?? '';

function localTestDatabaseUrl(): string {
	if (!testDatabaseUrl) {
		test.skip(true, 'Set PILOT_SHOPPING_DATABASE_URL to an isolated local PostgreSQL database.');
	}
	const hostname = new URL(testDatabaseUrl).hostname.toLowerCase();
	expect(['localhost', '127.0.0.1', '::1']).toContain(hostname);
	return testDatabaseUrl;
}

test('recognizes a duplicate open shopping item through DrizzleQueryError.cause', () => {
	const postgresError = Object.assign(new Error('duplicate key value violates unique constraint'), {
		code: '23505',
		constraint: 'shopping_items_unique_open_name',
	});
	const wrapped = new DrizzleQueryError('insert into shopping_items ...', [], postgresError);

	expect(isOpenShoppingItemDuplicate(wrapped)).toBe(true);
});

test('explains an existing open item without merging its quantity', () => {
	expect(shoppingAddErrorMessage('shopping_item_duplicate')).toBe(
		'Dieser Artikel steht bereits offen auf der Einkaufsliste. Prüfe den vorhandenen Eintrag; seine Menge bleibt unverändert.',
	);
});

test('explains that clearing bought items requires a WG admin', () => {
	expect(clearBoughtErrorMessage(403, 'not_admin')).toBe(
		'Nur Admins dürfen erledigte Artikel für die ganze WG entfernen.',
	);
});

async function mockShoppingPage(page: Page, viewerIsAdmin: boolean, deleteStatus = 200) {
	const { shareCode, memberId, memberName } = FIXTURE_WG;
	await page.route(`**/api/wg/${shareCode}/members*`, (route) =>
		route.fulfill({
			json: {
				members: [{ id: memberId, name: memberName, active: true }],
				viewerIsAdmin,
			},
		}),
	);
	await page.route(`**/api/wg/${shareCode}/shopping*`, (route) => {
		if (route.request().method() === 'DELETE') {
			return route.fulfill({
				status: deleteStatus,
				json: deleteStatus === 200 ? { deleted: 1 } : { error: 'not_admin' },
			});
		}
		return route.fulfill({
			json: {
				items: [
					{
						id: 'shopping-done',
						addedByMemberId: memberId,
						name: 'Kaffee',
						quantity: null,
						boughtAt: '2026-09-22T12:00:00.000Z',
						boughtByMemberId: memberId,
						createdAt: '2026-09-22T10:00:00.000Z',
					},
				],
			},
		});
	});
	await page.route(`**/api/wg/${shareCode}/inventory*`, (route) =>
		route.fulfill({ json: { items: [] } }),
	);
}

test('hides clearing bought items from non-admins', async ({ page }) => {
	test.skip(
		process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
		'requires the local fixture server',
	);
	await mockShoppingPage(page, false);
	await setupMember(page);
	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einkauf`);
	await dismissOnboarding(page);
	await page.getByText('Erledigt (1)', { exact: true }).click();
	await expect(page.getByRole('button', { name: 'Erledigte Artikel entfernen (1)' })).toHaveCount(
		0,
	);
});

test('explains the admin requirement when clear-bought returns 403', async ({ page }) => {
	test.skip(
		process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
		'requires the local fixture server',
	);
	await mockShoppingPage(page, true, 403);
	await setupMember(page);
	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einkauf`);
	await dismissOnboarding(page);
	await page.getByText('Erledigt (1)', { exact: true }).click();
	await page.getByRole('button', { name: 'Erledigte Artikel entfernen (1)' }).click();
	await page.getByRole('button', { name: 'Entfernen', exact: true }).click();
	await expect(
		page.getByText('Nur Admins dürfen erledigte Artikel für die ganze WG entfernen.'),
	).toBeVisible();
});

test('refreshes the list after a duplicate add and keeps the draft values', async ({ page }) => {
	test.skip(
		process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
		'requires the local fixture server',
	);
	const shareCode = 'MTE8PZAT';
	let getCalls = 0;
	let postCalls = 0;
	await page.route(`**/api/wg/${shareCode}/shopping*`, async (route) => {
		if (route.request().method() === 'GET') {
			getCalls += 1;
			return route.fulfill({
				json: {
					items:
						getCalls > 1
							? [
									{
										id: 'shopping-existing',
										addedByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
										name: 'Milch',
										quantity: '1 L',
										boughtAt: null,
										boughtByMemberId: null,
										createdAt: '2026-09-21T08:00:00.000Z',
									},
								]
							: [],
				},
			});
		}
		if (route.request().method() === 'POST') {
			postCalls += 1;
			return route.fulfill({ status: 409, json: { error: 'shopping_item_duplicate' } });
		}
		return route.continue();
	});

	await setupMember(page);
	await navigateToFeature(page, `/wg/${shareCode}/einkauf`);
	await dismissOnboarding(page);
	await page.getByLabel('Artikel-Name').fill('2 L Milch');
	await page.getByRole('button', { name: 'Artikel hinzufügen' }).click();

	await expect(
		page.getByText(
			'Dieser Artikel steht bereits offen auf der Einkaufsliste. Prüfe den vorhandenen Eintrag; seine Menge bleibt unverändert.',
		),
	).toBeVisible();
	await expect(page.locator('[data-shopping-row]')).toHaveCount(1);
	await expect(page.locator('[data-shopping-row]')).toContainText('Milch');
	await expect(page.getByLabel('Artikel-Name')).toHaveValue('2 L Milch');
	expect(postCalls).toBe(1);
	expect(getCalls).toBeGreaterThanOrEqual(2);
});

test('real PostgreSQL partial unique index rejects open duplicates and allows repurchase', async () => {
	const pool = new Pool({ connectionString: localTestDatabaseUrl(), max: 1 });
	const database = drizzle(pool, { schema });
	const suffix = randomUUID().replaceAll('-', '');
	let wgId: string | undefined;
	let secondWgId: string | undefined;
	const name = `Pilot shopping ${suffix}`;
	const normalizedVariant = `  ${name.toUpperCase()}  `;

	try {
		const wg = await pool.query<{ id: string }>(
			'INSERT INTO public.wgs (share_code, name) VALUES ($1, $2) RETURNING id',
			[`P${suffix.slice(0, 7)}`, `Pilot shopping ${suffix}`],
		);
		wgId = wg.rows[0]?.id;
		expect(wgId).toBeTruthy();
		const secondWg = await pool.query<{ id: string }>(
			'INSERT INTO public.wgs (share_code, name) VALUES ($1, $2) RETURNING id',
			[`Q${suffix.slice(0, 7)}`, `Pilot shopping second ${suffix}`],
		);
		secondWgId = secondWg.rows[0]?.id;
		expect(secondWgId).toBeTruthy();

		const member = await pool.query<{ id: string }>(
			'INSERT INTO public.wg_members (wg_id, name) VALUES ($1, $2) RETURNING id',
			[wgId, `Pilot member ${suffix}`],
		);
		const memberId = member.rows[0]?.id;
		expect(memberId).toBeTruthy();
		const secondMember = await pool.query<{ id: string }>(
			'INSERT INTO public.wg_members (wg_id, name) VALUES ($1, $2) RETURNING id',
			[secondWgId, `Pilot second member ${suffix}`],
		);
		const secondMemberId = secondMember.rows[0]?.id;
		expect(secondMemberId).toBeTruthy();

		const first = await database
			.insert(schema.shoppingItems)
			.values({ wgId, addedByMemberId: memberId, name, quantity: '1x' })
			.returning({ id: schema.shoppingItems.id });
		expect(first).toHaveLength(1);

		let duplicateError: unknown;
		try {
			await database
				.insert(schema.shoppingItems)
				.values({ wgId, addedByMemberId: memberId, name: normalizedVariant, quantity: '2x' })
				.returning({ id: schema.shoppingItems.id });
		} catch (error) {
			duplicateError = error;
		}
		expect(duplicateError).toBeInstanceOf(DrizzleQueryError);
		expect(duplicateError).toMatchObject({
			cause: { code: '23505', constraint: 'shopping_items_unique_open_name' },
		});
		expect(isOpenShoppingItemDuplicate(duplicateError)).toBe(true);

		await pool.query(
			'UPDATE public.shopping_items SET bought_at = now(), bought_by_member_id = $2 WHERE id = $1',
			[first[0]?.id, memberId],
		);
		const repurchase = await database
			.insert(schema.shoppingItems)
			.values({ wgId, addedByMemberId: memberId, name: normalizedVariant, quantity: '2x' })
			.returning({ id: schema.shoppingItems.id });
		expect(repurchase).toHaveLength(1);

		const otherWgItem = await database
			.insert(schema.shoppingItems)
			.values({
				wgId: secondWgId,
				addedByMemberId: secondMemberId,
				name: normalizedVariant,
				quantity: '1x',
			})
			.returning({ id: schema.shoppingItems.id });
		expect(otherWgItem).toHaveLength(1);

		const rows = await pool.query<{ count: number }>(
			' SELECT count(*)::int AS count FROM public.shopping_items WHERE wg_id = $1 AND normalized_name = lower(btrim($2))',
			[wgId, name],
		);
		expect(rows.rows[0]?.count).toBe(2);
	} finally {
		if (wgId) await pool.query('DELETE FROM public.wgs WHERE id = $1', [wgId]);
		if (secondWgId) await pool.query('DELETE FROM public.wgs WHERE id = $1', [secondWgId]);
		await pool.end();
	}
});
