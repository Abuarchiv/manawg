// Settlement, debts and balances: scope, netting, per-currency separation, reminders, balance consistency.
// Why: dashboard, debt list and settlement must agree to the cent and never mix currencies.

import { expect, test } from '@playwright/test';
import { buildActivityTimeline } from '../src/composition/activity';
import { computeMemberBalances, summarizeDashboardSpend } from '../src/composition/dashboard-data';
import { getTodayImportantItems, getWgHealth } from '../src/composition/dashboard-insights';
import { formatNotificationMessage } from '../src/core/notifications/notifications';
import { getDebtOverview } from '../src/features/expenses/debt-overview';
import {
	buildSettlementSummary,
	computeDirectDebts,
	computeNetBalances,
} from '../src/features/expenses/debt-reduction';
import { computeBalances, computeOldestDebtAges } from '../src/features/expenses/debts';
import { getDueRecurringExpenses } from '../src/features/expenses/recurring-expenses';
import { canSendReminder, formatReminderMessage } from '../src/features/expenses/reminders';
import {
	type SettlementExpenseInput,
	type SettlementMemberInput,
	parseSettlementConfirmation,
	selectSettlementScope,
	settlementScopeMatches,
} from '../src/features/expenses/settlement-scope';
import {
	FIXTURE_WG,
	dismissOnboarding,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	tuple,
} from './_helpers';

