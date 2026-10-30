// Calendar: changing or removing one date of a repeating event leaves the rest of the series alone.

import { expect, type Route, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('single occurrence of a series', () => {
	skipUnlessFixtures();

	// Events are stored at minute precision, like the form writes them.
	const startsAt = new Date(
		Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 60_000) * 60_000,
	).toISOString();
	const event = {
		id: '22222222-2222-4222-8222-222222222222',
		title: 'Plenum',
		description: null,
		startsAt,
		endsAt: null,
		allDay: false,
		location: null,
		recurrence: 'FREQ=WEEKLY',
		wgId: FIXTURE_WG.id,
		createdByMemberId: FIXTURE_WG.memberId,
		createdAt: startsAt,
		updatedAt: startsAt,
	};

	async function openFirstOccurrence(page: import('@playwright/test').Page, bodies: unknown[]) {
		await setupMember(page);
		const handle = async (route: Route): Promise<void> => {
			if (route.request().method() === 'POST' && route.request().url().endsWith('/occurrence')) {
				const body = route.request().postDataJSON() as { action: string };
				bodies.push(body);
				await route.fulfill({
					json: {
						event: { ...event, recurrence: `FREQ=WEEKLY;EXDATE=${startsAt}` },
						created:
							body.action === 'detach'
								? { ...event, id: '33333333-3333-4333-8333-333333333333', recurrence: null }
								: null,
					},
				});
				return;
			}
			await route.fulfill({ json: { events: [event] } });
		};
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events*`, handle);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events/**`, handle);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/chores*`, (route) =>
			route.fulfill({ json: { chores: [] } }),
		);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/calendar`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: 'Plenum' }).first().click();
	}

	test('"Nur" this date can be removed without touching the series', async ({ page }) => {
		const bodies: unknown[] = [];
		await openFirstOccurrence(page, bodies);

		await page.getByRole('button', { name: /^Nur / }).first().click();
		await expect(page.locator('#event-edit-recurrence')).toHaveCount(0);
		await page.getByRole('button', { name: 'Nur diesen Termin löschen' }).click();
		await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();

		await expect.poll(() => bodies.length).toBe(1);
		expect(bodies[0]).toEqual({ action: 'cancel', occurrenceStartsAt: startsAt });
	});

	test('"Nur" this date can be changed and becomes its own event', async ({ page }) => {
		const bodies: unknown[] = [];
		await openFirstOccurrence(page, bodies);

		await page.getByRole('button', { name: /^Nur / }).first().click();
		await page.getByLabel('Titel').fill('Plenum (verlegt)');
		await page.getByRole('button', { name: 'Speichern', exact: true }).click();

		await expect.poll(() => bodies.length).toBe(1);
		expect(bodies[0]).toEqual(
			expect.objectContaining({
				action: 'detach',
				occurrenceStartsAt: startsAt,
				title: 'Plenum (verlegt)',
			}),
		);
	});

	test('the whole series stays the default scope', async ({ page }) => {
		const bodies: unknown[] = [];
		await openFirstOccurrence(page, bodies);

		await expect(page.getByRole('button', { name: 'Ganze Serie' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await expect(page.locator('#event-edit-recurrence')).toHaveValue('WEEKLY');
		await expect(page.getByRole('button', { name: 'Termin löschen' })).toBeVisible();
	});
});

const emptyCalendar = async (page: import('@playwright/test').Page) => {
	await setupMember(page);
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events*`, (route) =>
		route.fulfill({ json: { events: [] } }),
	);
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/chores*`, (route) =>
		route.fulfill({ json: { chores: [] } }),
	);
	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/calendar`);
	await dismissOnboarding(page);
	await expect(page.getByRole('tab', { name: 'Agenda' })).toBeVisible();
};

test.describe('device time zone notice outside Berlin', () => {
	skipUnlessFixtures();
	test.use({ timezoneId: 'America/New_York' });

	test('a device outside Berlin is told how times are read', async ({ page }) => {
		await emptyCalendar(page);
		await expect(page.getByText(/Dieses Gerät nutzt die Zeitzone America\/New_York/)).toBeVisible();
	});
});

test.describe('device time zone notice in Berlin', () => {
	skipUnlessFixtures();

	test('a device in Berlin sees no notice', async ({ page }) => {
		await emptyCalendar(page);
		await expect(page.getByText(/Dieses Gerät nutzt die Zeitzone/)).toHaveCount(0);
	});
});
