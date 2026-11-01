// Pinboard: removing a post leaves keyboard focus inside the page.
// Why: the post card is gone, so without a target focus would drop to <body> (WCAG 2.4.3).

import { expect, type Page, test } from '@playwright/test';
import type { Announcement } from '../src/features/announcements/components/announcement-types';
import {
	dismissOnboarding,
	FIXTURE_WG,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

const post: Announcement = {
	id: 'focus-post',
	authorMemberId: FIXTURE_WG.memberId,
	content: 'Erster Beitrag',
	imageUrl: null,
	kind: 'info',
	status: 'open',
	source: 'manual',
	sourcePath: null,
	pinnedAt: null,
	resolvedAt: null,
	resolvedByMemberId: null,
	createdAt: new Date().toISOString(),
	updatedAt: '2026-01-01T10:00:00.000Z',
	reactionCounts: {},
	myReactions: [],
	takers: [],
	comments: [],
};

async function openPinboard(page: Page): Promise<void> {
	await setupMember(page);
	let deleted = false;
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/announcements*`, (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		return route.fulfill({ json: { announcements: deleted ? [] : [post] } });
	});
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/announcements/${post.id}`, (route) => {
		if (route.request().method() !== 'DELETE') return route.fallback();
		deleted = true;
		return route.fulfill({ json: {} });
	});
	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/pinboard`);
	await dismissOnboarding(page);
}

const focusIsInsideMain = (page: Page) =>
	page.evaluate(
		() => document.activeElement !== document.body && !!document.activeElement?.closest('main'),
	);

test.describe('pinboard focus after the confirmation dialog closes', () => {
	skipUnlessFixtures();

	test('removing a post keeps focus on the page', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await openPinboard(page);

		await page.getByRole('button', { name: /^Beitragsaktionen:/ }).focus();
		await page.keyboard.press('Enter');
		await page.getByRole('menuitem', { name: /^Beitrag entfernen:/ }).focus();
		await page.keyboard.press('Enter');
		await page
			.getByRole('alertdialog')
			.getByRole('button', { name: /^Beitrag entfernen bestätigen:/ })
			.focus();
		await page.keyboard.press('Enter');

		await expect(page.getByText(post.content, { exact: true })).toBeHidden();
		await expect.poll(() => focusIsInsideMain(page)).toBe(true);
	});

	test('cancelling the dialog with Escape returns focus to the actions button', async ({
		page,
	}) => {
		await openPinboard(page);

		const trigger = page.getByRole('button', { name: /^Beitragsaktionen:/ });
		await trigger.focus();
		await page.keyboard.press('Enter');
		await page.getByRole('menuitem', { name: /^Beitrag entfernen:/ }).focus();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('alertdialog')).toBeVisible();
		await page.keyboard.press('Escape');

		await expect(trigger).toBeFocused();
	});
});
