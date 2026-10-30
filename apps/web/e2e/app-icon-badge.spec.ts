// App icon unread badge: set by the chat link, cleared when the WG shell goes away.
// Why: the badge is device-global, so a stale count would outlive the page that set it.

import { expect, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('app icon badge', () => {
	skipUnlessFixtures();

	test('leaving the WG shell clears the unread count on the app icon', async ({ page }) => {
		await page.addInitScript(() => {
			const calls: string[] = [];
			Object.assign(window, { __badgeCalls: calls });
			Object.assign(navigator, {
				setAppBadge: async (count: number) => void calls.push(`set:${count}`),
				clearAppBadge: async () => void calls.push('clear'),
			});
		});
		await setupMember(page);
		await mockUnreadCount(page, `/api/wg/${FIXTURE_WG.shareCode}`, 4);
		const calls = () =>
			page.evaluate(() => (window as unknown as { __badgeCalls: string[] }).__badgeCalls);

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/settings`);
		await dismissOnboarding(page);
		await expect.poll(calls).toContain('set:4');

		// A client-side navigation out of the WG shell unmounts the chat link without a page unload.
		await page.evaluate(() =>
			(window as unknown as { next: { router: { push(href: string): void } } }).next.router.push(
				'/login',
			),
		);
		await expect.poll(calls).toContain('clear');
	});
});
