// Event form validation: the invalid field stays visible above the pinned form error.
// Why: The error alert is pinned above the footer; focusing the field before it renders left the field underneath.

import { expect, type Locator, type Page, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';
import { setEnglishLocale } from './support/i18n';

const BASE = `/api/wg/${FIXTURE_WG.shareCode}`;
const CALENDAR = `/wg/${FIXTURE_WG.shareCode}/calendar`;
const HOUR_MS = 60 * 60 * 1000;

function meeting() {
	const today = new Date();
	const startsAt = new Date(
		Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1, 12),
	);
	return {
		id: 'meeting',
		title: 'Flat meeting',
		description: null,
		startsAt: startsAt.toISOString(),
		endsAt: new Date(startsAt.getTime() + HOUR_MS).toISOString(),
		allDay: false,
		location: null,
		recurrence: null,
		wgId: FIXTURE_WG.id,
		createdByMemberId: FIXTURE_WG.memberId,
		createdAt: startsAt.toISOString(),
		updatedAt: startsAt.toISOString(),
	};
}

async function openCalendar(
	page: Page,
	context: Parameters<typeof setEnglishLocale>[0],
	baseURL: string | undefined,
	viewport: { width: number; height: number },
): Promise<void> {
	await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
	await setupMember(page);
	await mockUnreadCount(page, BASE);
	await page.route(`**${BASE}/events*`, (route) =>
		route.request().method() === 'GET'
			? route.fulfill({ json: { events: [meeting()] } })
			: route.fallback(),
	);
	await page.route(`**${BASE}/chores*`, (route) => route.fulfill({ json: { chores: [] } }));
	await page.route(`**${BASE}/calendar-subscription*`, (route) =>
		route.fulfill({ json: { subscription: null } }),
	);
	await page.setViewportSize(viewport);
	await navigateToFeature(page, CALENDAR);
	await dismissOnboarding(page);
}

async function expectFieldClearOfAlert(page: Page, field: Locator): Promise<void> {
	const alert = page.getByRole('dialog').getByRole('alert');
	await expect(alert).toBeVisible();
	// Scrolling snaps to whole layout units, so allow a sub-pixel sliver under the alert.
	await expect(field).toBeInViewport({ ratio: 0.95 });
	const [fieldBox, alertBox] = await Promise.all([field.boundingBox(), alert.boundingBox()]);
	if (!fieldBox || !alertBox) throw new Error('Field or alert has no layout box');
	expect(fieldBox.y + fieldBox.height).toBeLessThanOrEqual(alertBox.y + 1);
}

test.describe('event form error field', () => {
	skipUnlessFixtures();

	test('an empty title stays visible above the error in a short landscape viewport', async ({
		page,
		context,
		baseURL,
	}) => {
		await openCalendar(page, context, baseURL, { width: 667, height: 375 });
		await page.getByRole('button', { name: 'Add event' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Save event' }).click();
		await expectFieldClearOfAlert(page, page.locator('#event-create-title'));
	});

	test('the create form keeps Ends visible above the end-before-start error', async ({
		page,
		context,
		baseURL,
	}) => {
		await openCalendar(page, context, baseURL, { width: 390, height: 568 });
		await page.getByRole('button', { name: 'Add event' }).click();
		const drawer = page.getByRole('dialog');
		await drawer.getByLabel('Title', { exact: true }).fill('Plant swap');
		await drawer.getByLabel('Starts').fill('2030-01-10T10:00');
		await drawer.getByLabel('Ends (optional)').fill('2030-01-10T09:00');
		await drawer.getByRole('button', { name: 'Save event' }).click();
		await expectFieldClearOfAlert(page, page.locator('#event-create-end'));
	});

	test('the edit form keeps Ends visible above the end-before-start error', async ({
		page,
		context,
		baseURL,
	}) => {
		await openCalendar(page, context, baseURL, { width: 390, height: 480 });
		await page.getByRole('tab', { name: 'Agenda' }).click();
		await page.getByRole('button', { name: 'Flat meeting' }).first().click();
		const drawer = page.getByRole('dialog');
		await drawer.getByLabel('Starts').fill('2030-01-10T10:00');
		await drawer.getByLabel('Ends (optional)').fill('2030-01-10T09:00');
		await drawer.getByRole('button', { name: 'Save', exact: true }).click();
		await expectFieldClearOfAlert(page, page.locator('#event-edit-end'));
	});
});
