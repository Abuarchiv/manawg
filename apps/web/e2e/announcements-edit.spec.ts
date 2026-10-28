// Editing the text of a manual Pinnwand post.

import { expect, test } from '@playwright/test';
import type { Announcement } from '../src/features/announcements/components/announcement-types';
import {
	dismissOnboarding,
	FIXTURE_WG,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('pinnwand edit', () => {
	skipUnlessFixtures();

	const post: Announcement = {
		id: 'edit-post',
		authorMemberId: FIXTURE_WG.memberId,
		content: 'Wer bringt Klopapier mit?',
		imageUrl: null,
		kind: 'question',
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

	test('the author edits the text and the change carries the version it was opened on', async ({
		page,
	}) => {
		let patchBody: unknown = null;
		let text = post.content;
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/announcements/edit-post`, (route) => {
			if (route.request().method() !== 'PATCH') return route.fallback();
			patchBody = route.request().postDataJSON();
			text = (patchBody as { content: string }).content;
			return route.fulfill({ json: { announcement: { ...post, content: text }, warning: null } });
		});
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/announcements*`, (route) =>
			route.request().method() === 'GET'
				? route.fulfill({ json: { announcements: [{ ...post, content: text }] } })
				: route.fallback(),
		);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/pinboard`);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: /^Beitragsaktionen:/ }).click();
		await page.getByRole('menuitem', { name: /^Beitrag bearbeiten:/ }).click();
		const field = page.getByRole('textbox', { name: 'Beitragstext' });
		await expect(field).toHaveValue('Wer bringt Klopapier mit?');
		await field.fill('Wer bringt Klopapier und Spülmittel mit?');
		await page.getByRole('button', { name: 'Speichern' }).click();

		await expect
			.poll(() => patchBody)
			.toEqual({
				content: 'Wer bringt Klopapier und Spülmittel mit?',
				expectedUpdatedAt: post.updatedAt,
			});
		await expect(page.getByText('Wer bringt Klopapier und Spülmittel mit?').first()).toBeVisible();
	});

	test('a concurrent save keeps the drawer open with a hint', async ({ page }) => {
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/announcements/edit-post`, (route) =>
			route.request().method() === 'PATCH'
				? route.fulfill({ status: 409, json: { error: 'announcement_changed' } })
				: route.fallback(),
		);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/announcements*`, (route) =>
			route.request().method() === 'GET'
				? route.fulfill({ json: { announcements: [post] } })
				: route.fallback(),
		);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/pinboard`);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: /^Beitragsaktionen:/ }).click();
		await page.getByRole('menuitem', { name: /^Beitrag bearbeiten:/ }).click();
		await page.getByRole('textbox', { name: 'Beitragstext' }).fill('Neuer Text');
		await page.getByRole('button', { name: 'Speichern' }).click();

		await expect(page.getByText(/wurde inzwischen geändert/).first()).toBeVisible();
	});

	test('generated posts offer no edit action', async ({ page }) => {
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/announcements*`, (route) =>
			route.request().method() === 'GET'
				? route.fulfill({
						json: {
							announcements: [
								{
									...post,
									id: 'swap-post',
									source: 'chore_swap',
									sourcePath: '/chores?highlight=x',
								},
							],
						},
					})
				: route.fallback(),
		);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/pinboard`);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: /^Beitragsaktionen:/ }).click();
		await expect(page.getByRole('menuitem', { name: /^Beitrag bearbeiten:/ })).toHaveCount(0);
	});
});