test.describe('settlement scope', () => {
	const memberA = '11111111-1111-4111-8111-111111111111';
	const memberB = '22222222-2222-4222-8222-222222222222';
	const memberC = '33333333-3333-4333-8333-333333333333';
	const noHttpBaseUrl = 'https://example.invalid';
	const fixtureMemberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

	const members: SettlementMemberInput[] = [
		{ id: memberA, name: 'Anna', color: null },
		{ id: memberB, name: 'Ben', color: null },
		{ id: memberC, name: 'Cem', color: null },
	];

	function expense(
		id: string,
		paidByMemberId: string,
		occurredAt: string,
		debtors: Array<{ id: string; amountCents: number }>,
	): SettlementExpenseInput {
		return {
			id,
			paidByMemberId,
			occurredAt,
			splits: debtors.map(({ id: debtorMemberId, amountCents }) => ({
				id: `${id}-split-${debtorMemberId.slice(0, 4)}`,
				expenseId: id,
				debtorMemberId,
				amountCents,
				settledAt: null,
			})),
		};
	}

	test.describe('Settlement scope', () => {
		test('selects every exact direct split oldest first and ignores other pairs', () => {
			const actual = selectSettlementScope(
				[
					expense('expense-old', memberA, '2026-09-01T10:00:00.000Z', [
						{ id: memberB, amountCents: 700 },
					]),
					expense('expense-new', memberA, '2026-09-02T10:00:00.000Z', [
						{ id: memberB, amountCents: 500 },
					]),
					expense('expense-other-pair', memberC, '2026-09-03T10:00:00.000Z', [
						{ id: memberB, amountCents: 900 },
					]),
				],
				members,
				[],
				memberB,
				memberA,
			);

			expect(actual).toEqual({
				currency: 'EUR',
				netCents: 1200,
				settleableCents: 1200,
				remainingCents: 0,
				splits: [
					{ id: 'expense-old-split-2222', expenseId: 'expense-old', amountCents: 700 },
					{ id: 'expense-new-split-2222', expenseId: 'expense-new', amountCents: 500 },
				],
			});
		});

		test('reports a partial scope when net debt exceeds whole direct splits', () => {
			const actual = selectSettlementScope(
				[
					expense('expense-direct', memberA, '2026-09-01T10:00:00.000Z', [
						{ id: memberB, amountCents: 1000 },
					]),
					expense('expense-through-cem', memberC, '2026-09-02T10:00:00.000Z', [
						{ id: memberB, amountCents: 500 },
					]),
					expense('expense-cem-to-anna', memberA, '2026-09-03T10:00:00.000Z', [
						{ id: memberC, amountCents: 1000 },
					]),
				],
				members,
				[],
				memberB,
				memberA,
			);

			expect(actual).toEqual({
				currency: 'EUR',
				netCents: 1500,
				settleableCents: 1000,
				remainingCents: 500,
				splits: [
					{ id: 'expense-direct-split-2222', expenseId: 'expense-direct', amountCents: 1000 },
				],
			});
		});

		test('caps a 51-split scope and selects the remaining split on the follow-up', () => {
			const expenses = Array.from({ length: 51 }, (_, index) =>
				expense(`expense-${String(index).padStart(2, '0')}`, memberA, '2026-09-01T10:00:00.000Z', [
					{ id: memberB, amountCents: 1 },
				]),
			);

			const firstScope = selectSettlementScope(expenses, members, [], memberB, memberA);

			expect(firstScope.splits).toHaveLength(50);
			expect(firstScope.settleableCents).toBe(50);
			expect(firstScope.remainingCents).toBe(1);

			const firstSplitIds = new Set(firstScope.splits.map((split) => split.id));
			const followUpScope = selectSettlementScope(
				expenses.map((currentExpense) => ({
					...currentExpense,
					splits: currentExpense.splits.map((split) => ({
						...split,
						settledAt: firstSplitIds.has(split.id) ? '2026-09-02T10:00:00.000Z' : split.settledAt,
					})),
				})),
				members,
				[],
				memberB,
				memberA,
			);

			expect(followUpScope).toEqual({
				currency: 'EUR',
				netCents: 1,
				settleableCents: 1,
				remainingCents: 0,
				splits: [{ id: 'expense-50-split-2222', expenseId: 'expense-50', amountCents: 1 }],
			});
		});

		test('reports a net-only debt when no direct split exists', () => {
			const actual = selectSettlementScope(
				[
					expense('expense-ben-to-cem', memberC, '2026-09-01T10:00:00.000Z', [
						{ id: memberB, amountCents: 1000 },
					]),
					expense('expense-cem-to-anna', memberA, '2026-09-02T10:00:00.000Z', [
						{ id: memberC, amountCents: 1000 },
					]),
				],
				members,
				[],
				memberB,
				memberA,
			);

			expect(actual).toEqual({
				currency: 'EUR',
				netCents: 1000,
				settleableCents: 0,
				remainingCents: 1000,
				splits: [],
				reason: 'no_direct_splits',
			});
		});

		test('rejects stale net, record ids, and record amounts', () => {
			const actual = selectSettlementScope(
				[
					expense('expense-old', memberA, '2026-09-01T10:00:00.000Z', [
						{ id: memberB, amountCents: 700 },
					]),
					expense('expense-new', memberA, '2026-09-02T10:00:00.000Z', [
						{ id: memberB, amountCents: 500 },
					]),
					expense('expense-other-pair', memberC, '2026-09-03T10:00:00.000Z', [
						{ id: memberB, amountCents: 900 },
					]),
				],
				members,
				[],
				memberB,
				memberA,
			);
			const reviewed = {
				netCents: 1200,
				settleableCents: 1200,
				splits: [
					{ id: 'expense-old-split-2222', amountCents: 700 },
					{ id: 'expense-new-split-2222', amountCents: 500 },
				],
			};

			expect(settlementScopeMatches(reviewed, actual)).toBe(true);
			expect(settlementScopeMatches({ ...reviewed, netCents: 1100 }, actual)).toBe(false);
			expect(
				settlementScopeMatches(
					{
						...reviewed,
						splits: [
							{ id: 'different-split', amountCents: 700 },
							{ id: 'expense-new-split-2222', amountCents: 500 },
						],
					},
					actual,
				),
			).toBe(false);
			expect(
				settlementScopeMatches(
					{
						...reviewed,
						splits: [
							{ id: 'expense-old-split-2222', amountCents: 600 },
							{ id: 'expense-new-split-2222', amountCents: 600 },
						],
					},
					actual,
				),
			).toBe(false);
		});

		test('rejects a retry using the review from before its splits were settled', () => {
			const reviewedExpenses = [
				expense('expense-first', memberA, '2026-09-01T10:00:00.000Z', [
					{ id: memberB, amountCents: 500 },
				]),
				expense('expense-second', memberA, '2026-09-02T10:00:00.000Z', [
					{ id: memberB, amountCents: 500 },
				]),
			];
			const preview = selectSettlementScope(reviewedExpenses, members, [], memberB, memberA);
			const expected = {
				currency: preview.currency,
				netCents: preview.netCents,
				settleableCents: preview.settleableCents,
				splits: preview.splits.map(({ id, amountCents }) => ({ id, amountCents })),
			};
			const afterFirstCommit = reviewedExpenses.map((current) => ({
				...current,
				splits: current.splits.map((split) => ({
					...split,
					settledAt: new Date('2026-09-03T10:00:00.000Z'),
				})),
			}));
			const retry = selectSettlementScope(afterFirstCommit, members, [], memberB, memberA);

			expect(preview.splits).toHaveLength(2);
			expect(retry.splits).toEqual([]);
			expect(settlementScopeMatches(expected, retry)).toBe(false);
		});

		test('requires a complete strict review and rejects duplicate or invalid records', () => {
			const validReview = {
				fromMemberId: memberB,
				toMemberId: memberA,
				currency: 'EUR',
				expected: {
					currency: 'EUR',
					netCents: 1000,
					settleableCents: 1000,
					splits: [{ id: '44444444-4444-4444-8444-444444444444', amountCents: 1000 }],
				},
			};
			expect(parseSettlementConfirmation(validReview)).toEqual({ ok: true, value: validReview });

			expect(parseSettlementConfirmation({ fromMemberId: memberB, toMemberId: memberA })).toEqual({
				ok: false,
				reason: 'required',
			});

			expect(
				parseSettlementConfirmation({
					fromMemberId: memberB,
					toMemberId: memberA,
					expected: {
						netCents: 1000,
						settleableCents: 1000,
						splits: [
							{ id: '44444444-4444-4444-8444-444444444444', amountCents: 500 },
							{ id: '44444444-4444-4444-8444-444444444444', amountCents: 500 },
						],
					},
				}),
			).toEqual({ ok: false, reason: 'invalid' });

			expect(
				parseSettlementConfirmation({
					fromMemberId: memberB,
					toMemberId: memberA,
					expected: {
						netCents: 1000,
						settleableCents: 500,
						splits: [{ id: '44444444-4444-4444-8444-444444444444', amountCents: -1 }],
					},
				}),
			).toEqual({ ok: false, reason: 'invalid' });

			expect(
				parseSettlementConfirmation({
					fromMemberId: memberB,
					toMemberId: memberA,
					expected: {
						netCents: 1000,
						settleableCents: 1000,
						splits: [],
					},
					extra: 'not-supported',
				}),
			).toEqual({ ok: false, reason: 'invalid' });
		});
	});

	test.describe('Settlement HTTP cache policy', () => {
		test.skip(
			process.env.BASE_URL === noHttpBaseUrl,
			'HTTP checks are intentionally skipped for the no-network pure-test run',
		);

		test('sets no-store on an invalid share-code preamble response', async ({ request }) => {
			const response = await request.get(
				`/api/wg/not-a-code/expenses/settle-batch?fromMemberId=${memberA}&toMemberId=${memberB}`,
			);

			expect(response.status()).toBe(400);
			expect(response.headers()['cache-control']).toBe('private, no-store');
			await expect(response.json()).resolves.toMatchObject({ error: 'invalid_share_code' });
		});

		test('sets no-store on a withWgRoute authentication rejection', async ({ request }) => {
			test.skip(
				process.env.CI !== 'true' || process.env.NEXT_PUBLIC_DB_DOWN !== 'true',
				'the fixture authentication case requires the local DB-down fixture server',
			);

			const response = await request.get(
				`/api/wg/MTE8PZAT/expenses/settle-batch?fromMemberId=${memberA}&toMemberId=${memberB}`,
				{ headers: { 'x-manawg-expected-member-id': fixtureMemberId } },
			);

			expect(response.status()).toBe(401);
			expect(response.headers()['cache-control']).toBe('private, no-store');
			await expect(response.json()).resolves.toMatchObject({ error: 'auth_required' });
		});
	});
});

