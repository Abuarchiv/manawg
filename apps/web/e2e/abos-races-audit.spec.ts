import { expect, test } from '@playwright/test';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

const ENCODED = encodeURIComponent(FIXTURE_WG.shareCode);
const ABO_ID = 'a1ef32d5-d40a-4df2-9977-7684dce7df3f';

function recurringFixture(overrides: Partial<ReturnType<typeof recurringFixtureBase>> = {}) {
	return { ...recurringFixtureBase(), ...overrides };
}

function recurringFixtureBase() {
	return {
		id: ABO_ID,
		wgId: FIXTURE_WG.id,
		createdByMemberId: FIXTURE_WG.memberId,
		paidByMemberId: FIXTURE_WG.memberId,
		description: 'Internet',
		amountCents: 3290,
		intervalMonths: 1,
		nextDueAt: new Date(Date.now() + 86_400_000).toISOString(),
		lastCreatedAt: null,
		pausedAt: null as string | null,
		createdAt: new Date().toISOString(),
		splits: [{ debtorMemberId: FIXTURE_WG.memberId, amountCents: 3290 }],
	};
}

async function setupAbos(page: Parameters<typeof test>[0]['page']) {
	await setupMember(page);
	let abo: ReturnType<typeof recurringFixture> | null = recurringFixture();
	let patchCount = 0;
	let deleteCount = 0;

	await page.route(`**/api/wg/${ENCODED}/recurring-expenses`, async (route) => {
		if (route.request().method() === 'GET') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpenses: abo ? [abo] : [] }),
			});
			return;
		}
		await route.fallback();
	});

	await page.route(`**/api/wg/${ENCODED}/recurring-expenses/${ABO_ID}`, async (route) => {
		const method = route.request().method();
		await new Promise((resolve) => setTimeout(resolve, 350));
		if (method === 'PATCH') {
			patchCount += 1;
			const payload = JSON.parse(route.request().postData() ?? '{}');
			abo = Object.hasOwn(payload, 'paused')
				? recurringFixture({ pausedAt: payload.paused ? new Date().toISOString() : null })
				: recurringFixture({ ...payload });
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ recurringExpense: abo }),
			});
			return;
		}
		if (method === 'DELETE') {
			deleteCount += 1;
			abo = null;
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ deleted: true }),
			});
			return;
		}
		await route.fallback();
	});

	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/abos`);
	await dismissOnboarding(page);
	await expect(page.locator('li', { hasText: 'Internet' })).toBeVisible({ timeout: 30_000 });

	return {
		getPatchCount: () => patchCount,
		getDeleteCount: () => deleteCount,
	};
}

test('rapid pause clicks send only one PATCH', async ({ page }) => {
	const counters = await setupAbos(page);
	await page.getByRole('button', { name: 'Internet pausieren' }).dblclick();
	await expect(page.getByText('Abo pausiert.')).toBeVisible();
	expect(counters.getPatchCount()).toBe(1);
});

test('rapid edit submits send only one PATCH', async ({ page }) => {
	const counters = await setupAbos(page);
	await page.getByRole('button', { name: 'Internet bearbeiten' }).click();
	await page.locator('#abo-description').fill('Internet Plus');
	await page.getByRole('button', { name: 'Speichern' }).dblclick();
	await expect(page.getByText('Abo aktualisiert.')).toBeVisible();
	expect(counters.getPatchCount()).toBe(1);
});

test('rapid delete confirmations send only one DELETE', async ({ page }) => {
	const counters = await setupAbos(page);
	await page.getByRole('button', { name: 'Internet löschen' }).click();
	const confirmButton = page
		.getByRole('dialog')
		.getByRole('button', { name: 'Löschen', exact: true });
	await confirmButton.dblclick();
	await expect(page.getByText('Abo gelöscht.')).toBeVisible();
	expect(counters.getDeleteCount()).toBe(1);
});
