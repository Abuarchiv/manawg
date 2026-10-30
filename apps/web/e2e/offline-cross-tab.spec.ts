import { expect, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('offline queue across tabs', () => {
	skipUnlessFixtures();

	test('updates the offline counter after a change in another tab', async ({ page, context }) => {
		const otherTab = await context.newPage();
		await setupMember(page);
		await setupMember(otherTab);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}`);
		await navigateToFeature(otherTab, `/wg/${FIXTURE_WG.shareCode}`);
		await dismissOnboarding(page);
		await dismissOnboarding(otherTab);

		const timestamp = Date.now();
		const firstAction = {
			id: `shopping:${FIXTURE_WG.shareCode}:${timestamp}:cross-tab-first`,
			idempotencyKey: '11111111-1111-4111-8111-111111111111',
			type: 'shopping.create',
			wgId: FIXTURE_WG.id,
			shareCode: FIXTURE_WG.shareCode,
			memberId: FIXTURE_WG.memberId,
			createdAt: new Date(timestamp).toISOString(),
			payload: { name: 'Milch', quantity: '1L' },
		};
		const secondAction = {
			id: `shopping:${FIXTURE_WG.shareCode}:${timestamp}:cross-tab-second`,
			idempotencyKey: '22222222-2222-4222-8222-222222222222',
			type: 'shopping.create',
			wgId: FIXTURE_WG.id,
			shareCode: FIXTURE_WG.shareCode,
			memberId: FIXTURE_WG.memberId,
			createdAt: new Date(timestamp).toISOString(),
			payload: { name: 'Brot', quantity: null },
		};

		await page.evaluate((firstAction) => {
			localStorage.setItem('manawg:offline-actions', JSON.stringify([firstAction]));
			window.dispatchEvent(new Event('manawg:offline-queue'));
		}, firstAction);
		const banner = page.locator('[data-offline-banner]');
		await expect(banner).toContainText('1 Offline-Aktion wartet auf Synchronisierung.');

		await otherTab.evaluate((nextAction) => {
			const queue = JSON.parse(localStorage.getItem('manawg:offline-actions') ?? '[]');
			localStorage.setItem('manawg:offline-actions', JSON.stringify([...queue, nextAction]));
		}, secondAction);

		await expect(banner).toContainText('2 Offline-Aktionen warten auf Synchronisierung.');
	});
});
