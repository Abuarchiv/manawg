import { expect, test } from '@playwright/test';
import { FIXTURE_AUTH_USER_ID } from '../src/fixtures/data';
import { FIXTURE_WG, navigateToFeature, setupMember, skipUnlessFixtures } from './support/helpers';

test.describe('export request ownership', () => {
	skipUnlessFixtures();

	for (const format of ['json', 'csv'] as const) {
		test(`does not download a delayed ${format} export after an account switch`, async ({
			page,
			context,
		}) => {
			await setupMember(page);
			await page.addInitScript(() => {
				document.addEventListener('click', (event) => {
					const target = event.target;
					if (
						target instanceof HTMLAnchorElement &&
						target.href.startsWith('blob:') &&
						target.download
					) {
						sessionStorage.setItem('test:export-clicked', target.download);
					}
				});
			});
			await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/settings#data`);
			await expect(page.getByLabel('CSV-Bereich')).toBeVisible();
			await expect
				.poll(() => page.evaluate(() => localStorage.getItem('manawg_account')))
				.toBe(FIXTURE_AUTH_USER_ID);
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
			const downloads: string[] = [];
			page.on('download', (download) => downloads.push(download.suggestedFilename()));
			await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/export*`, async (route) => {
				if (new URL(route.request().url()).searchParams.has('summary')) return route.continue();
				started();
				await gate;
				await route
					.fulfill({
						contentType: format === 'json' ? 'application/json' : 'text/csv',
						body: format === 'json' ? '{"owner":"account-A"}' : 'owner\naccount-A\n',
					})
					.catch(() => undefined)
					.finally(finished);
			});
			await page.route(`**/api/wg/${FIXTURE_WG.shareCode}`, (route) =>
				route.fulfill({ status: 503, json: { error: 'server_error' } }),
			);
			try {
				await page
					.getByRole('button', {
						name:
							format === 'json' ? 'WG-Daten als JSON exportieren' : 'Ausgaben als CSV exportieren',
						exact: true,
					})
					.click();
				await requestStarted;
				await otherTab.evaluate(() => localStorage.setItem('manawg_account', 'fixture-account-B'));
				await expect(page.getByLabel('CSV-Bereich')).toHaveCount(0);
				release();
				await requestFinished;
				await page.waitForLoadState('networkidle');
				expect(await page.evaluate(() => sessionStorage.getItem('test:export-clicked'))).toBeNull();
				expect(downloads).toEqual([]);
			} finally {
				release();
				await otherTab.close();
			}
		});
	}
});
