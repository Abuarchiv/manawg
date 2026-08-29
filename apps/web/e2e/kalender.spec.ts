import { expect, test } from '@playwright/test';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

const ENCODED = encodeURIComponent(FIXTURE_WG.shareCode);
const UPCOMING_HEADING = 'Nächste 30 Tage';

interface FixtureEvent {
	id: string;
	title: string;
	description: string | null;
	startsAt: string;
	endsAt: string | null;
	allDay: boolean;
	location: string | null;
	recurrence: string | null;
}

function futureIso(daysAhead: number): string {
	const d = new Date();
	d.setHours(12, 0, 0, 0);
	d.setDate(d.getDate() + daysAhead);
	return d.toISOString();
}

test.describe('Kalender happy path', () => {
	test.setTimeout(180_000);

	test('creates a text event and sees it in the upcoming list', async ({ page }) => {
		await setupMember(page);

		const events: FixtureEvent[] = [];

		await page.route(`**/api/wg/${ENCODED}/events*`, async (route) => {
			const request = route.request();
			if (request.method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ events }),
				});
				return;
			}
			if (request.method() === 'POST') {
				const payload = JSON.parse(request.postData() ?? '{}');
				const created: FixtureEvent = {
					id: `evt-${events.length + 1}`,
					title: payload.title,
					description: payload.description ?? null,
					startsAt: payload.startsAt,
					endsAt: payload.endsAt ?? null,
					allDay: Boolean(payload.allDay),
					location: payload.location ?? null,
					recurrence: payload.recurrence ?? null,
				};
				events.push(created);
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ event: created }),
				});
				return;
			}
			await route.fallback();
		});

		await page.route(`**/api/wg/${ENCODED}/chores`, async (route) => {
			if (route.request().method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ chores: [] }),
			});
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/kalender`);
		await dismissOnboarding(page);

		await expect(page.getByRole('heading', { name: 'Kalender' })).toBeVisible({
			timeout: 30_000,
		});

		await page.getByRole('button', { name: 'Neuen Termin anlegen' }).click();

		const titleInput = page.getByRole('textbox', { name: 'z. B. Heizungsablesung' });
		await expect(titleInput).toBeVisible({ timeout: 10_000 });
		await titleInput.fill('Heizungsablesung');

		// Future date — 14 days ahead is safely inside the 30-day upcoming window.
		const future = futureIso(14);
		const localDate = future.slice(0, 16); // datetime-local format YYYY-MM-DDTHH:mm
		await page.getByRole('textbox', { name: 'Beginn' }).fill(localDate);

		await page.getByRole('button', { name: 'Termin speichern' }).click();

		// Modal closes after save.
		await expect(titleInput).toBeHidden({ timeout: 10_000 });

		// Upcoming list now shows the event.
		const upcomingSection = page.locator('section', { hasText: UPCOMING_HEADING });
		await expect(upcomingSection.getByText('Heizungsablesung')).toBeVisible({ timeout: 10_000 });
	});
});