test.describe('debt overview', () => {
	const outgoing = { fromId: 'me', fromName: 'Alex', toId: 'lisa', toName: 'Lisa', cents: 1200 };
	const incoming = { fromId: 'lisa', fromName: 'Lisa', toId: 'me', toName: 'Alex', cents: 1200 };
	const other = { fromId: 'ben', fromName: 'Ben', toId: 'sara', toName: 'Sara', cents: 2500 };

	test('reciprocal open expenses cancel without resurfacing as transfer demands', () => {
		const members = [
			{ id: 'me', name: 'Alex', color: null },
			{ id: 'lisa', name: 'Lisa', color: null },
		];
		const expenses = [
			{
				paidByMemberId: 'me',
				splits: [{ debtorMemberId: 'lisa', amountCents: 1200, settledAt: null }],
			},
			{
				paidByMemberId: 'lisa',
				splits: [{ debtorMemberId: 'me', amountCents: 1200, settledAt: null }],
			},
		];
		const summary = buildSettlementSummary(expenses, members);
		expect(getDebtOverview(computeDirectDebts(expenses, members), 'me', summary)).toEqual({
			personal: [],
			others: [],
		});
		expect(expenses.every((expense) => expense.splits[0]?.settledAt === null)).toBe(true);
	});

	test('incoming and outgoing personal transfers are separated from other residents', () => {
		expect(getDebtOverview([other, outgoing, incoming], 'me')).toEqual({
			personal: [outgoing, incoming],
			others: [other],
		});
	});

	test('uninvolved residents have no personal demand', () => {
		expect(getDebtOverview([other], 'me')).toEqual({ personal: [], others: [other] });
	});

	test('a provided simplified result is authoritative even without direct debts', () => {
		expect(
			getDebtOverview([], 'me', {
				directCount: 0,
				simplifiedCount: 1,
				savedTransfers: 0,
				totalOpenCents: 1200,
				simplified: [outgoing],
			}).personal,
		).toEqual([outgoing]);
	});
});

