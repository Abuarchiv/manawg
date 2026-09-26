import { type Page, expect, test } from '@playwright/test';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

const { shareCode } = FIXTURE_WG;

async function mockChoresRoute(page: Page): Promise<void> {
	await page.route(`**/api/wg/${shareCode}/chores`, (route) =>
		route.fulfill({ json: { chores: [] } }),
	);
}

// WCAG 2.2 / Material 3 predictable navigation: the Android/browser back
// gesture must close an open overlay instead of leaving the page.
test('browser back closes an open drawer instead of leaving the page', async ({ page }) => {
	await setupMember(page);
	await mockChoresRoute(page);
	await page.setViewportSize({ width: 320, height: 640 });
	await navigateToFeature(page, `/wg/${shareCode}/putzen`);
	await dismissOnboarding(page);

	const trigger = page.getByRole('button', { name: 'Putzaufgabe erfassen', exact: true });
	await trigger.click();
	const drawer = page.getByRole('dialog');
	await expect(drawer).toBeVisible();

	await page.goBack();

	expect(new URL(page.url()).pathname).toBe(`/wg/${shareCode}/putzen`);
	await expect(drawer).toBeHidden();
	await expect(trigger).toBeFocused();
});

test('browser back closes an open alert dialog instead of leaving the page', async ({ page }) => {
	await setupMember(page);
	await page.setViewportSize({ width: 320, height: 640 });
	await navigateToFeature(page, `/wg/${shareCode}/einstellungen#zugang`);
	await dismissOnboarding(page);

	const trigger = page.getByRole('button', { name: 'Komplette WG für alle löschen' });
	await trigger.click();
	const alertDialog = page.getByRole('alertdialog', { name: 'WG dauerhaft löschen?' });
	await expect(alertDialog).toBeVisible();

	await page.goBack();

	expect(new URL(page.url()).pathname).toBe(`/wg/${shareCode}/einstellungen`);
	await expect(alertDialog).toBeHidden();
	await expect(trigger).toBeFocused();
});
