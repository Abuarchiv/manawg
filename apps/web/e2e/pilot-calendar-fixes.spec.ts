import { type Route, expect, test } from '@playwright/test';
import { computeTomorrowUtcWindow } from '../src/features/events/event-reminder-window';
import {
	type EventInput,
	expandAgendaRecurrence,
	expandRecurrence,
} from '../src/features/events/events';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

const ALL_DAY_EVENT: EventInput = {
	id: 'all-day-pilot',
	title: 'Pilottag',
	description: null,
	startsAt: '2026-09-29T00:00:00.000Z',
	endsAt: null,
	allDay: true,
	location: null,
	recurrence: null,
};

function expandAgenda(event: EventInput, from: string | Date, to: string | Date) {
	return expandAgendaRecurrence(event, new Date(from), new Date(to));
}

test('keeps a started all-day event in the evening agenda window', () => {
	const occurrences = expandAgenda(
		ALL_DAY_EVENT,
		'2026-09-29T18:00:00.000Z',
		'2026-09-29T22:00:00.000Z',
	);

	expect(occurrences).toHaveLength(1);
	expect(occurrences[0]?.startsAt).toBe('2026-09-29T00:00:00.000Z');
});

test('keeps inclusive multi-day all-day overlap across the Berlin fall DST date', () => {
	const occurrences = expandAgenda(
		{
			...ALL_DAY_EVENT,
			id: 'multi-day-pilot',
			startsAt: '2026-10-24T00:00:00.000Z',
			endsAt: '2026-10-25T00:00:00.000Z',
			recurrence: null,
		},
		'2026-10-25T18:00:00.000Z',
		'2026-10-25T22:00:00.000Z',
	);

	expect(occurrences).toHaveLength(1);
	expect(occurrences[0]).toMatchObject({
		startsAt: '2026-10-24T00:00:00.000Z',
		endsAt: '2026-10-25T00:00:00.000Z',
	});
});

test('uses Berlin calendar boundaries for all-day overlap and recurrence search', () => {
	const previousTimezone = process.env.TZ;
	process.env.TZ = 'Europe/Berlin';
	try {
		expect(
			expandAgenda(ALL_DAY_EVENT, '2026-09-28T22:01:00.000Z', '2026-09-28T23:00:00.000Z'),
		).toHaveLength(1);
		expect(
			expandAgenda(ALL_DAY_EVENT, '2026-09-29T22:30:00.000Z', '2026-09-29T23:00:00.000Z'),
		).toHaveLength(0);

		const fallDstEvent = { ...ALL_DAY_EVENT, startsAt: '2026-10-25T00:00:00.000Z' };
		expect(
			expandAgenda(fallDstEvent, '2026-10-24T22:30:00.000Z', '2026-10-24T23:00:00.000Z'),
		).toHaveLength(1);
		expect(
			expandAgenda(fallDstEvent, '2026-10-25T23:30:00.000Z', '2026-10-26T00:00:00.000Z'),
		).toHaveLength(0);

		const daily = {
			...ALL_DAY_EVENT,
			recurrence: 'FREQ=DAILY;COUNT=2',
		};
		expect(
			expandAgenda(daily, '2026-09-29T22:30:00.000Z', '2026-09-29T23:00:00.000Z').map(
				(occurrence) => occurrence.startsAt,
			),
		).toEqual(['2026-09-30T00:00:00.000Z']);
	} finally {
		if (previousTimezone === undefined) Reflect.deleteProperty(process.env, 'TZ');
		else process.env.TZ = previousTimezone;
	}
});

test('uses the runtime local calendar date before a UTC+14 event marker', () => {
	const previousTimezone = process.env.TZ;
	process.env.TZ = 'Pacific/Kiritimati';
	try {
		expect(
			expandAgenda(
				{ ...ALL_DAY_EVENT, startsAt: '2026-01-01T00:00:00.000Z' },
				'2025-12-31T10:30:00.000Z',
				'2025-12-31T11:00:00.000Z',
			),
		).toHaveLength(1);
		expect(
			expandAgenda(
				{ ...ALL_DAY_EVENT, startsAt: '2026-01-01T00:00:00.000Z' },
				'2026-01-01T10:30:00.000Z',
				'2026-01-01T11:00:00.000Z',
			),
		).toHaveLength(0);
	} finally {
		if (previousTimezone === undefined) Reflect.deleteProperty(process.env, 'TZ');
		else process.env.TZ = previousTimezone;
	}
});

test('cron Berlin window excludes a finished all-day event on a UTC host', () => {
	const window = computeTomorrowUtcWindow(new Date('2026-09-29T09:00:00.000Z'));
	expect(window.start.toISOString()).toBe('2026-09-29T22:00:00.000Z');
	expect(expandRecurrence(ALL_DAY_EVENT, window.start, window.end)).toHaveLength(0);
});