test.describe('debt summary reminder link', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	test('keeps finance actions and expense summary keyboard-operable at phone sizes', async ({
		page,
		browserName,
	}, testInfo) => {
		const { shareCode, memberId } = FIXTURE_WG;
		const otherMemberId = '11111111-1111-4111-8111-111111111111';
		const longMemberName = 'A'.repeat(80);
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/members`, (route) =>
			route.fulfill({
				json: {
					members: [
						{ id: memberId, name: 'Abu', color: null, active: true },
						{ id: otherMemberId, name: longMemberName, color: null, active: true },
					],
					viewerIsAdmin: false,
				},
			}),
		);
		await page.route(`**/api/wg/${shareCode}/expenses`, (route) =>
			route.fulfill({
				json: {
					expenses: [
						{
							id: 'expense-rent',
							paidByMemberId: memberId,
							amountCents: 2000,
							currency: 'EUR',
							description: 'Miete',
							occurredAt: '2026-09-01T10:00:00.000Z',
							splits: [
								{
									id: 'split-rent',
									expenseId: 'expense-rent',
									debtorMemberId: otherMemberId,
									amountCents: 1000,
									settledAt: null,
								},
							],
						},
						{
							id: 'expense-chf',
							paidByMemberId: memberId,
							amountCents: 24690,
							currency: 'CHF',
							description: 'Stromnachzahlung Oktober',
							occurredAt: '2026-09-02T10:00:00.000Z',
							splits: [
								{
									id: 'split-chf',
									expenseId: 'expense-chf',
									debtorMemberId: otherMemberId,
									amountCents: 12345,
									settledAt: null,
								},
							],
						},
					],
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

		const debtList = page.getByRole('list', { name: 'Deine offenen Zahlungen' });
		await expect(debtList).toBeVisible();
		// Salden sind immer sichtbar, nicht mehr hinter „Alle Salden“ versteckt.
		const balanceList = page.getByRole('list', { name: 'Saldo pro Mitglied' });
		await expect(balanceList).toBeVisible();
		const balanceLabel = page.getByText('Dein Saldo', { exact: true });
		await expect(balanceLabel).toBeVisible();
		// Der Saldo ist die Überschrift, die offenen Zahlungen stehen direkt darunter.
		const balancePrecedesDebtsInDom = await balanceLabel.evaluate((node) => {
			const debt = document.querySelector('[aria-label="Deine offenen Zahlungen"]');
			return debt
				? Boolean(node.compareDocumentPosition(debt) & Node.DOCUMENT_POSITION_FOLLOWING)
				: false;
		});
		expect(balancePrecedesDebtsInDom).toBe(true);
		const debts = debtList.locator('[data-slot="item"]');
		await expect(debts).toHaveCount(2);
		const secondaryDebt = debts.nth(1);
		const settleButton = secondaryDebt.getByRole('button', { name: 'Ausgleichen' });
		const remindButton = secondaryDebt.getByRole('button', { name: 'Erinnern', exact: true });
		await expect(settleButton).toBeVisible();
		await expect(remindButton).toBeVisible();
		await settleButton.focus();
		await page.keyboard.press('Tab');
		await expect(remindButton).toBeFocused();
		const reminderLink = page.getByRole('link', { name: 'Alle Erinnerungen' });
		await expect(reminderLink).toBeVisible();
		await expect(reminderLink).toHaveAttribute('href', `/wg/${shareCode}/mahnungen`);
		await reminderLink.focus();
		await expect(reminderLink).toBeFocused();
		await page.keyboard.press('Tab');
		await page.keyboard.press('Shift+Tab');
		if (browserName === 'webkit') {
			// WebKit's native reverse Tab traversal can skip anchors without Full Keyboard Access.
			await reminderLink.focus();
		}
		await expect(reminderLink).toBeFocused();
		await expect
			.poll(() => reminderLink.evaluate((node) => node.matches(':focus-visible')))
			.toBe(true);
		for (const theme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: theme });
			for (const textScale of ['100%', '200%'] as const) {
				await page.evaluate((fontSize) => {
					document.documentElement.style.setProperty('font-size', fontSize, 'important');
				}, textScale);
				for (const width of [320, 360, 390]) {
					await page.setViewportSize({ width, height: 844 });
					// Beide Buttons im selben Frame messen: getBoundingClientRect ist
					// viewport-relativ, zwei getrennte evaluate-Aufrufe können zwischen
					// Scroll- oder Render-Schritten liegen und eine Scheinüberlappung melden.
					const metrics = await secondaryDebt.evaluate((row) =>
						(['Ausgleichen', 'Erinnern'] as const).map((label) => {
							const element = [...row.querySelectorAll('button')].find(
								(button) => button.textContent?.trim() === label,
							);
							if (!element) throw new Error(`${label} button missing`);
							const buttonRect = element.getBoundingClientRect();
							const textRange = document.createRange();
							textRange.selectNodeContents(element);
							const textRect = textRange.getBoundingClientRect();
							const hitTarget = getComputedStyle(element, '::after');
							return {
								button: {
									left: buttonRect.left,
									right: buttonRect.right,
									top: buttonRect.top,
									bottom: buttonRect.bottom,
								},
								textFits:
									textRect.left >= buttonRect.left - 1 && textRect.right <= buttonRect.right + 1,
								touchWidth: Number.parseFloat(hitTarget.minWidth),
								touchHeight: Number.parseFloat(hitTarget.height),
							};
						}),
					);
					const [settle, remind] = tuple(metrics, 2);
					const buttonsOverlap =
						settle.button.left < remind.button.right &&
						remind.button.left < settle.button.right &&
						settle.button.top < remind.button.bottom &&
						remind.button.top < settle.button.bottom;
					const layout = await page.evaluate(() => ({
						viewport: document.documentElement.clientWidth,
						scroll: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
					}));

					expect(
						buttonsOverlap,
						`${width}px / ${textScale} / ${theme}: action buttons overlap`,
					).toBe(false);
					expect(
						settle.textFits,
						`${width}px / ${textScale} / ${theme}: settlement text clips`,
					).toBe(true);
					expect(remind.textFits, `${width}px / ${textScale} / ${theme}: reminder text clips`).toBe(
						true,
					);
					expect(
						layout.scroll,
						`${width}px / ${textScale} / ${theme}: page overflows horizontally`,
					).toBeLessThanOrEqual(layout.viewport);
					expect(settle.touchWidth).toBeGreaterThanOrEqual(44);
					expect(settle.touchHeight).toBeGreaterThanOrEqual(44);
					if (textScale === '200%') {
						const balanceBox = await balanceLabel.boundingBox();
						const debtBox = await debtList.boundingBox();
						if (!balanceBox || !debtBox) throw new Error('Summary must have layout boxes');
						expect(balanceBox.y).toBeLessThan(debtBox.y);
						const chfBalance = balanceList
							.getByRole('listitem')
							.filter({ hasText: longMemberName })
							.filter({ hasText: 'CHF' });
						await expect(chfBalance).toHaveCount(1);
						const balanceMetrics = await chfBalance.evaluate((row) => {
							const name = row.firstElementChild?.lastElementChild as HTMLElement | null;
							const amount = row.lastElementChild as HTMLElement | null;
							const card = row.closest('[data-slot="card"]') as HTMLElement | null;
							if (!name || !amount || !card) throw new Error('Balance row layout is incomplete');
							const nameRect = name.getBoundingClientRect();
							const amountRect = amount.getBoundingClientRect();
							const cardRect = card.getBoundingClientRect();
							return {
								nameWidth: nameRect.width,
								nameClientWidth: name.clientWidth,
								nameScrollWidth: name.scrollWidth,
								nameRight: nameRect.right,
								cardRight: cardRect.right,
								amountLeft: amountRect.left,
								amountRight: amountRect.right,
								cardLeft: cardRect.left,
							};
						});
						expect(
							balanceMetrics.nameWidth,
							`${width}px / ${theme}: member name must have visible width`,
						).toBeGreaterThan(32);
						expect(
							balanceMetrics.nameScrollWidth,
							`${width}px / ${theme}: member name must not be clipped`,
						).toBeLessThanOrEqual(balanceMetrics.nameClientWidth + 1);
						expect(
							balanceMetrics.nameRight,
							`${width}px / ${theme}: member name extends beyond its card`,
						).toBeLessThanOrEqual(balanceMetrics.cardRight + 1);
						expect(
							balanceMetrics.amountLeft,
							`${width}px / ${theme}: balance amount starts outside its card`,
						).toBeGreaterThanOrEqual(balanceMetrics.cardLeft - 1);
						expect(
							balanceMetrics.amountRight,
							`${width}px / ${theme}: balance amount extends beyond its card`,
						).toBeLessThanOrEqual(balanceMetrics.cardRight + 1);
						await page.screenshot({
							path: testInfo.outputPath(`reminders-${width}-${theme}.png`),
							animations: 'disabled',
						});
					}
				}
			}
		}
		await reminderLink.focus();
		await expect(reminderLink).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(new RegExp(`/wg/${shareCode}/mahnungen$`));
	});
});

test.describe('debt settle error notice', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');
	test.use({ hasTouch: true, isMobile: true });

	const MINA_ID = '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55';

	test('cancelling the settle-confirmation dialog clears a failed settle attempt error', async ({
		page,
	}) => {
		const { shareCode, memberId } = FIXTURE_WG;

		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/expenses`, (route) =>
			route.fulfill({
				json: {
					expenses: [
						{
							id: 'expense-rent',
							paidByMemberId: memberId,
							amountCents: 2000,
							currency: 'EUR',
							description: 'Miete',
							occurredAt: '2026-09-01T10:00:00.000Z',
							splits: [
								{
									id: 'split-rent',
									expenseId: 'expense-rent',
									debtorMemberId: MINA_ID,
									amountCents: 1000,
									settledAt: null,
								},
							],
						},
					],
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
		await page.route(`**/api/wg/${shareCode}/expenses/settle-batch*`, (route) => {
			if (route.request().method() === 'GET') {
				return route.fulfill({
					json: {
						currency: 'EUR',
						netCents: 1000,
						settleableCents: 1000,
						remainingCents: 0,
						splits: [{ id: 'split-rent', expenseId: 'expense-rent', amountCents: 1000 }],
					},
				});
			}
			return route.fulfill({ status: 500, json: { error: 'server_error' } });
		});

		await navigateToFeature(page, `/wg/${shareCode}/ausgaben`);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: 'Ausgleichen' }).click();
		const dialog = page.getByRole('alertdialog', { name: 'Bereits erfolgte Zahlung bestätigen' });
		await expect(dialog).toBeVisible();

		await dialog.getByRole('button', { name: /als bezahlt eintragen/i }).click();
		await expect(
			dialog.getByText('Ausgleich konnte nicht gespeichert werden', { exact: false }),
		).toBeVisible();

		await dialog.getByRole('button', { name: 'Abbrechen' }).click();
		await expect(dialog).not.toBeVisible();
		await expect(
			page.getByText('Ausgleich konnte nicht gespeichert werden', { exact: false }),
		).toHaveCount(0);
	});
});

