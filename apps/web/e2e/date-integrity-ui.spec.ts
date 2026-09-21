import { type Page, expect, test } from '@playwright/test';
import { dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires the local fixture server');

const SHARE_CODE = 'MTE8PZAT';
const MOBILE_VIEWPORT = { width: 320, height: 740 } as const;
const NORMAL_VIEWPORT = { width: 1280, height: 720 } as const;

type CapturedPost = {
	bodies: unknown[];
	statuses: number[];
};

function berlinCalendarDate(value: string): string {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en', {
			timeZone: 'Europe/Berlin',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		})
			.formatToParts(new Date(value))
			.map(({ type, value: part }) => [type, part]),
	);
	return `${parts.year}-${parts.month}-${parts.day}`;
}

async function interceptValidationPost(page: Page, endpoint: string): Promise<CapturedPost> {
	const captured: CapturedPost = { bodies: [], statuses: [] };
	await page.route(`**/api/wg/${SHARE_CODE}/${endpoint}`, async (route) => {
		if (route.request().method() !== 'POST') {
			await route.continue();
			return;
		}
		captured.bodies.push(route.request().postDataJSON());
		await route.fulfill({
			status: 422,
			contentType: 'application/json',
			body: JSON.stringify({ error: 'deliberate_validation' }),
		});
		captured.statuses.push(422);
	});
	return captured;
}

async function openAboCreate(
	page: Page,
	viewport: { width: number; height: number },
): Promise<void> {
	await page.setViewportSize(viewport);
	await setupMember(page);
	await navigateToFeature(page, `/wg/${SHARE_CODE}/abos`);
	await dismissOnboarding(page);
	await expect(page.getByRole('heading', { name: 'Fixkosten', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Neues Abo', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Neues Abo', exact: true })).toBeVisible();
}

async function openCalendarCreate(
	page: Page,
	viewport: { width: number; height: number },
): Promise<void> {
	await page.setViewportSize(viewport);
	await setupMember(page);
	await navigateToFeature(page, `/wg/${SHARE_CODE}/kalender`);
	await dismissOnboarding(page);
	await expect(page.getByRole('heading', { name: 'Kalender', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Termin hinzufügen', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Neuer Termin', exact: true })).toBeVisible();
}

test('Abo blocks a missing due date and preserves a valid calendar date', async ({ page }) => {
	const post = await interceptValidationPost(page, 'recurring-expenses');
	await openAboCreate(page, MOBILE_VIEWPORT);

	await page.getByLabel('Beschreibung').fill('Netflix');
	await page.getByLabel('Betrag').fill('12,34');
	const dueDate = page.getByLabel('Erste Fälligkeit');
	await dueDate.fill('');
	await page.getByRole('button', { name: 'Abo anlegen', exact: true }).click();

	expect(post.bodies).toHaveLength(0);
	await expect(dueDate).toBeFocused();
	await expect(dueDate).toHaveValue('');
	await expect
		.poll(() => dueDate.evaluate((input) => (input as HTMLInputElement).validity.valid))
		.toBe(false);

	await dueDate.fill('2026-09-22');
	await expect(dueDate).toHaveValue('2026-09-22');
	await page.getByRole('button', { name: 'Abo anlegen', exact: true }).click();
	await expect.poll(() => post.bodies.length).toBe(1);
	await expect.poll(() => post.statuses.length).toBe(1);

	const payload = post.bodies[0] as { nextDueAt: string };
	expect(berlinCalendarDate(payload.nextDueAt)).toBe('2026-09-22');
});

test('calendar all-day creation keeps start and end on the same calendar day', async ({ page }) => {
	const post = await interceptValidationPost(page, 'events');
	await openCalendarCreate(page, MOBILE_VIEWPORT);

	await page.getByLabel('Titel').fill('WG-Termin');
	const start = page.getByLabel('Beginn');
	const end = page.getByLabel('Ende (optional)');
	await start.fill('2026-09-22T14:00');
	await end.fill('2026-09-22T15:00');
	await page.getByRole('checkbox', { name: 'Ganztägig', exact: true }).click();

	await expect(start).toHaveValue('2026-09-22');
	await expect(end).toHaveValue('2026-09-22');
	await page.getByRole('button', { name: 'Termin speichern', exact: true }).click();
	await expect.poll(() => post.bodies.length).toBe(1);
	await expect.poll(() => post.statuses.length).toBe(1);

	const payload = post.bodies[0] as {
		allDay: boolean;
		startsAt: string;
		endsAt: string | null;
	};
	expect(payload.allDay).toBe(true);
	expect(payload.endsAt).not.toBeNull();
	expect(berlinCalendarDate(payload.startsAt)).toBe('2026-09-22');
	expect(berlinCalendarDate(payload.endsAt as string)).toBe('2026-09-22');
	await expect(page.getByText('Endzeit liegt vor Startzeit.', { exact: true })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Neuer Termin', exact: true })).toBeVisible();
	await expect(page.getByText('0 Termine', { exact: true })).toBeVisible();
});

test('calendar reports a missing start only on save and leaves the end unchanged', async ({
	page,
}) => {
	const post = await interceptValidationPost(page, 'events');
	await openCalendarCreate(page, MOBILE_VIEWPORT);
	await page.getByLabel('Titel').fill('WG-Termin');

	const start = page.getByLabel('Beginn');
	const end = page.getByLabel('Ende (optional)');
	await start.fill('2026-09-22T14:00');
	await end.fill('2026-09-22T15:00');
	await start.fill('');

	await expect(end).toHaveValue('2026-09-22T15:00');
	await expect(page.getByText('Startzeitpunkt fehlt.', { exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'Termin speichern', exact: true }).click();

	expect(post.bodies).toHaveLength(0);
	await expect(start).toBeFocused();
	await expect
		.poll(() => start.evaluate((input) => (input as HTMLInputElement).validity.valueMissing))
		.toBe(true);
	await expect(start).toHaveValue('');
	await expect(end).toHaveValue('2026-09-22T15:00');
});

test('calendar create keeps date drafts after close and reopen at normal width', async ({
	page,
}) => {
	await openCalendarCreate(page, NORMAL_VIEWPORT);

	const startValue = '2026-09-22T14:00';
	const endValue = '2026-09-22T15:00';
	await page.getByLabel('Beginn').fill(startValue);
	await page.getByLabel('Ende (optional)').fill(endValue);
	await page.getByRole('button', { name: 'Schließen · Entwurf behalten', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Neuer Termin', exact: true })).toBeHidden();

	await page.getByRole('button', { name: 'Termin hinzufügen', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Neuer Termin', exact: true })).toBeVisible();
	await expect(page.getByLabel('Beginn')).toHaveValue(startValue);
	await expect(page.getByLabel('Ende (optional)')).toHaveValue(endValue);
});
