// Editing the text of a manual Pinnwand post.

import { expect, test } from '@playwright/test';
import type { Announcement } from '../src/features/pinnwand/components/announcement-types';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

test.describe('pinnwand edit', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

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
		reactionCounts: {},
		myReactions: [],
		takers: [],
		comments: [],
	};

	test('the author edits the text and the change is sent as content only', async ({ page }) => {
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
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/pinnwand`);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: /^Beitragsaktionen:/ }).click();
		await page.getByRole('menuitem', { name: /^Beitrag bearbeiten:/ }).click();
		const field = page.getByLabel('Text', { exact: true });
		await expect(field).toHaveValue('Wer bringt Klopapier mit?');
		await expect(page.getByRole('button', { name: 'Speichern' })).toBeDisabled();
		await field.fill('Wer bringt Klopapier und Spülmittel mit?');
		await page.getByRole('button', { name: 'Speichern' }).click();

		await expect
			.poll(() => patchBody)
			.toEqual({ content: 'Wer bringt Klopapier und Spülmittel mit?' });
		await expect(page.getByText('Wer bringt Klopapier und Spülmittel mit?').first()).toBeVisible();
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
									sourcePath: '/putzen?highlight=x',
								},
							],
						},
					})
				: route.fallback(),
		);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/pinnwand`);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: /^Beitragsaktionen:/ }).click();
		await expect(page.getByRole('menuitem', { name: /^Beitrag bearbeiten:/ })).toHaveCount(0);
	});
});
