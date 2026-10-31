// Account deletion confirmation UI (fixture lane).
// Why: the UI must report the true server outcome (200/202/unconfirmed/pre-commit failure) and never claim a failed or pending deletion as done.

import { expect, test } from '@playwright/test';
import { mockNoWgs } from './support/helpers';

async function openConfirmation(page: import('@playwright/test').Page) {
	await mockNoWgs(page);
	await page.goto('/');
	await page.getByRole('button', { name: 'Konto dauerhaft löschen' }).click();
	await page.getByLabel('Tippe LÖSCHEN').fill('LÖSCHEN');
}

/**
 * The pending notice as the page announces it. Next streams the entry page's Suspense content
 * into a hidden segment before React reveals it, so for a moment the text exists twice in the
 * DOM; a role query only sees the rendered, accessible copy.
 */
function pendingNotice(page: import('@playwright/test').Page) {
	return page
		.getByRole('status')
		.filter({ hasText: /ManaWG hat deine Zugänge zu allen WGs entfernt/ });
}

function fulfillDeletion(page: import('@playwright/test').Page, status: number) {
	return page.route('**/api/account', (route) =>
		route.request().method() === 'DELETE'
			? route.fulfill({
					status,
					contentType: 'application/json',
					body: JSON.stringify({ status: status === 202 ? 'pending' : 'completed' }),
				})
			: route.continue(),
	);
}

test('HTTP 200 signs out and returns to the entry page', async ({ page }) => {
	await fulfillDeletion(page, 200);
	await openConfirmation(page);
	await page.getByRole('button', { name: 'Konto löschen', exact: true }).click();
	await expect(page).toHaveURL('/');
	await expect(page.getByText(/ManaWG hat deine Zugänge zu allen WGs entfernt/)).toHaveCount(0);
});

test('HTTP 202 signs out and announces that Auth deletion is pending', async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 720 });
	await page.emulateMedia({ colorScheme: 'dark' });
	await fulfillDeletion(page, 202);
	await openConfirmation(page);
	await page.getByRole('button', { name: 'Konto löschen', exact: true }).click();
	await expect(page).toHaveURL(/accountDeletion=pending/);
	await expect(pendingNotice(page)).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
});

test('an unconfirmed server outcome is disclosed without claiming deletion failed', async ({
	page,
}) => {
	await page.route('**/api/account', (route) =>
		route.request().method() === 'DELETE'
			? route.fulfill({
					status: 503,
					contentType: 'application/json',
					body: JSON.stringify({
						status: 'unknown',
						error: 'account_deletion_outcome_unconfirmed',
					}),
				})
			: route.continue(),
	);
	await openConfirmation(page);
	await page.getByRole('button', { name: 'Konto löschen', exact: true }).click();
	await expect(page.getByText(/Der Server kann den Status nicht bestätigen/)).toBeVisible();
	await expect(page).toHaveURL('/');
	await expect(page.getByRole('button', { name: 'Konto löschen', exact: true })).toBeEnabled();
});

test('a pre-commit server failure stays in the confirmation dialog', async ({ page }) => {
	await fulfillDeletion(page, 503);
	await openConfirmation(page);
	await page.getByRole('button', { name: 'Konto löschen', exact: true }).click();
	await expect(
		page.getByText('Konto konnte nicht gelöscht werden. Bitte versuche es später erneut.'),
	).toBeVisible();
	await expect(page).toHaveURL('/');
});

test('localStorage removal failure does not turn an accepted deletion into an error', async ({
	page,
}) => {
	await page.setViewportSize({ width: 320, height: 720 });
	await page.emulateMedia({ colorScheme: 'light' });
	await page.addInitScript(() => {
		const removeItem = Storage.prototype.removeItem;
		Storage.prototype.removeItem = function (key: string) {
			if (key.startsWith('manawg')) throw new DOMException('Storage unavailable', 'SecurityError');
			return removeItem.call(this, key);
		};
	});
	await fulfillDeletion(page, 202);
	await openConfirmation(page);
	await page.getByRole('button', { name: 'Konto löschen', exact: true }).click();
	await expect(page).toHaveURL(/accountDeletion=pending/);
	await expect(pendingNotice(page)).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
});

for (const status of [200, 202]) {
	test(`a delayed HTTP ${status} deletion never signs out or clears the next account`, async ({
		page,
		context,
	}) => {
		await openConfirmation(page);
		await page.evaluate(() => localStorage.setItem('manawg_account', 'account-A'));
		const otherTab = await context.newPage();
		await otherTab.goto('/login');
		let release!: () => void;
		let started!: () => void;
		let finished!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const requestStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		const requestFinished = new Promise<void>((resolve) => {
			finished = resolve;
		});
		let signOutCalls = 0;
		page.on('request', (request) => {
			if (new URL(request.url()).pathname === '/api/auth/sign-out') signOutCalls += 1;
		});
		await page.route('**/api/account', async (route) => {
			if (route.request().method() !== 'DELETE') return route.continue();
			started();
			await gate;
			await route
				.fulfill({ status, json: { status: status === 202 ? 'pending' : 'completed' } })
				.catch(() => undefined)
				.finally(finished);
		});
		try {
			await page.getByRole('button', { name: 'Konto löschen', exact: true }).click();
			await requestStarted;
			await otherTab.evaluate(() => {
				localStorage.setItem('manawg_account', 'account-B');
				localStorage.setItem('manawg:scope-B', 'keep');
			});
			release();
			await requestFinished;
			await page.waitForLoadState('networkidle');
			expect(signOutCalls).toBe(0);
			expect(await otherTab.evaluate(() => localStorage.getItem('manawg_account'))).toBe(
				'account-B',
			);
			expect(await otherTab.evaluate(() => localStorage.getItem('manawg:scope-B'))).toBe('keep');
			await expect(page).toHaveURL('/');
		} finally {
			release();
			await otherTab.close();
		}
	});
}
