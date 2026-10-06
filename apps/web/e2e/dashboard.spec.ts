// Start/daily overview: read models (Berlin week agenda, ranking), home cards, navigation, large-data limits.
// Why: the first screen aggregates every feature; ordering and day edges must be deterministic.

import { type Page, expect, test } from '@playwright/test';
import { getBerlinWeekWindow } from '../src/composition/dashboard-insights';
import { instantAtBerlinWallTime } from '../src/core/utils/berlin-day';
import {
	FIXTURE_WG,
	dismissOnboarding,
	mockDashboard,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
} from './_helpers';

test.describe('daily overview home', () => {
	const BASE = '/api/wg/MTE8PZAT';

	function dayKeyOffset(dayKey: string, offset: number): string {
		const [year, month, day] = dayKey.split('-').map(Number);
		return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + offset))
			.toISOString()
			.slice(0, 10);
	}

	function nextAgendaDay(todayKey: string): string {
		const weekday = new Date(`${todayKey}T00:00:00.000Z`).getUTCDay();
		const daysUntilSunday = (7 - weekday) % 7;
		return dayKeyOffset(todayKey, Math.min(1, daysUntilSunday));
	}

	function atBerlin(dayKey: string, minutes: number): string {
		const date = instantAtBerlinWallTime(dayKey, minutes);
		if (!date) throw new Error(`Invalid Berlin wall time: ${dayKey} ${minutes}`);
		return date.toISOString();
	}

	function fixtureDashboard(dueChores: unknown[] = []) {
		return {
			balances: [
				{
					memberId: FIXTURE_WG.memberId,
					memberName: FIXTURE_WG.memberName,
					color: null,
					paidCents: 0,
					owedCents: 1250,
					balanceCents: -1250,
					currency: 'EUR',
				},
				{
					memberId: 'anna',
					memberName: 'Anna',
					color: null,
					paidCents: 1250,
					owedCents: 0,
					balanceCents: 1250,
					currency: 'EUR',
				},
				{
					memberId: FIXTURE_WG.memberId,
					memberName: FIXTURE_WG.memberName,
					color: null,
					paidCents: 300,
					owedCents: 0,
					balanceCents: 300,
					currency: 'CHF',
				},
				{
					memberId: 'anna',
					memberName: 'Anna',
					color: null,
					paidCents: 0,
					owedCents: 300,
					balanceCents: -300,
					currency: 'CHF',
				},
			],
			spendByDay: [],
			totalSpendByCurrency: {},
			weekSpendByCurrency: {},
			monthSpendByCurrency: {},
			totalSpendCents: null,
			weekSpendCents: null,
			monthSpendCents: null,
			openShoppingCount: 3,
			openShoppingTop: ['Milch'],
			dueChores,
			activity: [],
			latestAnnouncement: null,
			myOpenAnnouncements: [
				{
					id: 'request-1',
					kind: 'request',
					content: 'Paket abholen',
					createdAt: new Date().toISOString(),
				},
			],
			wgHealth: { score: 100, label: 'ruhig', items: [] },
			dueRecurringExpenses: [
				{
					id: 'internet',
					description: 'Internet',
					amountCents: 2990,
					currency: 'EUR',
					nextDueAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
				},
			],
			absentMembers: [],
			setup: {
				choreCount: dueChores.length,
				hasExpense: true,
				hasShoppingItem: true,
				hasAnnouncement: true,
				notificationsEnabled: false,
			},
		};
	}

	async function mockChoresDashboard(page: Page, dueChores: unknown[]) {
		await mockDashboard(page, BASE, fixtureDashboard(dueChores));
		await mockUnreadCount(page, BASE);
	}

	test('shows personal actions and a separate Berlin week agenda', async ({ page }, testInfo) => {
		const fixtureNow = Date.parse('2026-09-27T10:00:00.000Z');
		await page.clock.install({ time: new Date(fixtureNow) });
		await setupMember(page);
		const window = getBerlinWeekWindow(fixtureNow);
		const agendaDay = nextAgendaDay(window.todayKey);
		const previousWeek = dayKeyOffset(agendaDay, -7);
		const yesterday = dayKeyOffset(window.todayKey, -1);
		const chores = [
			{
				id: 'mine',
				title: 'Bad putzen',
				nextDueAt: atBerlin(window.todayKey, 23 * 60),
				overdue: false,
				assignedMemberId: FIXTURE_WG.memberId,
				assignedMemberName: FIXTURE_WG.memberName,
				assignedColor: null,
			},
			{
				id: 'overdue',
				title: 'Flur reinigen',
				nextDueAt: atBerlin(yesterday, 10 * 60),
				overdue: true,
				assignedMemberId: 'anna',
				assignedMemberName: 'Anna',
				assignedColor: null,
			},
			{
				id: 'other',
				title: 'Küche putzen',
				nextDueAt: atBerlin(agendaDay, 11 * 60),
				overdue: false,
				assignedMemberId: 'anna',
				assignedMemberName: 'Anna',
				assignedColor: null,
			},
		];
		await mockChoresDashboard(page, chores);
		await page.route(/\/api\/wg\/MTE8PZAT\/events\?/, (route) =>
			route.fulfill({
				status: 200,
				json: {
					events: [
						{
							id: 'all-day',
							title: 'WG-Frühstück',
							description: null,
							startsAt: `${agendaDay}T00:00:00.000Z`,
							endsAt: null,
							allDay: true,
							location: 'Küche',
							recurrence: null,
						},
						{
							id: 'weekly',
							title: 'WG-Abendessen',
							description: null,
							startsAt: atBerlin(previousWeek, 18 * 60),
							endsAt: null,
							allDay: false,
							location: 'Küche',
							recurrence: 'FREQ=WEEKLY',
						},
					],
				},
			}),
		);

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}`);
		await dismissOnboarding(page);

		const personal = page.getByRole('region', { name: 'Für dich' });
		await expect(personal.getByText('Bad putzen', { exact: true })).toBeVisible();
		await expect(personal.getByText('Flur reinigen', { exact: true })).toHaveCount(0);
		await personal.getByRole('button', { name: 'Weitere anzeigen (2)' }).click();
		await expect(personal.getByText('WG · 3 offene Artikel')).toBeVisible();
		await expect(personal.getByText(/Fixkosten/)).toBeVisible();
		await expect(personal.getByText('An Anna', { exact: true })).toBeVisible();
		await expect(personal.getByText('Von Anna', { exact: true })).toBeVisible();
		await expect(personal.getByText(/12,50/)).toBeVisible();
		const euroAmount = personal.locator('span.font-mono.tabular-nums').filter({ hasText: '12,50' });
		const chfAmount = personal.locator('span.font-mono.tabular-nums').filter({ hasText: '3,00' });
		await expect(euroAmount).toHaveCount(1);
		await expect(euroAmount).toHaveClass(/font-medium/);
		await expect(euroAmount).toHaveText(/-12,50\s*€/);
		await expect(chfAmount).toHaveCount(1);
		await expect(chfAmount).toHaveClass(/font-medium/);
		await expect(chfAmount).toHaveText(/\+3,00\s*CHF/);

		const agenda = page.getByRole('region', { name: 'Diese Woche' });
		await expect(agenda.getByRole('heading', { name: 'Überfällig' })).toBeVisible();
		await expect(agenda.getByText('Flur reinigen', { exact: true })).toBeVisible();
		await expect(agenda.getByText('Küche putzen', { exact: true })).toBeVisible();
		await expect(agenda.getByText('WG-Frühstück', { exact: true })).toBeVisible();
		await expect(agenda.getByText('WG-Abendessen', { exact: true })).toBeVisible();
		await expect(agenda.getByText('Bad putzen', { exact: true })).toHaveCount(0);

		const weekHeader = agenda.locator(':scope > div').first();
		const weekHeading = agenda.getByRole('heading', { name: 'Diese Woche' });
		const calendarLink = agenda.getByRole('link', { name: 'Kalender' });
		for (const theme of ['light', 'dark'] as const) {
			for (const width of [320, 360, 390]) {
				await page.setViewportSize({ width, height: 844 });
				await page.emulateMedia({ colorScheme: theme });
				await expect
					.poll(() => page.locator('html').evaluate((node) => node.classList.contains('dark')))
					.toBe(theme === 'dark');
				await page.evaluate(() => globalThis.scrollTo(0, 0));
				const layout = await page.evaluate(() => ({
					viewport: document.documentElement.clientWidth,
					page: document.documentElement.scrollWidth,
				}));
				expect(layout.page).toBeLessThanOrEqual(layout.viewport);
				await expect(calendarLink).toBeVisible();
				const [rootFontSize, hitTarget] = await Promise.all([
					page
						.locator('html')
						.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize)),
					calendarLink.evaluate((node) => {
						const target = getComputedStyle(node, '::after');
						return {
							height: Number.parseFloat(target.height),
							minWidth: Number.parseFloat(target.minWidth),
						};
					}),
				]);
				expect(rootFontSize).toBeLessThan(32);
				expect(hitTarget.height).toBeGreaterThanOrEqual(44);
				expect(hitTarget.minWidth).toBeGreaterThanOrEqual(44);
				await calendarLink.focus();
				await expect(calendarLink).toBeFocused();
				await weekHeader.screenshot({
					path: testInfo.outputPath(`week-header-${width}-${theme}.png`),
					animations: 'disabled',
				});
				await page.screenshot({
					path: testInfo.outputPath(`home-${width}-${theme}.png`),
					animations: 'disabled',
				});

				const lastAgendaRow = agenda.getByText('WG-Abendessen', { exact: true });
				// Ganz nach unten scrollen wie ein Nutzer: die Seite hält unten Platz für die Navigation frei.
				// `instant`: html has scroll-behavior:smooth, so a plain scrollTo would still be animating.
				await page.evaluate(() =>
					globalThis.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
				);
				const [rowBounds, navBounds] = await Promise.all([
					lastAgendaRow.evaluate((node) => node.getBoundingClientRect().toJSON()),
					page
						.locator('nav[data-app-chrome]')
						.evaluate((node) => node.getBoundingClientRect().toJSON()),
				]);
				expect(rowBounds.bottom).toBeLessThanOrEqual(navBounds.top);
				await page.screenshot({
					path: testInfo.outputPath(`home-agenda-${width}-${theme}.png`),
					animations: 'disabled',
				});
			}
		}

		for (const theme of ['light', 'dark'] as const) {
			for (const width of [320, 360, 390]) {
				await page.setViewportSize({ width, height: 844 });
				await page.emulateMedia({ colorScheme: theme });
				await expect
					.poll(() => page.locator('html').evaluate((node) => node.classList.contains('dark')))
					.toBe(theme === 'dark');
				await page.locator('html').evaluate((node) => {
					node.style.fontSize = '32px';
				});
				await page.evaluate(() => globalThis.scrollTo(0, 0));

				await expect(calendarLink).toBeVisible();
				const [rootFontSize, headingFontSize, hitTarget] = await Promise.all([
					page
						.locator('html')
						.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize)),
					weekHeading.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize)),
					calendarLink.evaluate((node) => {
						const target = getComputedStyle(node, '::after');
						return {
							height: Number.parseFloat(target.height),
							minWidth: Number.parseFloat(target.minWidth),
						};
					}),
				]);
				expect(rootFontSize).toBe(32);
				expect(headingFontSize).toBeGreaterThanOrEqual(26);
				expect(hitTarget.height).toBeGreaterThanOrEqual(44);
				expect(hitTarget.minWidth).toBeGreaterThanOrEqual(44);
				await calendarLink.focus();
				await expect(calendarLink).toBeFocused();

				const layout = await page.evaluate(() => ({
					viewport: document.documentElement.clientWidth,
					page: document.documentElement.scrollWidth,
				}));
				expect(layout.page).toBeLessThanOrEqual(layout.viewport);
				await weekHeader.screenshot({
					path: testInfo.outputPath(`week-header-32px-${width}-${theme}.png`),
					animations: 'disabled',
				});
				await page.screenshot({
					path: testInfo.outputPath(`home-32px-${width}-${theme}.png`),
					animations: 'disabled',
				});
			}
		}
	});

	test('keeps chores visible when the independent event read fails', async ({ page }) => {
		await setupMember(page);
		const window = getBerlinWeekWindow(Date.now());
		const agendaDay = nextAgendaDay(window.todayKey);
		await mockChoresDashboard(page, [
			{
				id: 'other',
				title: 'Küche putzen',
				nextDueAt: atBerlin(agendaDay, 11 * 60),
				overdue: false,
				assignedMemberId: 'anna',
				assignedMemberName: 'Anna',
				assignedColor: null,
			},
		]);
		await page.route(/\/api\/wg\/MTE8PZAT\/events\?/, (route) =>
			route.fulfill({ status: 503, json: { error: 'temporarily_unavailable' } }),
		);

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}`);
		await dismissOnboarding(page);

		const agenda = page.getByRole('region', { name: 'Diese Woche' });
		await expect(agenda.getByText('Küche putzen', { exact: true })).toBeVisible();
		await expect(agenda.getByText('Termine konnten nicht geladen werden.')).toBeVisible();
		await expect(agenda.getByText(/keine Termine oder Putzaufgaben/i)).toHaveCount(0);
	});

	test('keeps one completion key across 5xx, 429, and offline retries', async ({ page }) => {
		await setupMember(page);
		const window = getBerlinWeekWindow(Date.now());
		const chore = {
			id: 'mine',
			title: 'Bad putzen',
			nextDueAt: atBerlin(window.todayKey, 23 * 60),
			overdue: false,
			assignedMemberId: FIXTURE_WG.memberId,
			assignedMemberName: FIXTURE_WG.memberName,
			assignedColor: null,
		};
		let dashboardReads = 0;
		await page.route(`**${BASE}/dashboard`, (route) => {
			dashboardReads += 1;
			return route.fulfill({
				status: 200,
				json: fixtureDashboard(dashboardReads === 1 ? [chore] : []),
			});
		});
		await mockUnreadCount(page, BASE);
		await page.route(/\/api\/wg\/MTE8PZAT\/events\?/, (route) =>
			route.fulfill({ status: 200, json: { events: [] } }),
		);
		const attempts: Array<number | 'offline'> = [503, 429, 'offline', 200];
		const idempotencyKeys: string[] = [];
		await page.route(/\/api\/wg\/MTE8PZAT\/chores\/mine\/complete$/, async (route) => {
			const response = attempts[idempotencyKeys.length];
			idempotencyKeys.push(route.request().headers()['idempotency-key'] ?? '');
			if (response === 'offline') return route.abort('failed');
			return route.fulfill({
				status: response ?? 500,
				json: response === 200 ? { ok: true } : { error: 'temporarily_unavailable' },
			});
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}`);
		await dismissOnboarding(page);
		// After a failure the dialog stays open: retrying only means confirming again.
		const confirmCompletion = async (): Promise<void> => {
			await page.getByRole('button', { name: 'Erledigt bestätigen: Bad putzen' }).click();
		};
		const dialogError = page
			.getByRole('alertdialog')
			.getByText('Erledigt-Aktion konnte nicht gespeichert werden: Versuche es gleich erneut.');

		await page.getByRole('button', { name: 'Als erledigt markieren: Bad putzen' }).click();
		await confirmCompletion();
		await expect(dialogError).toBeVisible();
		await confirmCompletion();
		await expect(dialogError).toBeVisible();
		// Offline the completion is queued like in the cleaning plan, with the same key.
		await confirmCompletion();
		await expect(page.getByText(/Erledigung offline vorgemerkt/)).toBeVisible();
		await expect(page.getByRole('alertdialog')).toHaveCount(0);
		await expect(page.getByText('Bad putzen', { exact: true })).toHaveCount(0);
		// With the dialog closed, a fourth request can only be the sync replaying the queued key.
		await page.evaluate(() => globalThis.dispatchEvent(new Event('online')));
		await expect.poll(() => idempotencyKeys.length).toBe(4);
		expect(new Set(idempotencyKeys).size).toBe(1);
	});

	test('shows a saving label and keeps focus while a completion request is in flight', async ({
		page,
	}) => {
		await setupMember(page);
		const chore = {
			id: 'mine',
			title: 'Bad putzen',
			nextDueAt: atBerlin(getBerlinWeekWindow(Date.now()).todayKey, 23 * 60),
			overdue: false,
			assignedMemberId: FIXTURE_WG.memberId,
			assignedMemberName: FIXTURE_WG.memberName,
			assignedColor: null,
		};
		await mockChoresDashboard(page, [chore]);
		await page.route(/\/api\/wg\/MTE8PZAT\/events\?/, (route) =>
			route.fulfill({ status: 200, json: { events: [] } }),
		);
		let resolveComplete: (() => void) | undefined;
		const held = new Promise<void>((resolve) => {
			resolveComplete = resolve;
		});
		await page.route(/\/api\/wg\/MTE8PZAT\/chores\/mine\/complete$/, async (route) => {
			await held;
			return route.fulfill({ status: 200, json: { ok: true } });
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: 'Als erledigt markieren: Bad putzen' }).click();
		await page.getByRole('button', { name: 'Erledigt bestätigen: Bad putzen' }).click();

		// While the request is in flight the confirm button keeps focus (aria-disabled,
		// not disabled) and the row subtitle says it is saving.
		const confirm = page.getByRole('button', { name: 'Erledigt bestätigen: Bad putzen' });
		await expect(confirm).toHaveAttribute('aria-disabled', 'true');
		await expect(confirm).toBeFocused();
		await expect(page.getByText('Wird gespeichert…')).toBeVisible();

		resolveComplete?.();
		await expect(page.getByText('Bad putzen erledigt.')).toBeVisible();
	});

	test('does not show a settled or empty state when the dashboard read fails', async ({ page }) => {
		await setupMember(page);
		await page.route(`**${BASE}/dashboard`, (route) =>
			route.fulfill({ status: 503, json: { error: 'temporarily_unavailable' } }),
		);
		await mockUnreadCount(page, BASE);
		await page.route(/\/api\/wg\/MTE8PZAT\/events\?/, (route) =>
			route.fulfill({ status: 200, json: { events: [] } }),
		);

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}`);
		await dismissOnboarding(page);

		const personal = page.getByRole('region', { name: 'Für dich' });
		await expect(
			personal.getByText('Deine persönlichen Aufgaben konnten nicht geladen werden.'),
		).toBeVisible();
		await expect(page.getByText('Alles erledigt.', { exact: false })).toHaveCount(0);
		await expect(page.getByText('Ausgeglichen', { exact: true })).toHaveCount(0);
	});

	test('refreshes the agenda range after Berlin midnight on resume', async ({ page }) => {
		await page.clock.install({ time: new Date('2026-09-27T21:59:30.000Z') });
		await setupMember(page);
		await mockChoresDashboard(page, []);
		await mockUnreadCount(page, BASE);
		const eventRangeStarts: string[] = [];
		await page.route(/\/api\/wg\/MTE8PZAT\/events\?/, (route) => {
			const url = new URL(route.request().url());
			eventRangeStarts.push(url.searchParams.get('from') ?? '');
			return route.fulfill({ status: 200, json: { events: [] } });
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}`);
		await dismissOnboarding(page);
		await expect.poll(() => eventRangeStarts.length).toBe(1);
		await expect(eventRangeStarts[0]).toBe('2026-09-26T22:00:00.000Z');

		await page.clock.fastForward(60_000);
		await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
		await expect.poll(() => eventRangeStarts.includes('2026-09-27T22:00:00.000Z')).toBe(true);
	});
});

test.describe('daily overview navigation', () => {
	const BASE = '/api/wg/MTE8PZAT';

	test('keeps Kalender in Austausch and shows confirmed unread count', async ({ page }) => {
		await setupMember(page);
		let dashboardReads = 0;
		let unreadReads = 0;
		await page.route(`**${BASE}/dashboard`, (route) => {
			dashboardReads += 1;
			return route.fulfill({
				status: 200,
				json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] },
			});
		});
		await page.route(`**${BASE}/chat/unread-count`, (route) => {
			unreadReads += 1;
			return route.fulfill({ status: 200, json: { count: 7, overflow: false } });
		});

		await navigateToFeature(page, '/wg/MTE8PZAT/kalender');
		await dismissOnboarding(page);

		const exchange = page.getByRole('navigation', { name: 'Austausch' });
		await expect(exchange.getByRole('link', { name: 'Pinnwand' })).toBeVisible();
		await expect(exchange.getByRole('link', { name: 'Chat, 7 ungelesen' })).toBeVisible();
		await expect(exchange.getByRole('link', { name: 'Kalender' })).toHaveAttribute(
			'aria-current',
			'page',
		);
		await expect(page.getByText('0 WG-Termine', { exact: true })).toBeVisible();
		await expect(page.getByText('Bad putzen', { exact: true })).toBeVisible();
		await expect(exchange.getByRole('link')).toHaveCount(3);
		await expect.poll(() => unreadReads).toBe(1);
		await expect.poll(() => dashboardReads).toBe(0);
	});

	test('marks an unavailable count without fabricating zero', async ({ page }) => {
		await setupMember(page);
		await mockDashboard(page, BASE, {
			openShoppingCount: 0,
			dueChores: [],
			dueRecurringExpenses: [],
		});
		await page.route(`**${BASE}/chat/unread-count`, (route) =>
			route.fulfill({ status: 503, json: { error: 'temporarily_unavailable' } }),
		);

		await navigateToFeature(page, '/wg/MTE8PZAT/kalender');
		await dismissOnboarding(page);

		const exchange = page.getByRole('navigation', { name: 'Austausch' });
		await expect(
			exchange.getByRole('link', { name: 'Chat, Zähler nicht verfügbar' }),
		).toBeVisible();
	});

	test('hides confirmed zero visually and keeps its meaning accessible', async ({ page }) => {
		await setupMember(page);
		await mockDashboard(page, BASE, {
			openShoppingCount: 0,
			dueChores: [],
			dueRecurringExpenses: [],
		});
		await mockUnreadCount(page, BASE);

		await navigateToFeature(page, '/wg/MTE8PZAT/kalender');
		await dismissOnboarding(page);

		const chat = page.getByRole('navigation', { name: 'Austausch' }).getByRole('link', {
			name: 'Chat, 0 ungelesen',
		});
		await expect(chat).toBeVisible();
		await expect(chat).toHaveText('Chat');
	});

	test('caps visible shopping counts and counts only the viewer’s due chores', async ({ page }) => {
		await setupMember(page);
		const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
		const nextQuarter = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
		await mockDashboard(page, BASE, {
			openShoppingCount: 123,
			dueChores: [
				{
					id: 'mine-due',
					assignedMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
					nextDueAt: yesterday,
				},
				{ id: 'theirs-due', assignedMemberId: 'other-member', nextDueAt: yesterday },
				{
					id: 'mine-later',
					assignedMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
					nextDueAt: nextQuarter,
				},
			],
			dueRecurringExpenses: [],
		});
		await mockUnreadCount(page, BASE);

		await navigateToFeature(page, '/wg/MTE8PZAT/vorraete');
		await dismissOnboarding(page);

		const household = page.getByRole('navigation', { name: 'Haushalt' });
		const shopping = household.getByRole('link', { name: 'Einkäufe, 123 offen' });
		await expect(shopping).toBeVisible();
		await expect(shopping).toHaveText('Einkäufe99+');
		await expect(
			household.getByRole('link', { name: 'Putzplan, 1 für dich fällig' }),
		).toBeVisible();
	});

	test('reconciles the Shopping count after success, rollback, and offline queueing', async ({
		page,
	}) => {
		await setupMember(page);
		await mockDashboard(page, BASE, {
			openShoppingCount: 2,
			dueChores: [],
			dueRecurringExpenses: [],
		});
		await mockUnreadCount(page, BASE);
		const createdAt = new Date(Date.now() - 60_000).toISOString();
		const coffee = {
			id: 'coffee',
			name: 'Kaffee',
			normalizedName: 'kaffee',
			quantity: null,
			boughtAt: null as string | null,
			boughtByMemberId: null as string | null,
			addedByMemberId: FIXTURE_WG.memberId,
			createdAt,
			updatedAt: createdAt,
		};
		const milk = { ...coffee, id: 'milk', name: 'Milch', normalizedName: 'milch' };
		let serverItems = [coffee, milk];
		await page.route(`**${BASE}/shopping`, (route) => {
			if (route.request().method() !== 'GET') return route.continue();
			return route.fulfill({ status: 200, json: { items: serverItems } });
		});
		await page.route(`**${BASE}/shopping/coffee`, (route) => {
			if (route.request().method() !== 'PATCH') return route.continue();
			const boughtCoffee = {
				...coffee,
				boughtAt: new Date().toISOString(),
				boughtByMemberId: FIXTURE_WG.memberId,
			};
			serverItems = [boughtCoffee, ...serverItems.slice(1)];
			return route.fulfill({ status: 200, json: { item: boughtCoffee } });
		});
		let milkPatchCount = 0;
		let markFailureStarted: () => void = () => {};
		let releaseFailure: () => void = () => {};
		const failureStarted = new Promise<void>((resolve) => {
			markFailureStarted = resolve;
		});
		const failureGate = new Promise<void>((resolve) => {
			releaseFailure = resolve;
		});
		await page.route(`**${BASE}/shopping/milk`, async (route) => {
			if (route.request().method() !== 'PATCH') return route.continue();
			milkPatchCount += 1;
			if (milkPatchCount === 1) {
				markFailureStarted();
				await failureGate;
				return route.fulfill({ status: 500, json: { error: 'temporarily_unavailable' } });
			}
			return route.abort('failed');
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einkauf`);
		await dismissOnboarding(page);
		const household = page.getByRole('navigation', { name: 'Haushalt' });
		await expect(household.getByRole('link', { name: 'Einkäufe, 2 offen' })).toBeVisible();

		await page.getByRole('checkbox', { name: 'Kaffee erledigen' }).click();
		await expect(household.getByRole('link', { name: 'Einkäufe, 1 offen' })).toBeVisible();

		await page.getByRole('checkbox', { name: 'Milch erledigen' }).click();
		await failureStarted;
		await expect(household.getByRole('link', { name: 'Einkäufe' })).toHaveText('Einkäufe');
		releaseFailure();
		await expect(household.getByRole('link', { name: 'Einkäufe, 1 offen' })).toBeVisible();

		await page.getByRole('checkbox', { name: 'Milch erledigen' }).click();
		await expect.poll(() => milkPatchCount).toBe(2);
		await expect(household.getByRole('link', { name: 'Einkäufe' })).toHaveText('Einkäufe');
		await expect(
			page.getByText('Offline vorgemerkt. Der Artikel wird später als erledigt synchronisiert.'),
		).toBeVisible();
	});

	test('keeps unread count after a failed chat read acknowledgement', async ({ page }) => {
		await setupMember(page);
		await mockDashboard(page, BASE, {
			openShoppingCount: 0,
			dueChores: [],
			dueRecurringExpenses: [],
		});
		await page.route(`**${BASE}/chat/unread-count`, (route) =>
			route.fulfill({ status: 200, json: { count: 6, overflow: false } }),
		);
		let readAcknowledgements = 0;
		await page.route(`**${BASE}/chat/read`, (route) => {
			readAcknowledgements += 1;
			return route.fulfill({ status: 503, json: { error: 'temporarily_unavailable' } });
		});

		await navigateToFeature(page, '/wg/MTE8PZAT/chat');
		await dismissOnboarding(page);

		const chat = page.getByRole('navigation', { name: 'Austausch' }).getByRole('link', {
			name: 'Chat, 6 ungelesen',
		});
		await expect(chat).toBeVisible();
		await expect.poll(() => readAcknowledgements).toBeGreaterThan(0);
		await expect(chat).toHaveAccessibleName('Chat, 6 ungelesen');
	});

	test('refreshes the Chat count after a successful read acknowledgement', async ({ page }) => {
		await setupMember(page);
		await mockDashboard(page, BASE, {
			openShoppingCount: 0,
			dueChores: [],
			dueRecurringExpenses: [],
		});
		let unreadReads = 0;
		let acknowledged = false;
		let readAcknowledgements = 0;
		let markReadStarted: () => void = () => {};
		let releaseRead: () => void = () => {};
		const readStarted = new Promise<void>((resolve) => {
			markReadStarted = resolve;
		});
		const readGate = new Promise<void>((resolve) => {
			releaseRead = resolve;
		});
		await page.route(`**${BASE}/chat/unread-count`, (route) => {
			unreadReads += 1;
			return route.fulfill({
				status: 200,
				json: {
					count: acknowledged ? 0 : 6,
					exactCount: acknowledged ? 0 : 6,
					overflow: false,
				},
			});
		});
		await page.route(`**${BASE}/chat/read`, async (route) => {
			readAcknowledgements += 1;
			markReadStarted();
			await readGate;
			acknowledged = true;
			return route.fulfill({ status: 200, json: { ok: true } });
		});
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/chat`);
		await dismissOnboarding(page);
		const exchange = page.getByRole('navigation', { name: 'Austausch' });
		const unreadChat = exchange.getByRole('link', { name: 'Chat, 6 ungelesen' });
		await expect(unreadChat).toBeVisible();
		await readStarted;
		await expect(unreadChat).toBeVisible();
		releaseRead();
		await expect.poll(() => readAcknowledgements).toBeGreaterThan(0);
		await expect.poll(() => unreadReads).toBeGreaterThan(1);
		const readConfirmedChat = exchange.getByRole('link', { name: 'Chat, 0 ungelesen' });
		await expect(readConfirmedChat).toBeVisible();
		await expect(readConfirmedChat).toHaveText('Chat');
	});

	test('announces the exact unread total while keeping the visible badge capped', async ({
		page,
	}) => {
		await setupMember(page);
		await mockDashboard(page, BASE, {
			openShoppingCount: 0,
			dueChores: [],
			dueRecurringExpenses: [],
		});
		await page.route(`**${BASE}/chat/unread-count`, (route) =>
			route.fulfill({
				status: 200,
				json: { count: 99, exactCount: 147, overflow: true },
			}),
		);

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}`);
		await dismissOnboarding(page);
		const chatTopLink = page.getByRole('link', { name: 'Chat öffnen, 147 ungelesen' });
		await expect(chatTopLink).toBeVisible();
		await expect(chatTopLink.getByText('99+', { exact: true })).toBeVisible();
		await expect(chatTopLink.locator('[aria-live="polite"]')).toHaveText(
			'147 ungelesene Nachrichten',
		);

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/kalender`);
		const exchange = page.getByRole('navigation', { name: 'Austausch' });
		const chatSegment = exchange.getByRole('link', { name: 'Chat, 147 ungelesen' });
		await expect(chatSegment).toBeVisible();
		await expect(chatSegment).toHaveText('Chat99+');
	});

	test('respects motion and contrast preferences and fits tablet widths', async ({
		page,
	}, testInfo) => {
		await setupMember(page);
		await mockDashboard(page, BASE, {
			openShoppingCount: 0,
			dueChores: [],
			dueRecurringExpenses: [],
		});
		await page.route(`**${BASE}/chat/unread-count`, (route) =>
			route.fulfill({
				status: 200,
				json: { count: 99, exactCount: 147, overflow: true },
			}),
		);

		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ contrast: 'more', reducedMotion: 'reduce' });
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/kalender`);
		await dismissOnboarding(page);

		const exchange = page.getByRole('navigation', { name: 'Austausch' });
		await expect(exchange.getByRole('link', { name: 'Pinnwand' })).toBeVisible();
		await expect(exchange.getByRole('link', { name: 'Chat, 147 ungelesen' })).toBeVisible();
		await expect(exchange.getByRole('link', { name: 'Kalender' })).toBeVisible();
		const mobilePreferences = await page.evaluate(() => ({
			reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
			increasedContrast: window.matchMedia('(prefers-contrast: more)').matches,
		}));
		expect(mobilePreferences).toEqual({ reducedMotion: true, increasedContrast: true });
		const transitionMilliseconds = await exchange
			.getByRole('link', { name: 'Chat, 147 ungelesen' })
			.evaluate((node) => {
				const value = getComputedStyle(node).transitionDuration.split(',')[0] ?? '0s';
				const duration = Number.parseFloat(value);
				return value.endsWith('ms') ? duration : duration * 1000;
			});
		expect(transitionMilliseconds).toBeLessThanOrEqual(0.01);
		await page.screenshot({ path: testInfo.outputPath('a11y-contrast-reduced-motion.png') });

		const cdp = await page.context().newCDPSession(page);
		await cdp.send('Emulation.setEmulatedMedia', {
			features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
		});
		const reducesTransparency = await page.evaluate(
			() => window.matchMedia('(prefers-reduced-transparency: reduce)').matches,
		);
		expect(reducesTransparency).toBe(true);
		await page.screenshot({ path: testInfo.outputPath('a11y-reduced-transparency.png') });
		await cdp.detach();

		for (const width of [768, 1024]) {
			await page.setViewportSize({ width, height: 1024 });
			await page.emulateMedia({ contrast: 'no-preference', reducedMotion: 'no-preference' });
			const layout = await page.evaluate(() => ({
				viewport: document.documentElement.clientWidth,
				page: document.documentElement.scrollWidth,
			}));
			expect(layout.page).toBeLessThanOrEqual(layout.viewport);
			await expect(exchange.getByRole('link', { name: 'Pinnwand' })).toBeVisible();
			await expect(exchange.getByRole('link', { name: 'Chat, 147 ungelesen' })).toBeVisible();
			await expect(exchange.getByRole('link', { name: 'Kalender' })).toBeVisible();
			await page.screenshot({ path: testInfo.outputPath(`exchange-tablet-${width}.png`) });
		}
	});

	test('marks cached counts stale when the refresh fails', async ({ page }) => {
		await setupMember(page);
		await mockDashboard(page, BASE, {
			openShoppingCount: 0,
			dueChores: [],
			dueRecurringExpenses: [],
		});
		let unreadReads = 0;
		await page.route(`**${BASE}/chat/unread-count`, (route) => {
			unreadReads += 1;
			return route.fulfill(
				unreadReads === 1
					? { status: 200, json: { count: 8, overflow: false } }
					: { status: 503, json: { error: 'temporarily_unavailable' } },
			);
		});

		await navigateToFeature(page, '/wg/MTE8PZAT/kalender');
		await dismissOnboarding(page);

		const chat = page.getByRole('navigation', { name: 'Austausch' }).getByRole('link', {
			name: 'Chat, 8 ungelesen',
		});
		await expect(chat).toBeVisible();
		await page.evaluate(() => {
			// Focus refreshes are throttled to 10 s after a successful fetch; jump past it.
			const now = Date.now;
			Date.now = () => now() + 60_000;
			window.dispatchEvent(new Event('focus'));
		});
		await expect.poll(() => unreadReads).toBe(2);
		await expect(
			page.getByRole('navigation', { name: 'Austausch' }).getByRole('link', {
				name: 'Chat, 8 ungelesen, Stand möglicherweise veraltet',
			}),
		).toBeVisible();
	});

	test('public Calendar link uses the Exchange segments', async ({ page }) => {
		await page.goto('/entdecken/kalender', { waitUntil: 'domcontentloaded' });

		const exchange = page.getByRole('navigation', { name: 'Austausch – entdecken' });
		await expect(exchange.getByRole('link', { name: 'Pinnwand' })).toBeVisible();
		await expect(exchange.getByRole('link', { name: 'Chat' })).toBeVisible();
		await expect(exchange.getByRole('link', { name: 'Kalender' })).toHaveAttribute(
			'aria-current',
			'page',
		);
		await expect(exchange.getByRole('link')).toHaveCount(3);
	});

	test('keeps all Exchange segments visible at 320 and 390 pixels in both themes', async ({
		page,
	}, testInfo) => {
		await setupMember(page);
		await page.route(`**${BASE}/chat/unread-count`, (route) =>
			route.fulfill({ status: 200, json: { count: 4, overflow: false } }),
		);

		for (const theme of ['light', 'dark'] as const) {
			for (const width of [320, 390]) {
				await page.setViewportSize({ width, height: 844 });
				await page.emulateMedia({ colorScheme: theme });
				await navigateToFeature(page, '/wg/MTE8PZAT/kalender');
				await dismissOnboarding(page);

				const exchange = page.getByRole('navigation', { name: 'Austausch' });
				await expect(exchange.getByRole('link', { name: 'Pinnwand' })).toBeVisible();
				await expect(exchange.getByRole('link', { name: 'Chat, 4 ungelesen' })).toBeVisible();
				await expect(exchange.getByRole('link', { name: 'Kalender' })).toBeVisible();
				const layout = await page.evaluate(() => ({
					viewport: document.documentElement.clientWidth,
					page: document.documentElement.scrollWidth,
				}));
				expect(layout.page).toBeLessThanOrEqual(layout.viewport);
				await page.screenshot({ path: testInfo.outputPath(`exchange-${width}-${theme}.png`) });
			}
		}
	});
});