test.describe('dashboard balance consistency', () => {
	const memberA = '11111111-1111-4111-8111-111111111111';
	const memberB = '22222222-2222-4222-8222-222222222222';
	const memberC = '33333333-3333-4333-8333-333333333333';

	const members = [
		{ id: memberA, name: 'Anna', color: null },
		{ id: memberB, name: 'Ben', color: null },
		{ id: memberC, name: 'Cem', color: null },
	];

	type DashboardExpense = {
		id: string;
		paidByMemberId: string;
		amountCents: number;
	};

	type DashboardSplit = {
		expenseId: string;
		debtorMemberId: string;
		amountCents: number;
		settledAt: Date | null;
	};

	type Payment = {
		fromMemberId: string;
		toMemberId: string;
		amountCents: number;
		currency: string;
	};

	function expense(id: string, paidByMemberId: string, amountCents = 3_000): DashboardExpense {
		return { id, paidByMemberId, amountCents };
	}

	function split(
		expenseId: string,
		debtorMemberId: string,
		amountCents: number,
		settledAt: Date | null = null,
	): DashboardSplit {
		return { expenseId, debtorMemberId, amountCents, settledAt };
	}

	function dashboardBalances(
		expenses: DashboardExpense[],
		splits: DashboardSplit[],
		payments: Payment[] = [],
	) {
		return computeMemberBalances(members, expenses, splits, payments);
	}
	test.describe('Dashboard balance consistency', () => {
		test('matches expected balances for an unsettled three-person expense', () => {
			const currentExpense = expense('expense-unpaid', memberA);
			const actual = dashboardBalances(
				[currentExpense],
				[
					split(currentExpense.id, memberA, 1_000),
					split(currentExpense.id, memberB, 1_000),
					split(currentExpense.id, memberC, 1_000),
				],
			);

			expect(
				actual.map(({ paidCents, owedCents, balanceCents }) => ({
					paidCents,
					owedCents,
					balanceCents,
				})),
			).toEqual([
				{ paidCents: 3_000, owedCents: 1_000, balanceCents: 2_000 },
				{ paidCents: 0, owedCents: 1_000, balanceCents: -1_000 },
				{ paidCents: 0, owedCents: 1_000, balanceCents: -1_000 },
			]);
		});

		test('matches expected balances for partial and full settlement', () => {
			const currentExpense = expense('expense-settlement', memberA);
			const splits = [
				split(currentExpense.id, memberA, 1_000),
				split(currentExpense.id, memberB, 1_000),
				split(currentExpense.id, memberC, 1_000),
			];

			const [splitA, splitB, splitC] = tuple(splits, 3);
			const partialSplits = [splitA, { ...splitB, settledAt: new Date() }, splitC];
			const partial = dashboardBalances([currentExpense], partialSplits);
			expect(
				partial.map(({ paidCents, owedCents, balanceCents }) => ({
					paidCents,
					owedCents,
					balanceCents,
				})),
			).toEqual([
				{ paidCents: 3_000, owedCents: 1_000, balanceCents: 1_000 },
				{ paidCents: 0, owedCents: 0, balanceCents: 0 },
				{ paidCents: 0, owedCents: 1_000, balanceCents: -1_000 },
			]);
			const full = dashboardBalances(
				[currentExpense],
				splits.map((current) => ({ ...current, settledAt: new Date() })),
			);
			expect(
				full.map(({ paidCents, owedCents, balanceCents }) => ({
					paidCents,
					owedCents,
					balanceCents,
				})),
			).toEqual([
				{ paidCents: 3_000, owedCents: 0, balanceCents: 0 },
				{ paidCents: 0, owedCents: 0, balanceCents: 0 },
				{ paidCents: 0, owedCents: 0, balanceCents: 0 },
			]);
		});

		test('keeps own shares neutral and applies completed provider transfers', () => {
			const ownExpense = expense('expense-own', memberA);
			const own = dashboardBalances([ownExpense], [split(ownExpense.id, memberA, 3_000)]);
			expect(
				own.map(({ paidCents, owedCents, balanceCents }) => ({
					paidCents,
					owedCents,
					balanceCents,
				})),
			).toEqual([
				{ paidCents: 3_000, owedCents: 3_000, balanceCents: 0 },
				{ paidCents: 0, owedCents: 0, balanceCents: 0 },
				{ paidCents: 0, owedCents: 0, balanceCents: 0 },
			]);

			const sharedExpense = expense('expense-paid', memberA);
			const transferred = dashboardBalances(
				[sharedExpense],
				[
					split(sharedExpense.id, memberA, 1_000),
					split(sharedExpense.id, memberB, 1_000),
					split(sharedExpense.id, memberC, 1_000),
				],
				[{ fromMemberId: memberB, toMemberId: memberA, amountCents: 1_000, currency: 'EUR' }],
			);
			expect(
				transferred.map(({ paidCents, owedCents, balanceCents }) => ({
					paidCents,
					owedCents,
					balanceCents,
				})),
			).toEqual([
				{ paidCents: 3_000, owedCents: 2_000, balanceCents: 1_000 },
				{ paidCents: 1_000, owedCents: 1_000, balanceCents: 0 },
				{ paidCents: 0, owedCents: 1_000, balanceCents: -1_000 },
			]);
		});
	});
});

