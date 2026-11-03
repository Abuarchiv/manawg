// Calendar agenda window in a tab that stays open across midnight.
// Why: "Nächste 30 Tage" must reach 30 days ahead of today, not of the day the tab was opened.

import { expect, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('calendar agenda window', () => {
	test('moves the events request window forward when the day changes in an open tab', async ({
		page,
	}) => {
		skipUnlessFixtures();

		await page.clock.install({ time: new Date('2026-10-14T12:00:00.000Z') });
		await setupMember(page);
		const requestedTo: string[] = [];
		await page.route(new RegExp(`/api/wg/${FIXTURE_WG.shareCode}/events\\?`), (route) => {
			requestedTo.push(new URL(route.request().url()).searchParams.get('to') ?? '');
			return route.fulfill({ json: { events: [] } });
		});
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/chores*`, (route) =>
			route.fulfill({ json: { chores: [] } }),
		);

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/calendar`);
		await dismissOnboarding(page);
		await expect.poll(() => requestedTo.length).toBeGreaterThan(0);
		expect(requestedTo[0]?.startsWith('2026-11-13T')).toBe(true);

		await page.clock.fastForward(24 * 60 * 60 * 1000);
		await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
		await expect.poll(() => requestedTo.at(-1)?.startsWith('2026-11-14T') ?? false).toBe(true);
	});
});
