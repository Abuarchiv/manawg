// English cleaning rota: groups, status labels, row drawer, confirm dialog, forms and fairness.
// Why: Every chores string ships in two languages; a missed one would show German chrome in English.

import { type BrowserContext, type Page, expect, test } from '@playwright/test';
import {
	FIXTURE_WG,
	dismissOnboarding,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';
import { expectNoGermanChrome, expectNoHorizontalOverflow, setEnglishLocale } from './support/i18n';

const BASE = `/api/wg/${FIXTURE_WG.shareCode}`;
const PUTZEN = `/wg/${FIXTURE_WG.shareCode}/putzen`;
const WIDTHS = [320, 390] as const;
const SCHEMES = ['light', 'dark'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

function chore(id: string, title: string, offsetDays: number, assignedMemberId: string | null) {
	return {
		id,
		title,
		intervalDays: 7,
		recurrenceType: 'days',
		nextDueAt: new Date(Date.now() + offsetDays * DAY_MS).toISOString(),
		assignedMemberId,
		lastCompletedAt: new Date(Date.now() - DAY_MS).toISOString(),
		lastCompletedByName: 'Anna',
		openGapCountForAssignee: 0,
		updatedAt: '2026-10-01T08:00:00.123Z',
	};
}

async function prepare(
	page: Page,
	context: BrowserContext,
	baseURL: string | undefined,
	width: number,
	colorScheme: 'light' | 'dark',
): Promise<void> {
	const viewer = {
		id: FIXTURE_WG.memberId,
		name: FIXTURE_WG.memberName,
		color: null,
		active: true,
	};
	const anna = { id: 'anna', name: 'Anna', color: null, active: true };
	await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
	await setupMember(page);
	await mockUnreadCount(page, BASE);
	await page.route(`**${BASE}/members`, (route) =>
		route.fulfill({ json: { members: [viewer, anna], viewerIsAdmin: false } }),
	);
	await page.route(`**${BASE}/chores`, (route) =>
		route.fulfill({
			json: {
				chores: [
					chore('mine', 'Clean the bathroom', 0, viewer.id),
					chore('late', 'Take out the rubbish', -3, anna.id),
					chore('soon', 'Mop the kitchen', 3, anna.id),
				],
				monthCompletions: { [viewer.id]: 3, anna: 1 },
			},
		}),
	);
	await page.route(`**${BASE}/absences`, (route) =>
		route.fulfill({
			json: {
				absences: [
					{
						id: 'away',
						memberId: anna.id,
						memberName: 'Anna',
						startDate: new Date(Date.now() - DAY_MS).toISOString(),
						endDate: new Date(Date.now() + DAY_MS).toISOString(),
						reason: 'Holiday',
					},
				],
			},
		}),
	);
	await page.setViewportSize({ width, height: 780 });
	await page.emulateMedia({ colorScheme });
}

async function expectNoSidewaysScroll(page: Page, width: number): Promise<void> {
	if (width === 320) return expectNoHorizontalOverflow(page);
	const widths = await page.evaluate(() => ({
		scroll: document.documentElement.scrollWidth,
		client: document.documentElement.clientWidth,
	}));
	expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

test.describe('English cleaning rota', () => {
	skipUnlessFixtures();

	for (const width of WIDTHS) {
		for (const scheme of SCHEMES) {
			const where = `${width}px ${scheme}`;

			test(`plan, row drawer and dialogs at ${where}`, async ({ page, context, baseURL }) => {
				await prepare(page, context, baseURL, width, scheme);
				await navigateToFeature(page, PUTZEN);
				await dismissOnboarding(page);

				await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
				await expect(page.getByRole('heading', { name: 'Cleaning rota', level: 1 })).toHaveText(
					'Cleaning rota',
				);
				for (const group of ['For you', 'Still open', 'This week']) {
					await expect(page.getByRole('heading', { name: group, level: 2 })).toBeVisible();
				}
				await expect(page.getByText('due today', { exact: false }).first()).toBeVisible();
				await expect(page.getByText('open for 3 days', { exact: false })).toBeVisible();
				await expect(page.getByText('in 3 days', { exact: false })).toBeVisible();
				await expect(page.getByText('weekly', { exact: false }).first()).toBeVisible();
				await expect(page.getByText('Anna is away', { exact: false }).first()).toBeVisible();

				await expect(page.getByText('This month', { exact: false })).toBeVisible();
				await expect(page.getByText('Best for a new task:', { exact: false })).toBeVisible();
				await expect(page.getByText('Absences', { exact: true })).toBeVisible();
				await expect(page.getByText('1 away now')).toBeVisible();
				await expect(page.getByRole('button', { name: 'Add cleaning task' })).toBeVisible();
				await expectNoGermanChrome(page);
				await expectNoSidewaysScroll(page, width);

				// Row drawer
				await page.getByRole('button', { name: 'Task actions: Take out the rubbish' }).click();
				for (const label of ['Assigned to', 'Due', 'Rhythm', 'Then', 'Last done']) {
					await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
				}
				await expect(
					page.getByRole('button', {
						name: 'Ask for a swap on the noticeboard: Take out the rubbish',
					}),
				).toBeVisible();
				await expect(
					page.getByRole('button', { name: 'Edit task: Take out the rubbish' }),
				).toBeVisible();
				await expectNoGermanChrome(page);
				await page.keyboard.press('Escape');

				// Catch-up dialog for the overdue chore
				await page.getByRole('button', { name: 'Catch up on task: Take out the rubbish' }).click();
				await expect(page.getByText('Mark “Take out the rubbish” as done?')).toBeVisible();
				await expect(page.getByText('This cannot be undone.', { exact: false })).toBeVisible();
				await expect(
					page.getByRole('button', { name: 'Confirm catch up: Take out the rubbish' }),
				).toBeVisible();
				await expectNoGermanChrome(page);
				await page.getByRole('button', { name: 'Cancel' }).click();

				// New task form
				await page.getByRole('button', { name: 'Add cleaning task' }).click();
				await expect(page.getByRole('heading', { name: 'New cleaning task' })).toBeVisible();
				await expect(page.getByRole('button', { name: 'every 3 days' })).toBeVisible();
				await expect(page.getByLabel('First due date (optional)')).toBeVisible();
				await expect(page.getByRole('button', { name: 'Save task' })).toBeVisible();
				await expectNoGermanChrome(page);
				await expectNoSidewaysScroll(page, width);
			});
		}
	}

	test('the empty plan is English', async ({ page, context, baseURL }) => {
		await prepare(page, context, baseURL, 390, 'light');
		await page.route(`**${BASE}/chores`, (route) =>
			route.fulfill({ json: { chores: [], monthCompletions: {} } }),
		);
		await page.route(`**${BASE}/absences`, (route) => route.fulfill({ json: { absences: [] } }));
		await navigateToFeature(page, PUTZEN);
		await dismissOnboarding(page);

		await expect(page.getByText('No tasks yet')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Clean the bathroom' })).toBeVisible();
		await expectNoGermanChrome(page);
	});
});
