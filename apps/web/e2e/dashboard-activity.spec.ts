// Activity page: "Ältere Einträge laden" raises the limit.
// Why: the larger page lives under a new cache key; the rows shown so far must not vanish meanwhile.

import { expect, test } from '@playwright/test';
import {
	FIXTURE_WG,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

function entries(count: number) {
	return Array.from({ length: count }, (_, index) => ({
		id: `act-${index}`,
		kind: 'shopping',
		timestamp: new Date(Date.UTC(2026, 9, 20, 12, 0) - index * 60_000).toISOString(),
		memberId: FIXTURE_WG.memberId,
		memberName: FIXTURE_WG.memberName,
		text: `Eintrag ${index}`,
		completed: true,
	}));
}

test.describe('activity feed', () => {
	skipUnlessFixtures();

	test('older entries load while the shown ones stay visible', async ({ page }) => {
		const base = `/api/wg/${FIXTURE_WG.shareCode}`;
		const limits: number[] = [];
		let releaseLarger: (() => void) | undefined;
		const largerMayAnswer = new Promise<void>((resolve) => {
			releaseLarger = resolve;
		});
		await setupMember(page);
		await mockUnreadCount(page, base);
		await page.route(`**${base}/activity?*`, async (route) => {
			const limit = Number(new URL(route.request().url()).searchParams.get('limit'));
			limits.push(limit);
			if (limit > 80) await largerMayAnswer;
			await route.fulfill({ json: { items: entries(limit > 80 ? 100 : 80), reminders: [] } });
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/activity`);
		await expect(page.getByText('Eintrag 0', { exact: true })).toBeVisible();

		await page.getByRole('button', { name: 'Ältere Einträge laden' }).click();
		await expect.poll(() => limits.includes(160)).toBe(true);
		await expect(page.getByText('Eintrag 0', { exact: true })).toBeVisible();

		releaseLarger?.();
		await expect(page.getByText('Eintrag 99', { exact: true })).toBeVisible();
	});
});
