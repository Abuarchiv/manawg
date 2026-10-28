// English cleaning rota: groups, status labels, drawers, dialogs, forms, fairness, toasts and errors.
// Why: Every chores string ships in two languages; a missed one would show German chrome in English.

import { type BrowserContext, expect, type Page, test } from '@playwright/test';
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
					...[1, 2, 3, 4].map((index) => ({
						id: `later-${index}`,
						memberId: anna.id,
						memberName: 'Anna',
						startDate: new Date(Date.now() + (10 + index * 5) * DAY_MS).toISOString(),
						endDate: new Date(Date.now() + (11 + index * 5) * DAY_MS).toISOString(),
						reason: null,
					})),
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
				await expect(
					page.getByRole('button', { name: 'I’ll take it: Take out the rubbish' }),
				).toBeVisible();

				await expect(page.getByText('This month', { exact: false })).toBeVisible();
				await expect(page.getByText('Best for a new task:', { exact: false })).toBeVisible();
				await expect(page).toHaveTitle(/Cleaning rota/);
				await expect(page.locator('[data-slot="card-title"]', { hasText: /^Away$/ })).toBeVisible();
				await expect(page.getByText('1 away now')).toBeVisible();
				await expect(page.getByRole('button', { name: 'Add cleaning task' })).toBeVisible();
				await expectNoGermanChrome(page);
				await expectNoSidewaysScroll(page, width);

				// Row drawer
				await page.getByRole('button', { name: 'Task actions: Take out the rubbish' }).click();
				for (const label of ['Assigned to', 'Due', 'Repeats', 'Next up', 'Last done']) {
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

	test('the route error boundary is English', async ({ page, context, baseURL }) => {
		await prepare(page, context, baseURL, 390, 'light');
		// A reply the page cannot parse makes the rota throw while rendering.
		await page.route(`**${BASE}/chores`, (route) =>
			route.fulfill({ json: { chores: 'broken', monthCompletions: 'broken' } }),
		);
		await navigateToFeature(page, PUTZEN);
		await expect(
			page.getByRole('heading', { name: 'The cleaning rota could not be loaded just now' }),
		).toBeVisible();
		await expect(page.getByText('Something went wrong in the cleaning rota.')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
		await expectNoGermanChrome(page);
	});

	test('the overdue filter strip is English', async ({ page, context, baseURL }) => {
		await prepare(page, context, baseURL, 390, 'light');
		await navigateToFeature(page, `${PUTZEN}?filter=overdue`);
		await dismissOnboarding(page);
		await expect(page.getByText('Overdue tasks only')).toBeVisible();
		await expect(page.getByText('Mop the kitchen')).toHaveCount(0);
		await expectNoGermanChrome(page);
		await page.getByRole('button', { name: 'Show all' }).click();
		await expect(page.getByText('Mop the kitchen')).toBeVisible();
	});

	test('the absence form and its messages are English', async ({ page, context, baseURL }) => {
		await prepare(page, context, baseURL, 320, 'dark');
		await page.route(`**${BASE}/absences`, (route) =>
			route.request().method() === 'POST'
				? route.fulfill({ status: 409, json: { error: 'absence_overlaps_existing' } })
				: route.fallback(),
		);
		await page.route(`**${BASE}/absences/*`, (route) => route.fulfill({ json: {} }));
		await navigateToFeature(page, PUTZEN);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: 'Add time away' }).click();
		for (const label of ['Member who is away', 'From', 'Until', 'Reason (optional)']) {
			await expect(page.getByText(label, { exact: true })).toBeVisible();
		}
		await expect(page.getByPlaceholder('e.g. Holiday')).toBeVisible();
		await page.getByLabel('Away from').fill('');
		await expect(page.getByText('Pick From and Until, then you can save.')).toBeVisible();
		await page
			.getByLabel('Away from')
			.fill(new Date(Date.now() + 2 * DAY_MS).toISOString().slice(0, 10));
		await page.getByRole('button', { name: 'Save time away' }).click();
		await expect(
			page.getByText(
				'The time away could not be saved: This person already has time away in that period.',
			),
		).toBeVisible();
		await expectNoGermanChrome(page);
		await expectNoSidewaysScroll(page, 320);

		await expect(page.getByRole('link', { name: 'Show all 5 periods away' })).toBeVisible();
		const remove = page.getByRole('button', { name: /^Remove time away for Anna/ }).first();
		await remove.click();
		await expect(
			page.getByRole('button', { name: /^Really remove\? Time away for Anna/ }),
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Cancel removing time away for Anna' }),
		).toBeVisible();
		await expectNoGermanChrome(page);
		await page.getByRole('button', { name: 'Cancel removing time away for Anna' }).click();
		await remove.click();
		await page.getByRole('button', { name: /^Really remove\? Time away for Anna/ }).click();
		await expect(page.getByText('Time away for Anna removed.').first()).toBeVisible();
	});

	test('edit drawer, swap, take over and fairness are English', async ({
		page,
		context,
		baseURL,
	}) => {
		await prepare(page, context, baseURL, 390, 'light');
		await page.route(`**${BASE}/chores/late`, (route) =>
			route.fulfill({ status: 500, json: { error: 'server_error' } }),
		);
		await page.route(`**${BASE}/announcements`, (route) =>
			route.fulfill({ status: 500, json: { error: 'server_error' } }),
		);
		await navigateToFeature(page, PUTZEN);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: 'I’ll take it: Take out the rubbish' }).click();
		await expect(
			page.getByText('The task could not be taken over', { exact: false }),
		).toBeVisible();

		await page.getByRole('button', { name: 'Task actions: Take out the rubbish' }).click();
		await page
			.getByRole('button', { name: 'Ask for a swap on the noticeboard: Take out the rubbish' })
			.click();
		await expect(
			page.getByText('The swap request could not be posted', { exact: false }),
		).toBeVisible();
		await page.getByRole('button', { name: 'Edit task: Take out the rubbish' }).click();
		await expect(page.getByRole('heading', { name: 'Edit task' })).toBeVisible();
		for (const label of ['Task', 'Assigned to', 'Due on', 'Repeats']) {
			await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
		}
		await page.getByLabel('Task', { exact: true }).fill('Take out the recycling');
		await page.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(
			page
				.getByLabel('Edit task')
				.getByText('The task could not be edited: Try again in a moment.'),
		).toBeVisible();
		await expectNoGermanChrome(page);
		await page.getByRole('button', { name: 'Cancel', exact: true }).click();

		await page.getByRole('button', { name: 'How tasks are shared out' }).click();
		await expect(page.getByText('Lightest load first, nobody twice in a row')).toBeVisible();
		await expect(
			page.getByText('Recalculated after each task, people who are away are skipped'),
		).toBeVisible();
		await expectNoGermanChrome(page);
	});

	test('completing a task says who is up next', async ({ page, context, baseURL }) => {
		await prepare(page, context, baseURL, 390, 'light');
		const confirmed = (id: string, assignedMemberId: string) => ({
			chore: { id, nextDueAt: new Date(Date.now() + 7 * DAY_MS).toISOString(), assignedMemberId },
		});
		await page.route(`**${BASE}/chores/mine/complete`, (route) =>
			route.fulfill({ json: confirmed('mine', 'anna') }),
		);
		await page.route(`**${BASE}/chores/late/complete`, (route) =>
			route.fulfill({ json: confirmed('late', FIXTURE_WG.memberId) }),
		);
		await navigateToFeature(page, PUTZEN);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: 'Mark as done: Clean the bathroom' }).click();
		await expect(page.getByText('Mark “Clean the bathroom” as done?')).toBeVisible();
		await expect(page.getByText('Anna is up next.', { exact: false })).toBeVisible();
		await page.getByRole('button', { name: 'Confirm done: Clean the bathroom' }).click();
		await expect(page.getByText(/Clean the bathroom is done\. Anna is up next on /)).toBeVisible();

		await page.getByRole('button', { name: 'Catch up on task: Take out the rubbish' }).click();
		await expect(page.getByText('You are up next.', { exact: false })).toBeVisible();
		await page.getByRole('button', { name: 'Confirm catch up: Take out the rubbish' }).click();
		await expect(
			page.getByText(/Take out the rubbish is done\. You are up next on /),
		).toBeVisible();
		await expectNoGermanChrome(page);
	});

	test('a failed save of a new task shows an English error', async ({ page, context, baseURL }) => {
		await prepare(page, context, baseURL, 390, 'light');
		await page.route(`**${BASE}/chores`, (route) =>
			route.request().method() === 'POST'
				? route.fulfill({ status: 500, json: { error: 'insert_failed' } })
				: route.fallback(),
		);
		await navigateToFeature(page, PUTZEN);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: 'Add cleaning task' }).click();
		await page.getByLabel('Task', { exact: true }).fill('Water the plants');
		await page.getByRole('button', { name: 'Save task' }).click();
		await expect(
			page.getByText(
				'The cleaning task could not be saved: Check the cleaning rota and try again.',
			),
		).toBeVisible();
		await expectNoGermanChrome(page);
	});

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
