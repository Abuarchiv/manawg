// English activity feed: audit rows with sentence parameters read in English, older rows stay German.
// Why: The feed renders the server's text and selfText; a regression would show German or the wrong verb form.

import { expect, type Page, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';
import { expectNoGermanChrome, expectNoHorizontalOverflow, setEnglishLocale } from './support/i18n';

const BASE = `/api/wg/${FIXTURE_WG.shareCode}`;
const WIDTHS = [320, 390] as const;
const SCHEMES = ['light', 'dark'] as const;

function row(id: string, minutesAgo: number, fields: Record<string, unknown>) {
	return {
		id,
		kind: 'audit',
		timestamp: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
		completed: false,
		sentence: true,
		...fields,
	};
}

const ITEMS = [
	// Written with sentence parameters: the server renders it in the reader's language.
	row('new-other', 1, { memberId: 'anna', memberName: 'Anna', text: 'bought Milk.' }),
	row('new-own', 2, {
		memberId: FIXTURE_WG.memberId,
		memberName: FIXTURE_WG.memberName,
		text: 'marked Bathroom as done.',
		detail: 'with image',
	}),
	// Written before the parameters: the stored German sentence, with the server's own-row form.
	row('old-own', 3, {
		memberId: FIXTURE_WG.memberId,
		memberName: FIXTURE_WG.memberName,
		text: 'hat Müll erledigt.',
		selfText: 'hast Müll erledigt.',
	}),
];

async function prepare(page: Page, width: number, colorScheme: 'light' | 'dark'): Promise<void> {
	await setupMember(page);
	await mockUnreadCount(page, BASE);
	await page.route(`**${BASE}/activity?*`, (route) =>
		route.fulfill({ json: { items: ITEMS, reminders: [] } }),
	);
	await page.setViewportSize({ width, height: 780 });
	await page.emulateMedia({ colorScheme });
}

test.describe('English activity feed', () => {
	skipUnlessFixtures();

	for (const width of WIDTHS) {
		for (const scheme of SCHEMES) {
			test(`new rows are English and older rows stay German at ${width}px ${scheme}`, async ({
				page,
				context,
				baseURL,
			}) => {
				await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
				await prepare(page, width, scheme);
				await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/activity`);
				await dismissOnboarding(page);

				await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
				const feed = page.getByRole('list', { name: 'Activity history' });
				await expect(feed.getByText('Anna bought Milk.', { exact: true })).toBeVisible();
				await expect(feed.getByText('You marked Bathroom as done.', { exact: true })).toBeVisible();
				await expect(feed.getByText('with image')).toBeVisible();
				await expect(feed.getByText('You hast Müll erledigt.', { exact: true })).toBeVisible();

				await expectNoGermanChrome(page);
				await expectNoHorizontalOverflow(page);
			});
		}
	}
});
