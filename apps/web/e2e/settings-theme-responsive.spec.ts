import { expect, test } from '@playwright/test';
import { FIXTURE_WG, navigateToFeature, setupMember } from './_helpers';

test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');
test.use({ viewport: { width: 320, height: 720 }, bypassCSP: true });

test('all theme choices stay reachable at 320px with 200% text', async ({ page }) => {
	await setupMember(page);
	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen`);
	await expect(page.getByRole('button', { name: 'System', exact: true })).toBeVisible();
	await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
	expect(await page.locator('html').evaluate((element) => getComputedStyle(element).fontSize)).toBe(
		'32px',
	);
	for (const tab of await page.getByRole('tab').all()) {
		const box = await tab.boundingBox();
		expect(box?.width).toBeGreaterThanOrEqual(120);
	}

	for (const name of ['Hell', 'Dunkel', 'System']) {
		const choice = page.getByRole('button', { name, exact: true });
		await expect(choice).toBeVisible();
		const box = await choice.boundingBox();
		if (!box) throw new Error(`${name} has no layout box`);
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(320);
	}
	for (const name of ['Hell', 'Dunkel', 'System']) {
		const choice = page.getByRole('button', { name, exact: true });
		await choice.click();
		await expect(choice).toHaveAttribute('aria-pressed', 'true');
		if (name === 'Dunkel') await expect(page.locator('html')).toHaveClass(/dark/);
		if (name === 'Hell') await expect(page.locator('html')).not.toHaveClass(/dark/);
	}
});

test('admin can rename the WG from the profile tab and sees API failures', async ({ page }) => {
	await setupMember(page);
	await page.route('**/api/wg/*/members', (route) =>
		route.fulfill({
			json: {
				members: [
					{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName, color: '#6d5efc', active: true },
				],
				viewerIsAdmin: true,
			},
		}),
	);
	let status = 500;
	let sentName: string | undefined;
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}`, (route) => {
		if (route.request().method() !== 'PATCH') return route.fallback();
		sentName = route.request().postDataJSON().name;
		return route.fulfill({ status, json: { wg: { name: sentName } } });
	});
	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen`);
	const name = page.getByLabel('Name eurer WG');
	const save = page.getByRole('button', { name: 'Speichern', exact: true });
	await expect(save).toBeDisabled();
	await name.fill('  Neue WG ');
	await save.click();
	await expect(page.getByText(/nicht umbenannt werden/)).toBeVisible();
	await expect(name).toHaveValue('  Neue WG ');
	status = 200;
	await name.press('Enter');
	await expect(page.getByText('WG-Name gespeichert.')).toBeVisible();
	expect(sentName).toBe('Neue WG');
});