test.describe('large data render limit', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	const TOTAL = 500;

	test('ausgaben renders only a page of 500 expenses and loads more on demand', async ({
		page,
	}) => {
		const { memberId, memberName, shareCode } = FIXTURE_WG;
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/members`, (route) =>
			route.fulfill({
				json: {
					members: [{ id: memberId, name: memberName, color: null, active: true }],
					viewerIsAdmin: false,
				},
			}),
		);
		await page.route(`**/api/wg/${shareCode}/expenses`, (route) =>
			route.fulfill({
				json: {
					expenses: Array.from({ length: TOTAL }, (_, i) => {
						const at = new Date(Date.UTC(2026, 8, 24) - i * 36 * 3600_000).toISOString();
						return {
							id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
							paidByMemberId: memberId,
							amountCents: 1000 + i,
							currency: 'EUR',
							description: `Ausgabe ${i}`,
							imageUrl: null,
							occurredAt: at,
							createdAt: at,
							updatedAt: at,
							splits: [],
						};
					}),
					payments: [],
				},
			}),
		);
		await page.route(`**/api/wg/${shareCode}/recurring-expenses`, (route) =>
			route.fulfill({ json: { recurringExpenses: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/dashboard`, (route) =>
			route.fulfill({ json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] } }),
		);
		await mockUnreadCount(page, `/api/wg/${shareCode}`);

		await navigateToFeature(page, `/wg/${shareCode}/ausgaben`);
		await dismissOnboarding(page);

		const rows = page.locator('li[id^="expense-"]');
		await expect(rows.first()).toBeVisible();
		await expect(rows).toHaveCount(60);
		await page.getByRole('button', { name: /Mehr anzeigen \(440\)/ }).click();
		await expect(rows).toHaveCount(120);
	});
});

