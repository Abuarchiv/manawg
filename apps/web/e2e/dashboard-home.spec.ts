// Start overview home cards, large-data render limit and member avatar colors.
// Why: The first screen aggregates every feature; cards must stay correct with large data.

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
	skipUnlessFixtures,
} from './support/helpers';

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
				// Scroll all the way down like a user: the page reserves room at the bottom for the navigation.
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
		await expect(confirm).toContainText('Wird gespeichert…');

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

test.describe('large data render limit', () => {
	skipUnlessFixtures();

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
	skipUnlessFixtures();

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
