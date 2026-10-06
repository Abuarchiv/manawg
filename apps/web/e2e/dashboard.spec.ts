// Start/daily overview: read models (Berlin week agenda, ranking), home cards, navigation, large-data limits.
// Why: the first screen aggregates every feature; ordering and day edges must be deterministic.

import { type Page, expect, test } from '@playwright/test';
import { initials } from '../src/components/wg/MemberAvatar';
import { groupActivityItemsByDay } from '../src/core/reads/activity';
import {
	getBerlinWeekWindow,
	getForYouItems,
	getTodayImportantItems,
	getWeekAgenda,
} from '../src/core/reads/dashboard-insights';
import { instantAtBerlinWallTime } from '../src/core/utils/berlin-day';
import { formatRelativeTime, formatShortDate, formatWeekLabel } from '../src/core/utils/time';
import { previewBody } from '../src/features/chat/chat-pure';
import type { EventInput, EventOccurrence } from '../src/features/events/events';
import { expandRecurrence } from '../src/features/events/events';
import { buildSettlementSummary, simplifyDebts } from '../src/features/expenses/debt-reduction';
import { parseShoppingInput } from '../src/features/shopping/parse-shopping-input';
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
		await page.waitForTimeout(300);
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
					window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
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
		// Nach einem Fehler bleibt der Dialog offen: Wiederholen heißt nur noch bestätigen.
		const confirmCompletion = async (): Promise<void> => {
			await page.getByRole('button', { name: 'Erledigt bestätigen: Bad putzen' }).click();
		};

		await page.getByRole('button', { name: 'Als erledigt markieren: Bad putzen' }).click();
		await confirmCompletion();
		await expect(
			page.getByText('Erledigt konnte nicht gespeichert werden. Versuche es gleich erneut.'),
		).toBeVisible();
		await confirmCompletion();
		await expect(
			page.getByText('Erledigt konnte nicht gespeichert werden. Versuche es gleich erneut.'),
		).toBeVisible();
		await confirmCompletion();
		await expect(
			page.getByText('Offline: Öffne den Putzplan, dort wird die Erledigung vorgemerkt.'),
		).toBeVisible();
		await confirmCompletion();
		await expect(page.getByText('Bad putzen erledigt.')).toBeVisible();
		await expect.poll(() => idempotencyKeys.length).toBe(4);
		expect(new Set(idempotencyKeys).size).toBe(1);
		await expect(page.getByText('Bad putzen', { exact: true })).toHaveCount(0);
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

