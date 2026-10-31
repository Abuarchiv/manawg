// Editing the text of a manual noticeboard post.

import { expect, test } from '@playwright/test';
import type { Announcement } from '../src/features/announcements/components/announcement-types';
import {
	dismissOnboarding,
	FIXTURE_WG,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('pinboard edit', () => {
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

	test('revealing new posts does not resurrect a post removed after the pending snapshot', async ({
		page,
	}) => {
		const SHARE_CODE = FIXTURE_WG.shareCode;
		const removed: Announcement = {
			...post,
			id: 'removed-after-snapshot',
			content: 'Wird entfernt',
			kind: 'info',
		};
		const added: Announcement = {
			...post,
			id: 'added-after-snapshot',
			content: 'Frischer Beitrag',
			kind: 'info',
		};
		let rows = [removed];
		let removedOnServer = false;
		const refresh = Promise.withResolvers<void>();
		const refreshStarted = Promise.withResolvers<void>();
		await setupMember(page);
		await page.route(`**/api/wg/${SHARE_CODE}/announcements*`, async (route) => {
			if (route.request().method() !== 'GET') return route.fallback();
			if (removedOnServer) {
				refreshStarted.resolve();
				await refresh.promise;
			}
			return route.fulfill({ json: { announcements: rows } });
		});
		await page.route(`**/api/wg/${SHARE_CODE}/announcements/${removed.id}`, (route) => {
			if (route.request().method() !== 'DELETE') return route.fallback();
			rows = [added];
			removedOnServer = true;
			return route.fulfill({ json: {} });
		});
		await navigateToFeature(page, `/wg/${SHARE_CODE}/pinboard`);
		await dismissOnboarding(page);
		await expect(page.getByText(removed.content, { exact: true })).toBeVisible();
		rows = [added, removed];
		await page.evaluate(() => window.dispatchEvent(new Event('focus')));
		const pending = page.getByRole('button', { name: /neuer? Beitr/ });
		await expect(pending).toBeVisible();
		await page.getByRole('button', { name: /^Beitragsaktionen:/ }).click();
		await page.getByRole('menuitem', { name: /^Beitrag entfernen:/ }).click();
		try {
			await page
				.getByRole('alertdialog')
				.getByRole('button', { name: /^Beitrag entfernen bestätigen:/ })
				.click();
			await refreshStarted.promise;
			await expect(page.getByText(removed.content, { exact: true })).toBeHidden();
			await pending.click();
			await expect(page.getByText(added.content, { exact: true })).toBeVisible();
			await expect(page.getByText(removed.content, { exact: true })).toBeHidden();
		} finally {
			refresh.resolve();
		}
	});

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