test.describe('currency-scoped accounting', () => {
	const alice = '11111111-1111-4111-8111-111111111111';
	const ben = '22222222-2222-4222-8222-222222222222';
	const members = [
		{ id: alice, name: 'Alice', color: null },
		{ id: ben, name: 'Ben', color: null },
	];

	test.describe('audit #158 accounting invariants', () => {
		test('keeps balances and payments separate for each currency', () => {
			const expenses = [
				{
					paidByMemberId: alice,
					currency: 'EUR',
					occurredAt: '2026-01-01T12:00:00.000Z',
					splits: [{ debtorMemberId: ben, amountCents: 1000, settledAt: null }],
				},
				{
					paidByMemberId: alice,
					currency: 'CHF',
					occurredAt: '2026-01-02T12:00:00.000Z',
					splits: [{ debtorMemberId: ben, amountCents: 1000, settledAt: null }],
				},
			];
			const payments = [
				{ fromMemberId: ben, toMemberId: alice, amountCents: 1000, currency: 'EUR' },
			];

			expect(computeBalances(expenses, payments)).toEqual([
				{ debtorId: ben, creditorId: alice, amountCents: 1000, currency: 'CHF' },
			]);
			expect(computeNetBalances(expenses, members, payments)).toEqual([
				{ memberId: alice, memberName: 'Alice', color: null, cents: 1000, currency: 'CHF' },
				{ memberId: ben, memberName: 'Ben', color: null, cents: -1000, currency: 'CHF' },
				{ memberId: alice, memberName: 'Alice', color: null, cents: 0, currency: 'EUR' },
				{ memberId: ben, memberName: 'Ben', color: null, cents: 0, currency: 'EUR' },
			]);
		});

		test('nets opposite directions into one pair balance', () => {
			const expenses = [
				{
					paidByMemberId: alice,
					currency: 'EUR',
					occurredAt: '2026-01-01T12:00:00.000Z',
					splits: [{ debtorMemberId: ben, amountCents: 4295, settledAt: null }],
				},
				{
					paidByMemberId: ben,
					currency: 'EUR',
					occurredAt: '2026-01-02T12:00:00.000Z',
					splits: [{ debtorMemberId: alice, amountCents: 3852, settledAt: null }],
				},
			];
			expect(computeBalances(expenses)).toEqual([
				{ debtorId: ben, creditorId: alice, amountCents: 443, currency: 'EUR' },
			]);
		});

		test('keeps dashboard gross balances in separate currency rows', () => {
			const expenses = [
				{ id: 'eur', paidByMemberId: alice, amountCents: 1000, currency: 'EUR' },
				{ id: 'chf', paidByMemberId: alice, amountCents: 1000, currency: 'CHF' },
			];
			const splits = [
				{ expenseId: 'eur', debtorMemberId: ben, amountCents: 1000, settledAt: null },
				{ expenseId: 'chf', debtorMemberId: ben, amountCents: 1000, settledAt: null },
			];

			expect(computeMemberBalances(members, expenses, splits)).toEqual([
				{
					memberId: alice,
					memberName: 'Alice',
					color: null,
					currency: 'CHF',
					paidCents: 1000,
					owedCents: 0,
					balanceCents: 1000,
				},
				{
					memberId: ben,
					memberName: 'Ben',
					color: null,
					currency: 'CHF',
					paidCents: 0,
					owedCents: 1000,
					balanceCents: -1000,
				},
				{
					memberId: alice,
					memberName: 'Alice',
					color: null,
					currency: 'EUR',
					paidCents: 1000,
					owedCents: 0,
					balanceCents: 1000,
				},
				{
					memberId: ben,
					memberName: 'Ben',
					color: null,
					currency: 'EUR',
					paidCents: 0,
					owedCents: 1000,
					balanceCents: -1000,
				},
			]);
		});

		test('matches reminder ages by currency as well as member pair', () => {
			const expenses = [
				{
					paidByMemberId: alice,
					currency: 'EUR',
					occurredAt: '2026-01-01T12:00:00.000Z',
					splits: [{ debtorMemberId: ben, amountCents: 1000, settledAt: null }],
				},
				{
					paidByMemberId: alice,
					currency: 'CHF',
					occurredAt: '2026-01-10T12:00:00.000Z',
					splits: [{ debtorMemberId: ben, amountCents: 1000, settledAt: null }],
				},
			];
			const now = new Date('2026-01-11T12:00:00.000Z');

			expect(
				computeOldestDebtAges(
					[
						{ debtorId: ben, creditorId: alice, currency: 'EUR' },
						{ debtorId: ben, creditorId: alice, currency: 'CHF' },
					],
					expenses,
					now,
				),
			).toEqual([10, 1]);
		});
	});

	test.describe('audit #158 currency consumers', () => {
		test('keeps dashboard spend totals and sparkline rows currency-scoped', () => {
			const summary = summarizeDashboardSpend(
				[
					{
						amountCents: 1000,
						currency: 'EUR',
						occurredAt: '2026-01-15T12:00:00.000Z',
					},
					{
						amountCents: 2500,
						currency: 'CHF',
						occurredAt: '2026-01-15T13:00:00.000Z',
					},
				],
				new Date('2026-01-15T14:00:00.000Z'),
			);

			expect(summary.totalSpendByCurrency).toEqual({ EUR: 1000, CHF: 2500 });
			expect(summary.weekSpendByCurrency).toEqual({ EUR: 1000, CHF: 2500 });
			expect(summary.monthSpendByCurrency).toEqual({ EUR: 1000, CHF: 2500 });
			expect(summary.totalSpendCents).toBeNull();
			expect(summary.spendByDay).toEqual(
				expect.arrayContaining([
					{ date: '2026-01-15', currency: 'EUR', cents: 1000 },
					{ date: '2026-01-15', currency: 'CHF', cents: 2500 },
				]),
			);
		});

		test('scopes reminder cooldown and copy by currency', () => {
			const now = new Date('2026-01-15T12:00:00.000Z');
			const history = [
				{
					debtorMemberId: ben,
					creditorMemberId: alice,
					currency: 'EUR',
					sentAt: '2026-01-15T10:00:00.000Z',
				},
			];

			expect(canSendReminder(ben, alice, history, now, 'EUR').allowed).toBe(false);
			expect(canSendReminder(ben, alice, history, now, 'CHF').allowed).toBe(true);
			expect(
				formatReminderMessage({
					debtorName: 'Ben',
					creditorName: 'Alice',
					amountCents: 2500,
					currency: 'CHF',
					oldestDebtAgeDays: 2,
				}),
			).toContain('CHF');
		});

		test('keeps currency in activity, notifications, and health output', () => {
			const activity = buildActivityTimeline({
				members: members.map(({ id, name }) => ({ id, name })),
				expenses: [
					{
						id: 'expense-chf',
						paidByMemberId: alice,
						description: 'Miete',
						amountCents: 95000,
						currency: 'CHF',
						occurredAt: '2026-01-15T12:00:00.000Z',
					},
				],
				shoppingItems: [],
				announcements: [],
				choreCompletions: [],
			});
			expect(activity[0]).toMatchObject({ amountCents: 95000, currency: 'CHF' });

			const notification = formatNotificationMessage('expense.created', {
				wgName: 'WG',
				actorName: 'Alice',
				title: 'Miete',
				amountCents: 95000,
				currency: 'CHF',
			});
			expect(notification.body).toContain('CHF');
			expect(
				formatNotificationMessage('expense.recurring_charged', {
					description: 'Internet',
					amountCents: 2500,
					currency: 'CHF',
				}),
			).toMatchObject({ body: expect.stringContaining('CHF') });

			const health = getWgHealth({
				shareCode: 'WGCODE01',
				openShoppingCount: 0,
				overdueChoreCount: 0,
				openDebtByCurrency: { EUR: 1000, CHF: 2500 },
				openAnnouncementCount: 0,
				absentMemberCount: 0,
				dueRecurringCount: 0,
			});
			expect(health.items.find((item) => item.label === 'Offene Schulden')?.value).toEqual(
				expect.stringContaining('CHF'),
			);
		});

		test('preserves currency on recurring due items and today cards', () => {
			const due = getDueRecurringExpenses(
				[
					{
						id: 'recurring-chf',
						description: 'Internet',
						amountCents: 2500,
						currency: 'CHF',
						nextDueAt: '2026-01-14T12:00:00.000Z',
					},
				],
				new Date('2026-01-15T12:00:00.000Z').getTime(),
			);
			expect(due[0]?.currency).toBe('CHF');

			const today = getTodayImportantItems({
				shareCode: 'WGCODE01',
				currentMemberId: alice,
				openShoppingCount: 0,
				openShoppingTop: [],
				dueChores: [],
				myOpenAnnouncements: [],
				dueRecurringExpenses: due,
				absentMembers: [],
				now: new Date('2026-01-15T12:00:00.000Z').getTime(),
			});
			expect(today[0]?.detail).toContain('CHF');
		});
	});
});