test('edit recurrence uses the canonical select and sends an RFC rule', async ({ page }) => {
	test.skip(
		process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
		'requires the local fixture server',
	);

	const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
	const event = {
		id: '11111111-1111-4111-8111-111111111111',
		title: 'WG-Meeting',
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
	let patchBody: Record<string, unknown> | null = null;
	let patchMethod: string | null = null;
	const handleEventsRoute = async (route: Route): Promise<void> => {
		patchMethod = route.request().method();
		if (patchMethod === 'PATCH') {
			patchBody = route.request().postDataJSON() as Record<string, unknown>;
			await route.fulfill({ json: { event: { ...event, ...patchBody } } });
			return;
		}
		await route.fulfill({ json: { events: [event] } });
	};

	await setupMember(page);
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events*`, handleEventsRoute);
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events/**`, handleEventsRoute);
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/chores*`, (route) =>
		route.fulfill({ json: { chores: [] } }),
	);

	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/kalender`);
	await dismissOnboarding(page);
	await page
		.getByRole('button', { name: 'Termin bearbeiten: WG-Meeting', exact: true })
		.first()
		.click();

	const recurrence = page.locator('#event-edit-recurrence');
	await expect(recurrence).toHaveValue('WEEKLY');
	await recurrence.selectOption('DAILY');
	await page.getByRole('button', { name: 'Speichern', exact: true }).click();
	await expect.poll(() => patchMethod).toBe('PATCH');
	await expect.poll(() => patchBody).toEqual(expect.objectContaining({ recurrence: 'FREQ=DAILY' }));
});

test('keeps complex recurrence on title-only save and replaces it explicitly', async ({ page }) => {
	test.skip(
		process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
		'requires the local fixture server',
	);
	await page.setViewportSize({ width: 320, height: 740 });
	await page.addInitScript(() => localStorage.setItem('manawg-theme', 'light'));

	const complexRule = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;COUNT=4';
	const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
	let event = {
		id: '22222222-2222-4222-8222-222222222222',
		title: 'WG-Meeting',
		description: null,
		startsAt,
		endsAt: null,
		allDay: false,
		location: null,
		recurrence: complexRule,
		wgId: FIXTURE_WG.id,
		createdByMemberId: FIXTURE_WG.memberId,
		createdAt: startsAt,
		updatedAt: startsAt,
	};
	const patches: Array<Record<string, unknown>> = [];
	const handleEventsRoute = async (route: Route): Promise<void> => {
		if (route.request().method() === 'PATCH') {
			const patch = route.request().postDataJSON() as Record<string, unknown>;
			patches.push(patch);
			event = { ...event, ...patch };
			await route.fulfill({ json: { event } });
			return;
		}
		await route.fulfill({ json: { events: [event] } });
	};

	await setupMember(page);
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events*`, handleEventsRoute);
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/events/**`, handleEventsRoute);
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/chores*`, (route) =>
		route.fulfill({ json: { chores: [] } }),
	);

	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/kalender`);
	await dismissOnboarding(page);
	const openEdit = (title: string) =>
		page.getByRole('button', { name: `Termin bearbeiten: ${title}`, exact: true }).first();
	await openEdit('WG-Meeting').click();

	const recurrence = page.locator('#event-edit-recurrence');
	await expect(recurrence).toHaveValue('__keep__');
	await recurrence.scrollIntoViewIfNeeded();
	await page.screenshot({ path: test.info().outputPath('calendar-edit-light.png') });
	await page.evaluate(() => {
		localStorage.setItem('manawg-theme', 'dark');
	});
	await page.addInitScript(() => localStorage.setItem('manawg-theme', 'dark'));
	await page.reload({ waitUntil: 'domcontentloaded' });
	await dismissOnboarding(page);
	await openEdit('WG-Meeting').click();
	await expect(page.locator('html')).toHaveClass(/dark/);
	await expect(recurrence).toHaveValue('__keep__');
	await recurrence.scrollIntoViewIfNeeded();
	await page.screenshot({ path: test.info().outputPath('calendar-edit-dark.png') });
	await page.locator('#event-edit-title').fill('WG-Meeting umbenannt');
	await page.getByRole('button', { name: 'Speichern', exact: true }).click();
	await expect.poll(() => patches).toHaveLength(1);
	expect(patches[0]?.recurrence).toBe(complexRule);

	await openEdit('WG-Meeting umbenannt').click();
	await recurrence.selectOption('WEEKLY');
	await page.getByRole('button', { name: 'Speichern', exact: true }).click();
	await expect.poll(() => patches).toHaveLength(2);
	expect(patches[1]?.recurrence).toBe('FREQ=WEEKLY');
});
