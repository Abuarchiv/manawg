import { type Page, expect, test } from '@playwright/test';
import { E2E_CREATED_WG, buildE2EDashboardData } from '../src/core/infra/e2e-db-down';
import { dismissOnboarding, navigateToFeature } from './_helpers';

const FIXTURE = {
	...E2E_CREATED_WG,
	name: 'Smoke Test WG',
	memberName: 'Smoke Tester',
} as const;

async function fulfillJson(route: Parameters<Parameters<Page['route']>[1]>[0], body: unknown) {
	await route.fulfill({
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify(body),
	});
}

test.describe('Fixture launch flow', () => {
	test.setTimeout(180_000);

	test('creates a WG, shows the invite step, and opens the dashboard tiles', async ({ page }) => {
		await page.addInitScript(({ id: wgId, member: { id: memberId }, memberName }) => {
			localStorage.clear();
			localStorage.setItem(
				`manawg_identity:${wgId}`,
				JSON.stringify({ memberId, name: memberName, memberToken: 'fixture-member-token' }),
			);
		}, FIXTURE);

		await page.route('**/api/wg/mine', async (route) => {
			expect(route.request().method()).toBe('GET');
			await fulfillJson(route, { wgs: [] });
		});
		await page.route('**/api/wg', async (route) => {
			expect(route.request().method()).toBe('POST');
			expect(JSON.parse(route.request().postData() ?? '{}')).toEqual({
				name: FIXTURE.name,
				creatorName: FIXTURE.memberName,
			});
			await fulfillJson(route, {
				wg: { id: FIXTURE.id, shareCode: FIXTURE.shareCode, name: FIXTURE.name },
				creator: { id: FIXTURE.member.id, name: FIXTURE.memberName },
			});
		});
		await page.route(`**/api/wg/${FIXTURE.shareCode}`, async (route) => {
			expect(route.request().method()).toBe('GET');
			await fulfillJson(route, {
				wg: {
					id: FIXTURE.id,
					name: FIXTURE.name,
					shareCode: FIXTURE.shareCode,
					joiningEnabled: true,
				},
				members: [{ ...FIXTURE.member, name: FIXTURE.memberName }],
				currentMember: { memberId: FIXTURE.member.id, name: FIXTURE.memberName },
			});
		});
		await page.route(`**/api/wg/${FIXTURE.shareCode}/members`, async (route) => {
			expect(route.request().method()).toBe('GET');
			await fulfillJson(route, {
				members: [{ ...FIXTURE.member, name: FIXTURE.memberName }],
				viewerIsAdmin: false,
			});
		});
		await page.route(`**/api/wg/${FIXTURE.shareCode}/dashboard`, async (route) => {
			expect(route.request().method()).toBe('GET');
			expect(route.request().headers()['x-manawg-member-id']).toBe(FIXTURE.member.id);
			await fulfillJson(route, buildE2EDashboardData(FIXTURE.shareCode));
		});
		await page.route(`**/api/wg/${FIXTURE.shareCode}/chat/unread-count`, async (route) => {
			expect(route.request().method()).toBe('GET');
			await fulfillJson(route, { count: 0 });
		});

		await navigateToFeature(page, '/neu?action=create');
		await expect(page.getByRole('heading', { name: 'Neue WG erstellen' })).toBeVisible();
		await page.getByLabel('WG-Name').fill(FIXTURE.name);
		await page.getByLabel('Dein Anzeigename').fill(FIXTURE.memberName);
		await page.getByRole('button', { name: /^WG erstellen$/i }).click();

		await expect(page.getByRole('heading', { name: 'Mitbewohner einladen' })).toBeVisible();
		await expect(page.getByText(`${FIXTURE.name} ist live.`)).toBeVisible();
		await expect(
			page.getByRole('button', { name: `Code ${FIXTURE.shareCode} kopieren` }),
		).toBeVisible();

		const dashboardResponse = page.waitForResponse(
			(response) =>
				response.url().endsWith(`/api/wg/${FIXTURE.shareCode}/dashboard`) &&
				response.status() === 200,
		);
		await page.getByRole('button', { name: 'Später → direkt zur WG' }).click();
		await page.waitForURL(`/wg/${FIXTURE.shareCode}`);
		await dashboardResponse;
		await dismissOnboarding(page);
		await expect(page.getByRole('heading', { name: FIXTURE.name })).toBeVisible();

		const modules = page.getByRole('region', { name: 'Module' });
		for (const label of ['Ausgaben', 'Einkauf', 'Putzen', 'Pinnwand']) {
			await expect(modules.getByRole('link', { name: new RegExp(`^${label}\\b`) })).toBeVisible();
		}
	});
});