test.describe('member avatar color', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	// Colored avatars are an intentional brand exception (docs/brand/design-language.md).
	test('member avatars get distinct, stable colors per person', async ({ page }) => {
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/members`, async (route) => {
			if (route.request().method() !== 'GET') return route.fallback();
			return route.fulfill({
				json: {
					members: [
						{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName, color: null, active: true },
						{ id: '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55', name: 'Mina', color: null, active: true },
					],
					viewerIsAdmin: true,
				},
			});
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#zugang`);
		const own = page.locator('span[aria-hidden]', { hasText: /^DS$/ }).first();
		const other = page.locator('span[aria-hidden]', { hasText: /^MI$/ }).first();
		await expect(other).toBeVisible();

		const bg = (el: typeof own) => el.evaluate((node) => getComputedStyle(node).backgroundColor);
		const muted = await page.evaluate(() => {
			const probe = document.createElement('div');
			probe.className = 'bg-muted';
			document.body.append(probe);
			const color = getComputedStyle(probe).backgroundColor;
			probe.remove();
			return color;
		});

		const [ownBg, otherBg] = [await bg(own), await bg(other)];
		expect(ownBg).not.toBe(otherBg);
		expect(ownBg).not.toBe(muted);
		expect(otherBg).not.toBe(muted);
		// Same person, same color: every avatar of the viewer on the page matches.
		for (const avatar of await page.locator('span[aria-hidden]', { hasText: /^DS$/ }).all()) {
			expect(await bg(avatar)).toBe(ownBg);
		}
	});
});
