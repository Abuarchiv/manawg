// System Back after a form that a ?new=1 shortcut link opened.
// Why: the open form and its discard confirmation each own a history entry; closing them and
// dropping the parameter must not leave a ?new=1 entry behind that reopens the empty form.

import { expect, type Page, test } from '@playwright/test';
import { API, expense, mockReads } from './support/expense-idempotency';
import {
	dismissOnboarding,
	FIXTURE_WG,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

skipUnlessFixtures();

const BASE = `/wg/${FIXTURE_WG.shareCode}`;
const BEFORE = `${BASE}/chores`;

/** Opens the shortcut link from the chores page, so the entry before it is known. */
async function openShortcut(page: Page): Promise<void> {
	await setupMember(page);
	await mockReads(page);
	await page.route(`**${API}/chores`, (route) => route.fulfill({ json: { chores: [] } }));
	await navigateToFeature(page, BEFORE);
	await dismissOnboarding(page);
	await page.goto(`${BASE}/expenses?new=1`, { waitUntil: 'domcontentloaded' });
	await dismissOnboarding(page);
	await expect(page.getByRole('dialog')).toBeVisible();
}

/** Waits until the closed overlays have given their marker entries back. */
async function expectNoMarkerEntry(page: Page): Promise<void> {
	await expect.poll(() => page.evaluate(() => window.history.state?.overlayId ?? null)).toBeNull();
	await expect(page).not.toHaveURL(/new=1/);
}

async function expectBackLeavesTheExpenses(page: Page): Promise<void> {
	await page.goBack();
	await expect(page).toHaveURL(new RegExp(`${BEFORE}$`));
	await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('system back after discarding a shortcut form does not reopen it', async ({ page }) => {
	await openShortcut(page);
	const form = page.getByRole('dialog');
	await form.getByLabel('Beschreibung').fill('Wocheneinkauf');
	await form.getByRole('button', { name: 'Ausgabe abbrechen' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Entwurf verwerfen' }).click();
	await expect(form).toBeHidden();
	await expectNoMarkerEntry(page);

	await expectBackLeavesTheExpenses(page);
});

test('system back after saving a shortcut form does not reopen it', async ({ page }) => {
	await openShortcut(page);
	let created = false;
	await mockReads(page, [], () => (created ? [expense('created-expense', 'Wocheneinkauf')] : []));
	await page.route(`**${API}/expenses`, (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		created = true;
		return route.fulfill({
			json: { expense: expense('created-expense', 'Wocheneinkauf'), warning: null },
		});
	});
	const form = page.getByRole('dialog');
	await form.getByLabel('Beschreibung').fill('Wocheneinkauf');
	await form.getByLabel('Betrag').fill('12,35');
	await form.getByRole('button', { name: 'Ausgabe speichern' }).click();
	await expect(form).toBeHidden();
	await expectNoMarkerEntry(page);

	await expectBackLeavesTheExpenses(page);
});

test('system back after cancelling an untouched shortcut form does not reopen it', async ({
	page,
}) => {
	await openShortcut(page);
	await page.getByRole('dialog').getByRole('button', { name: 'Ausgabe abbrechen' }).click();
	await expect(page.getByRole('dialog')).toBeHidden();
	await expectNoMarkerEntry(page);

	await expectBackLeavesTheExpenses(page);
});

test('system back after discarding on a slow device does not reopen the form', async ({ page }) => {
	await openShortcut(page);
	// A slow device commits the router's URL change late; Back must still skip the ?new=1 entry.
	await page.evaluate(() => {
		const replaceState = history.replaceState.bind(history);
		history.replaceState = (...args) => {
			setTimeout(() => replaceState(...args), 300);
		};
	});
	const form = page.getByRole('dialog');
	await form.getByLabel('Beschreibung').fill('Wocheneinkauf');
	await form.getByRole('button', { name: 'Ausgabe abbrechen' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Entwurf verwerfen' }).click();
	await expect(form).toBeHidden();
	await expectNoMarkerEntry(page);

	await expectBackLeavesTheExpenses(page);
});
