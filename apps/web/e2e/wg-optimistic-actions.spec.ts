import { expect, test } from '@playwright/test';
import { dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');
test.use({ hasTouch: true, isMobile: true });

const SHARE_CODE = 'MTE8PZAT';
const CHORE_ID = 'chore-bath';

test('failed chore completion rolls back the row and shows its dialog error', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
	await setupMember(page);

	const chore = {
		id: CHORE_ID,
		title: 'Bad putzen',
		intervalDays: 7,
		recurrenceType: 'days',
		nextDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
		assignedMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
		lastCompletedAt: null,
		lastCompletedByName: null,
		openGapCountForAssignee: 0,
	};
	let startFailure: () => void = () => {};
	let releaseFailure: () => void = () => {};
	const failureStarted = new Promise<void>((resolve) => {
		startFailure = resolve;
	});
	const failureGate = new Promise<void>((resolve) => {
		releaseFailure = resolve;
	});

	await page.route(`**/api/wg/${SHARE_CODE}/chores`, (route) =>
		route.fulfill({ json: { chores: [chore], monthCompletions: {} } }),
	);
	await page.route(`**/api/wg/${SHARE_CODE}/absences`, (route) =>
		route.fulfill({ json: { absences: [] } }),
	);
	await page.route(`**/api/wg/${SHARE_CODE}/chores/${CHORE_ID}/complete`, async (route) => {
		startFailure();
		await failureGate;
		return route.fulfill({ status: 500, json: { error: 'completion_insert_failed' } });
	});

	await navigateToFeature(page, `/wg/${SHARE_CODE}/putzen`);
	await dismissOnboarding(page);
	await page.getByRole('button', { name: 'Als erledigt markieren: Bad putzen' }).click();
	await page.getByRole('button', { name: 'Erledigt bestätigen: Bad putzen' }).click();
	await failureStarted;

	const row = page.locator(`#chore-${CHORE_ID}`);
	try {
		await expect(row).toHaveCount(0);
	} finally {
		releaseFailure();
	}

	await expect(row).toBeVisible();
	await expect(page.getByRole('alertdialog').getByRole('alert')).toContainText(
		'Erledigt-Aktion konnte nicht vollständig gespeichert werden: Lade den Plan neu und prüfe den Verlauf.',
	);
});