test.describe('daily overview model', () => {
	const NOW = Date.parse('2026-09-05T22:30:00.000Z');

	function overview(overrides: Record<string, unknown> = {}) {
		return {
			shareCode: 'WG/1',
			currentMemberId: 'member-me',
			openShoppingCount: 2,
			openShoppingTop: ['Milch'],
			dueChores: [],
			myOpenAnnouncements: [],
			dueRecurringExpenses: [],
			absentMembers: [],
			now: NOW,
			...overrides,
		};
	}

	function event(
		partial: Pick<EventOccurrence, 'eventId' | 'title' | 'startsAt'> & Partial<EventOccurrence>,
	): EventOccurrence {
		return {
			description: null,
			endsAt: null,
			allDay: false,
			location: null,
			recurring: false,
			occurrenceIndex: 0,
			...partial,
		};
	}

	test('separates own chores and labels shared shopping and recurring costs', () => {
		const items = getForYouItems(
			overview({
				dueChores: [
					{
						id: 'mine',
						title: 'Bad',
						nextDueAt: '2026-09-06T09:00:00+02:00',
						overdue: false,
						assignedMemberId: 'member-me',
						assignedMemberName: 'Abu',
					},
					{
						id: 'theirs',
						title: 'Flur',
						nextDueAt: '2026-09-06T10:00:00+02:00',
						overdue: false,
						assignedMemberId: 'member-other',
						assignedMemberName: 'Mina',
					},
				],
				dueRecurringExpenses: [
					{ id: 'internet', description: 'Internet', amountCents: 3000, currency: 'EUR' },
				],
			}),
		);

		expect(items.some((item) => item.entityId === 'mine')).toBe(true);
		expect(items.some((item) => item.entityId === 'theirs')).toBe(false);
		expect(items.find((item) => item.kind === 'shopping')?.detail).toContain('WG');
		expect(items.find((item) => item.kind === 'recurring')?.detail).toContain('Fixkosten');
	});

	test('keeps personal settlements distinct by counterparty and currency', () => {
		const balances = [
			{
				memberId: 'member-me',
				memberName: 'Abu',
				color: null,
				balanceCents: -1000,
				currency: 'EUR',
			},
			{ memberId: 'anna', memberName: 'Anna', color: null, balanceCents: 600, currency: 'EUR' },
			{ memberId: 'ben', memberName: 'Ben', color: null, balanceCents: 400, currency: 'EUR' },
			{ memberId: 'member-me', memberName: 'Abu', color: null, balanceCents: 300, currency: 'CHF' },
			{ memberId: 'anna', memberName: 'Anna', color: null, balanceCents: -300, currency: 'CHF' },
		];
		const settlements = getForYouItems(overview({ openShoppingCount: 0, balances })).filter(
			(item) => item.kind === 'debt',
		);
		const expected = simplifyDebts(
			balances.map(({ balanceCents, ...balance }) => ({ ...balance, cents: balanceCents })),
		).filter((debt) => debt.fromId === 'member-me' || debt.toId === 'member-me');

		expect(settlements).toHaveLength(3);
		expect(settlements.map((item) => item.entityId)).toEqual([
			'settlement:member-me:anna:EUR',
			'settlement:member-me:ben:EUR',
			'settlement:anna:member-me:CHF',
		]);
		const actualByIdentity = settlements
			.map((item) => [item.entityId, item.title, item.amountCents, item.currency])
			.sort(([left], [right]) => String(left).localeCompare(String(right)));
		const expectedByIdentity = expected
			.map((debt) => [
				`settlement:${debt.fromId}:${debt.toId}:${debt.currency ?? 'EUR'}`,
				debt.fromId === 'member-me' ? `An ${debt.toName}` : `Von ${debt.fromName}`,
				debt.fromId === 'member-me' ? -debt.cents : debt.cents,
				debt.currency,
			])
			.sort(([left], [right]) => String(left).localeCompare(String(right)));
		expect(actualByIdentity).toEqual(expectedByIdentity);
	});

	test('keeps settlement partners stable when tied balances and members are reordered', () => {
		const balances = [
			{ memberId: 'debtor-a', memberName: 'Abu', color: null, cents: -500, currency: 'EUR' },
			{ memberId: 'creditor-b', memberName: 'Dana', color: null, cents: 500, currency: 'EUR' },
			{ memberId: 'debtor-b', memberName: 'Bea', color: null, cents: -500, currency: 'EUR' },
			{ memberId: 'creditor-a', memberName: 'Clara', color: null, cents: 500, currency: 'EUR' },
		];
		const reorderedBalances = [balances[0], balances[2], balances[3], balances[1]];
		const expenses = [
			{
				paidByMemberId: 'creditor-a',
				splits: [
					{ debtorMemberId: 'debtor-a', amountCents: 250, settledAt: null },
					{ debtorMemberId: 'debtor-b', amountCents: 250, settledAt: null },
					{ debtorMemberId: 'creditor-b', amountCents: 250, settledAt: null },
				],
			},
			{
				paidByMemberId: 'creditor-b',
				splits: [
					{ debtorMemberId: 'debtor-a', amountCents: 250, settledAt: null },
					{ debtorMemberId: 'debtor-b', amountCents: 250, settledAt: null },
					{ debtorMemberId: 'creditor-a', amountCents: 250, settledAt: null },
				],
			},
		];
		const members = [
			{ id: 'debtor-a', name: 'Abu', color: null },
			{ id: 'creditor-b', name: 'Dana', color: null },
			{ id: 'debtor-b', name: 'Bea', color: null },
			{ id: 'creditor-a', name: 'Clara', color: null },
		];
		const reorderedMembers = [members[0], members[2], members[3], members[1]];
		const expectedTransfers = [
			{
				fromId: 'debtor-a',
				fromName: 'Abu',
				toId: 'creditor-a',
				toName: 'Clara',
				cents: 500,
				currency: 'EUR',
			},
			{
				fromId: 'debtor-b',
				fromName: 'Bea',
				toId: 'creditor-b',
				toName: 'Dana',
				cents: 500,
				currency: 'EUR',
			},
		];
		const simplify = (rows: typeof balances) =>
			simplifyDebts(rows).map(({ fromId, fromName, toId, toName, cents, currency }) => ({
				fromId,
				fromName,
				toId,
				toName,
				cents,
				currency,
			}));
		const summary = (roster: typeof members) => buildSettlementSummary(expenses, roster).simplified;
		const expectedHomeRows = [['settlement:debtor-a:creditor-a:EUR', 'An Clara', -500, 'EUR']];
		const homeRows = (rows: typeof balances) =>
			getForYouItems(
				overview({
					currentMemberId: 'debtor-a',
					balances: rows.map(({ cents, ...balance }) => ({ ...balance, balanceCents: cents })),
				}),
			)
				.filter((item) => item.kind === 'debt')
				.map((item) => [item.entityId, item.title, item.amountCents, item.currency]);

		expect(simplify(balances)).toEqual(expectedTransfers);
		expect(simplify(reorderedBalances)).toEqual(expectedTransfers);
		expect(summary(members)).toEqual(expectedTransfers);
		expect(summary(reorderedMembers)).toEqual(expectedTransfers);
		expect(homeRows(balances)).toEqual(expectedHomeRows);
		expect(homeRows(reorderedBalances)).toEqual(expectedHomeRows);
	});

	test('builds the Berlin week agenda with separate overdue context and no own duplicates', () => {
		const window = getBerlinWeekWindow(NOW);
		const rawWeekly: EventInput = {
			id: 'weekly',
			title: 'Sonntagsbrunch',
			description: null,
			startsAt: '2026-08-30T16:00:00.000Z',
			endsAt: null,
			allDay: false,
			location: null,
			recurrence: 'FREQ=WEEKLY',
		};
		const events = [
			event({
				eventId: 'all-day',
				title: 'WG-Putzaktion',
				startsAt: '2026-09-06T00:00:00.000Z',
				allDay: true,
			}),
			event({
				eventId: 'ongoing',
				title: 'Wochenendgäste',
				startsAt: '2026-09-05T20:00:00.000Z',
				endsAt: '2026-09-06T08:00:00.000Z',
			}),
			...expandRecurrence(rawWeekly, window.from, window.to),
			event({
				eventId: 'next-week',
				title: 'Nicht diese Woche',
				startsAt: '2026-09-07T08:00:00.000Z',
			}),
		];
		const agenda = getWeekAgenda({
			shareCode: 'WG/1',
			currentMemberId: 'member-me',
			now: NOW,
			events,
			dueChores: [
				{
					id: 'overdue-other',
					title: 'Flur',
					nextDueAt: '2026-09-05T10:00:00+02:00',
					overdue: true,
					assignedMemberId: 'member-other',
					assignedMemberName: 'Mina',
				},
				{
					id: 'own-today',
					title: 'Bad',
					nextDueAt: '2026-09-06T09:00:00+02:00',
					overdue: false,
					assignedMemberId: 'member-me',
					assignedMemberName: 'Abu',
				},
				{
					id: 'sunday-other',
					title: 'Küche',
					nextDueAt: '2026-09-06T18:00:00+02:00',
					overdue: false,
					assignedMemberId: 'member-other',
					assignedMemberName: 'Mina',
				},
				{
					id: 'next-monday',
					title: 'Keller',
					nextDueAt: '2026-09-07T09:00:00+02:00',
					overdue: false,
					assignedMemberId: 'member-other',
					assignedMemberName: 'Mina',
				},
			],
		});

		expect(window).toMatchObject({
			todayKey: '2026-09-06',
			weekStartKey: '2026-08-31',
			sundayKey: '2026-09-06',
		});
		expect(window.from.toISOString()).toBe('2026-09-05T22:00:00.000Z');
		expect(window.to.toISOString()).toBe('2026-09-06T21:59:59.999Z');
		expect(agenda.overdue.map((item) => item.key)).toEqual(['chore:overdue-other']);
		expect(agenda.upcoming.map((item) => item.key).sort()).toEqual(
			['event:all-day:0', 'event:ongoing:0', 'event:weekly:1', 'chore:sunday-other'].sort(),
		);
		expect(agenda.upcoming.every((item) => item.dayKey === '2026-09-06')).toBe(true);
		expect(agenda.upcoming.find((item) => item.key === 'event:ongoing:0')?.detail).toContain(
			'läuft',
		);
	});

	test('does not label an ended overnight event as running', () => {
		const agenda = getWeekAgenda({
			shareCode: 'WG/1',
			currentMemberId: 'member-me',
			dueChores: [],
			events: [
				event({
					eventId: 'ended-overnight',
					title: 'Wochenendgäste',
					startsAt: '2026-09-05T20:00:00.000Z',
					endsAt: '2026-09-06T06:00:00.000Z',
				}),
			],
			now: Date.parse('2026-09-06T15:00:00.000Z'),
		});

		expect(agenda.upcoming).toEqual([
			expect.objectContaining({
				key: 'event:ended-overnight:0',
				dayKey: '2026-09-06',
				detail: 'Endete heute um 08:00',
			}),
		]);
	});

	test('uses Berlin dates across Sundays, Mondays, year boundaries, and DST changes', () => {
		const spring = getBerlinWeekWindow(Date.parse('2026-03-29T01:30:00.000Z'));
		const fall = getBerlinWeekWindow(Date.parse('2026-10-25T01:30:00.000Z'));
		const monday = getBerlinWeekWindow(Date.parse('2026-10-25T23:30:00.000Z'));
		const newYear = getBerlinWeekWindow(Date.parse('2027-01-01T12:00:00.000Z'));

		expect(spring).toMatchObject({
			todayKey: '2026-03-29',
			weekStartKey: '2026-03-23',
			sundayKey: '2026-03-29',
		});
		expect(spring.to.getTime() + 1 - spring.from.getTime()).toBe(23 * 60 * 60 * 1000);
		expect(fall).toMatchObject({
			todayKey: '2026-10-25',
			weekStartKey: '2026-10-19',
			sundayKey: '2026-10-25',
		});
		expect(fall.to.getTime() + 1 - fall.from.getTime()).toBe(25 * 60 * 60 * 1000);
		expect(monday).toMatchObject({
			todayKey: '2026-10-26',
			weekStartKey: '2026-10-26',
			sundayKey: '2026-11-01',
		});
		expect(newYear).toMatchObject({
			todayKey: '2027-01-01',
			weekStartKey: '2026-12-28',
			sundayKey: '2027-01-03',
		});
	});

	test('keeps recurring events at their Berlin wall time over both DST transitions', () => {
		const springWindow = getBerlinWeekWindow(Date.parse('2026-03-29T01:30:00.000Z'));
		const fallWindow = getBerlinWeekWindow(Date.parse('2026-10-25T01:30:00.000Z'));
		const recurringEvent = (startsAt: string): EventInput => ({
			id: 'weekly',
			title: 'Abendessen',
			description: null,
			startsAt,
			endsAt: null,
			allDay: false,
			location: null,
			recurrence: 'FREQ=WEEKLY',
		});

		expect(
			expandRecurrence(
				recurringEvent('2026-03-22T19:00:00.000Z'),
				springWindow.from,
				springWindow.to,
			)[0]?.startsAt,
		).toBe('2026-03-29T18:00:00.000Z');
		expect(
			expandRecurrence(
				recurringEvent('2026-10-18T18:00:00.000Z'),
				fallWindow.from,
				fallWindow.to,
			)[0]?.startsAt,
		).toBe('2026-10-25T19:00:00.000Z');
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
		await mockDashboard(page, BASE, { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] });
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
		await mockDashboard(page, BASE, { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] });
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
		await mockDashboard(page, BASE, { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] });
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

test.describe('start overview model', () => {
	const NOW = Date.parse('2026-09-05T22:30:00.000Z');

	function overviewInput() {
		return {
			shareCode: 'WG/1',
			currentMemberId: 'member-me',
			openShoppingCount: 7,
			openShoppingTop: ['Milch', 'Brot', 'Eier'],
			dueChores: [
				{
					id: 'shared-overdue',
					title: 'Flur',
					nextDueAt: '2026-09-04T08:00:00.000Z',
					overdue: true,
					assignedMemberId: 'member-other',
					assignedMemberName: 'Mina',
				},
				{
					id: 'own-overdue',
					title: 'Bad',
					nextDueAt: '2026-09-04T20:00:00.000Z',
					overdue: true,
					assignedMemberId: 'member-me',
					assignedMemberName: 'Abu',
				},
				{
					id: 'own-today',
					title: 'Küche',
					nextDueAt: '2026-09-05T23:00:00.000Z',
					overdue: false,
					assignedMemberId: 'member-me',
					assignedMemberName: 'Abu',
				},
				{
					id: 'shared-today',
					title: 'Treppenhaus',
					nextDueAt: '2026-09-05T23:30:00.000Z',
					overdue: false,
					assignedMemberId: 'member-other',
					assignedMemberName: 'Mina',
				},
				{
					id: 'own-next',
					title: 'Badfenster',
					nextDueAt: '2026-09-07T08:00:00.000Z',
					overdue: false,
					assignedMemberId: 'member-me',
					assignedMemberName: 'Abu',
				},
				{
					id: 'shared-next',
					title: 'Keller',
					nextDueAt: '2026-09-08T08:00:00.000Z',
					overdue: false,
					assignedMemberId: 'member-other',
					assignedMemberName: 'Mina',
				},
				{
					id: 'later',
					title: 'Fenster',
					nextDueAt: '2026-09-20T08:00:00.000Z',
					overdue: false,
					assignedMemberId: null,
					assignedMemberName: null,
				},
			],
			myOpenAnnouncements: [{ id: 'announcement-1', kind: 'request', content: 'Paket im Flur' }],
			dueRecurringExpenses: [
				{
					id: 'recurring-1',
					description: 'Internet',
					amountCents: 3290,
					nextDueAt: '2026-09-06T00:15:00+02:00',
				},
			],
			absentMembers: [
				{
					id: 'absence-1',
					memberId: 'member-me',
					name: 'Abu',
					endDate: '2026-09-08T10:00:00.000Z',
					isCurrentMember: true,
				},
			],
			now: NOW,
		};
	}

	test.describe('Start overview read model', () => {
		test('ranks all chore candidates before the visible limit and keeps ownership context', () => {
			const items = getTodayImportantItems(overviewInput());

			expect(items).toHaveLength(10);
			expect(items.slice(0, 7).map((item) => item.entityId)).toEqual([
				'own-overdue',
				'shared-overdue',
				'own-today',
				'recurring-1',
				'shared-today',
				'own-next',
				'shared-next',
			]);
			expect(items.some((item) => item.entityId === 'later')).toBe(false);
			expect(items[0]).toMatchObject({
				isPersonal: true,
				detail: expect.stringContaining('offen'),
				href: '/wg/WG%2F1/putzen?highlight=own-overdue',
			});
			expect(items[1]).toMatchObject({
				isPersonal: false,
				detail: expect.stringContaining('Mina'),
				href: '/wg/WG%2F1/putzen?highlight=shared-overdue',
			});

			const shopping = items.find((item) => item.kind === 'shopping');
			expect(shopping).toMatchObject({
				detail: 'WG · 7 offene Artikel',
				href: '/wg/WG%2F1/einkauf',
			});
			expect(items.some((item) => item.kind === 'debt')).toBe(false);
		});

		test('uses stable destination links', () => {
			const items = getTodayImportantItems(overviewInput());
			expect(items.find((item) => item.kind === 'announcement')).toMatchObject({
				entityId: 'announcement-1',
				href: '/wg/WG%2F1/pinnwand#announcement-announcement-1',
			});
			expect(items.find((item) => item.kind === 'recurring')).toMatchObject({
				entityId: 'recurring-1',
				href: '/wg/WG%2F1/ausgaben?recurring=recurring-1',
			});
			expect(items.find((item) => item.kind === 'absence')).toMatchObject({
				entityId: 'absence-1',
				href: '/wg/WG%2F1/putzen?panel=absences&absence=absence-1',
			});
		});

		test('uses Berlin calendar days at the day edge', () => {
			const items = getTodayImportantItems({
				...overviewInput(),
				dueChores: [
					{
						id: 'same-berlin-day',
						title: 'Heute',
						nextDueAt: '2026-09-06T00:10:00+02:00',
						overdue: true,
						assignedMemberId: 'member-me',
						assignedMemberName: 'Abu',
					},
					{
						id: 'previous-berlin-day',
						title: 'Gestern',
						nextDueAt: '2026-09-05T23:55:00+02:00',
						overdue: true,
						assignedMemberId: 'member-other',
						assignedMemberName: 'Mina',
					},
				],
			});

			expect(items[0]).toMatchObject({ entityId: 'previous-berlin-day', tone: 'danger' });
			expect(items[1]).toMatchObject({
				entityId: 'same-berlin-day',
				tone: 'accent',
				detail: expect.stringContaining('heute fällig'),
			});
		});
	});
});

test.describe('edge data helpers', () => {
	// Pure edge-case regressions (dates around DST/midnight, device zones, emoji, long digits).
	const item = (timestamp: string) => ({
		id: timestamp,
		kind: 'chore' as const,
		timestamp,
		memberName: 'A',
		text: 't',
		completed: true,
	});

	function withTz(tz: string, run: () => void): void {
		const previous = process.env.TZ;
		process.env.TZ = tz;
		try {
			run();
		} finally {
			if (previous === undefined) Reflect.deleteProperty(process.env, 'TZ');
			else process.env.TZ = previous;
		}
	}

	test('"Gestern" is the previous Berlin day on the day after spring-forward', () => {
		// 30.03.2026 00:30 CEST; 29.03. had only 23h, so now-24h lands on 28.03.
		const now = Date.parse('2026-03-29T22:30:00Z');
		const groups = groupActivityItemsByDay([item('2026-03-29T10:00:00Z')], now);
		expect(groups[0]?.label).toBe('Gestern');
	});

	test('day labels do not shift for devices ahead of Berlin', () => {
		withTz('Pacific/Kiritimati', () => {
			const groups = groupActivityItemsByDay(
				[item('2026-09-20T10:00:00Z')],
				Date.parse('2026-10-01T10:00:00Z'),
			);
			expect(groups[0]?.label).toMatch(/20\.09\./);
		});
	});

	test('Berlin short dates ignore the device zone', () => {
		withTz('America/New_York', () => {
			// Berlin 02.10. 00:30 is still 01.10. in New York.
			expect(formatShortDate('2026-10-01T22:30:00Z', 'Europe/Berlin')).toBe('02.10.');
		});
	});

	test('relative labels count calendar days, not 24h blocks', () => {
		const now = new Date(2026, 9, 1, 8, 0).getTime();
		const in47h = new Date(now + 47 * 3_600_000).toISOString();
		const ago47h = new Date(now - 47 * 3_600_000).toISOString();
		expect(formatRelativeTime(in47h, now)).toBe('in 2 Tagen');
		expect(formatRelativeTime(ago47h, now)).toBe('vor 2 Tagen');
	});

	test('week labels one year apart stay unique', () => {
		const now = new Date(2026, 9, 1);
		const a = formatWeekLabel(new Date(2025, 9, 6), now);
		const b = formatWeekLabel(new Date(2024, 9, 7), now);
		expect(a).toBe('Woche ab 06.10.2025');
		expect(a).not.toBe(b);
	});

	test('emoji are never cut in half', () => {
		expect(initials('😀 Max')).toBe('😀M');
		expect(initials('😀😀😀')).toBe('😀😀');
		expect(previewBody('😀'.repeat(10), 5)).toBe('😀😀😀😀…');
	});

	test('an overlong digit run is a name, not a quantity', () => {
		const name = `${'1'.repeat(45)} Milch`;
		expect(parseShoppingInput(name)).toEqual({ name, quantity: null });
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
