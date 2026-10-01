// App shell and responsive layout: 320px/200% text matrix, drawers, dialogs, back-button dismissal, toasts.
// Why: phone-only product; nothing may overflow or trap the user at the smallest supported viewport.

import { type Locator, type Page, expect, test } from '@playwright/test';
import {
	FIXTURE_WG,
	dismissOnboarding,
	mockNoWgs,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
} from './_helpers';

test.describe('mobile layout matrix', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');
	test.setTimeout(120_000);
	test.use({ hasTouch: true, isMobile: true });

	const SHARE_CODE = 'MTE8PZAT';
	const MEMBER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
	const WG_ID = '989ac820-58b7-431f-9c65-28721264f333';
	type LayoutRoute = 'home' | 'chores' | 'shopping' | 'inventory';
	const LONG_INVENTORY_NAME = 'Spülmaschinenreinigung mit Entkalkung und gründlicher Küchenhygiene';

	function fixtureBerlinTodayAtNoon(): string {
		const parts = new Intl.DateTimeFormat('en-US', {
			timeZone: 'Europe/Berlin',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		}).formatToParts(new Date());
		const value = (type: string) => parts.find((part) => part.type === type)?.value;
		const year = value('year');
		const month = value('month');
		const day = value('day');
		if (!year || !month || !day) throw new Error('Could not determine the Berlin fixture date');
		return `${year}-${month}-${day}T12:00:00.000Z`;
	}

	const FIXTURE_DUE_AT = fixtureBerlinTodayAtNoon();

	const shoppingItems = [
		{
			id: 'shopping-open',
			addedByMemberId: MEMBER_ID,
			name: 'Ungesüßte Hafermilch',
			quantity: '1 Packung',
			boughtAt: null,
			boughtByMemberId: null,
			createdAt: '2026-09-20T08:00:00.000Z',
		},
		{
			id: 'shopping-done',
			addedByMemberId: MEMBER_ID,
			name: 'Vollkornnudeln',
			quantity: '2 Packungen',
			boughtAt: '2026-09-20T09:00:00.000Z',
			boughtByMemberId: MEMBER_ID,
			createdAt: '2026-09-20T09:01:00.000Z',
		},
	];

	const inventoryItems = [
		{
			id: 'inventory-milk',
			wgId: WG_ID,
			name: LONG_INVENTORY_NAME,
			quantity: 1,
			unit: 'Stück',
			threshold: 1,
			category: 'kueche',
			lastDecrementedAt: null,
			decrementCount30d: 0,
			createdAt: '2026-09-20T08:00:00.000Z',
			updatedAt: '2026-09-20T08:00:00.000Z',
		},
		{
			id: 'inventory-paper',
			wgId: WG_ID,
			name: 'Recycling Toilettenpapier',
			quantity: 4,
			unit: 'Rolle',
			threshold: 2,
			category: 'bad',
			lastDecrementedAt: null,
			decrementCount30d: 0,
			createdAt: '2026-09-20T08:01:00.000Z',
			updatedAt: '2026-09-20T08:01:00.000Z',
		},
	];

	const chores = [
		{
			id: 'chore-bath',
			title: 'Bad putzen',
			intervalDays: 7,
			recurrenceType: 'days' as const,
			nextDueAt: FIXTURE_DUE_AT,
			assignedMemberId: MEMBER_ID,
			lastCompletedAt: null,
			lastCompletedByName: null,
			openGapCountForAssignee: 0,
		},
	];

	const dashboardData = {
		balances: [
			{
				memberId: MEMBER_ID,
				memberName: 'dsaf',
				color: '#6d5efc',
				currency: 'EUR',
				paidCents: 3290,
				owedCents: 0,
				balanceCents: 3290,
			},
		],
		spendByDay: [],
		totalSpendByCurrency: { EUR: 3290 },
		weekSpendByCurrency: { EUR: 3290 },
		monthSpendByCurrency: { EUR: 3290 },
		totalSpendCents: 3290,
		weekSpendCents: 3290,
		monthSpendCents: 3290,
		openShoppingCount: 1,
		openShoppingTop: ['Ungesüßte Hafermilch'],
		dueChores: [
			{
				id: 'chore-bath',
				title: 'Bad putzen',
				assignedMemberId: MEMBER_ID,
				assignedMemberName: 'dsaf',
				assignedColor: '#6d5efc',
				nextDueAt: FIXTURE_DUE_AT,
				overdue: false,
			},
		],
		activity: [
			{
				kind: 'expense',
				timestamp: '2026-09-21T08:00:00.000Z',
				memberName: 'dsaf',
				text: 'Internet',
				amountCents: 3290,
			},
		],
		latestAnnouncement: null,
		myOpenAnnouncements: [],
		wgHealth: {
			shareCode: SHARE_CODE,
			openShoppingCount: 1,
			overdueChoreCount: 0,
			openDebtCents: 0,
			openAnnouncementCount: 0,
			absentMemberCount: 0,
			dueRecurringCount: 0,
		},
		dueRecurringExpenses: [],
		absentMembers: [],
		setup: {
			choreCount: 1,
			hasExpense: true,
			hasShoppingItem: true,
			hasAnnouncement: false,
			notificationsEnabled: true,
		},
	};

	async function mockLayoutApis(page: Page): Promise<void> {
		await page.route(`**/api/wg/${SHARE_CODE}/dashboard*`, (route) => {
			if (route.request().method() !== 'GET') return route.continue();
			return route.fulfill({ json: dashboardData });
		});
		await page.route(`**/api/wg/${SHARE_CODE}/shopping*`, (route) => {
			if (route.request().method() !== 'GET') return route.continue();
			return route.fulfill({ json: { items: shoppingItems } });
		});
		await page.route(`**/api/wg/${SHARE_CODE}/inventory*`, (route) => {
			if (route.request().method() !== 'GET') return route.continue();
			return route.fulfill({ json: { items: inventoryItems, grouped: {} } });
		});
		await page.route(`**/api/wg/${SHARE_CODE}/chores*`, (route) => {
			if (route.request().method() !== 'GET') return route.continue();
			return route.fulfill({ json: { chores } });
		});
		await page.route(`**/api/wg/${SHARE_CODE}/absences*`, (route) => {
			if (route.request().method() !== 'GET') return route.continue();
			return route.fulfill({ json: { absences: [] } });
		});
	}

	async function assertNav(page: Page, width: number) {
		const nav = page.locator('nav[data-app-chrome]').last();
		const navBox = await measureBox(nav);
		expect(navBox).not.toBeNull();
		if (!navBox) throw new Error('bottom navigation is missing');
		expect(navBox.x).toBeGreaterThanOrEqual(0);
		expect(navBox.x + navBox.width).toBeLessThanOrEqual(width + 1);

		const labels = ['Start', 'Haushalt', 'Finanzen', 'Austausch'] as const;
		expect(await nav.getByRole('link').count()).toBe(labels.length);
		for (const label of labels) {
			const link = nav.getByRole('link', { name: label, exact: true });
			await expect(link).toHaveCount(1);
			const linkBox = await link.boundingBox();
			const labelNode = link.locator('span').last();
			const labelBox = await labelNode.boundingBox();
			const labelMetrics = await labelNode.evaluate((element) => {
				const style = getComputedStyle(element);
				return {
					lineHeight: Number.parseFloat(style.lineHeight),
					height: element.getBoundingClientRect().height,
					scrollWidth: element.scrollWidth,
					clientWidth: element.clientWidth,
				};
			});
			expect(linkBox).not.toBeNull();
			expect(labelBox).not.toBeNull();
			if (!linkBox || !labelBox) continue;
			expect(linkBox.width).toBeGreaterThanOrEqual(44);
			expect(linkBox.height).toBeGreaterThanOrEqual(44);
			expect(labelMetrics.height).toBeLessThanOrEqual(labelMetrics.lineHeight + 1);
			expect(labelMetrics.scrollWidth).toBeLessThanOrEqual(labelMetrics.clientWidth + 1);
			expect(labelBox.x).toBeGreaterThanOrEqual(linkBox.x);
			expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(linkBox.x + linkBox.width + 1);
		}
		return { nav, navBox };
	}

	async function measureBox(locator: Locator) {
		if ((await locator.count()) !== 1) return null;
		return locator.evaluate((element) => {
			const box = element.getBoundingClientRect();
			return {
				x: box.x,
				y: box.y,
				width: box.width,
				height: box.height,
				scrollWidth: element.scrollWidth,
				clientWidth: element.clientWidth,
			};
		});
	}

	async function assertWholeWordsOnSingleLines(text: Locator, words: string[]): Promise<void> {
		const wordLines = await text.evaluate((element, expectedWords) => {
			const textNode = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
			if (!textNode) throw new Error('layout title text node missing');
			const value = textNode.textContent ?? '';
			const own = element.getBoundingClientRect();
			const container = element.closest('[data-slot="item-title"]')?.getBoundingClientRect() ?? own;
			const bounds = {
				left: Math.max(own.left, container.left),
				right: Math.min(own.right, container.right),
				top: Math.max(own.top, container.top),
				bottom: Math.min(own.bottom, container.bottom),
			};
			return expectedWords.map((word) => {
				const start = value.indexOf(word);
				if (start < 0) throw new Error(`layout title word missing: ${word}`);
				const range = document.createRange();
				range.setStart(textNode, start);
				range.setEnd(textNode, start + word.length);
				const rect = range.getBoundingClientRect();
				return {
					word,
					lineCount: range.getClientRects().length,
					left: rect.left,
					right: rect.right,
					top: rect.top,
					bottom: rect.bottom,
					boxLeft: bounds.left,
					boxRight: bounds.right,
					boxTop: bounds.top,
					boxBottom: bounds.bottom,
				};
			});
		}, words);
		for (const word of wordLines) {
			expect(word.lineCount, word.word).toBe(1);
			expect(word.left, word.word).toBeGreaterThanOrEqual(word.boxLeft - 1);
			expect(word.right, word.word).toBeLessThanOrEqual(word.boxRight + 1);
			expect(word.top, word.word).toBeGreaterThanOrEqual(word.boxTop - 1);
			expect(word.bottom, word.word).toBeLessThanOrEqual(word.boxBottom + 1);
		}
	}

	function expectRectsNotToOverlap(
		first: { x: number; y: number; width: number; height: number },
		second: { x: number; y: number; width: number; height: number },
	): void {
		expect(
			first.x < second.x + second.width &&
				first.x + first.width > second.x &&
				first.y < second.y + second.height &&
				first.y + first.height > second.y,
		).toBe(false);
	}

	async function assertInventoryModal(page: Page, width: number): Promise<void> {
		expect(await page.evaluate(() => window.innerWidth)).toBe(width);
		await expect(page.getByRole('heading', { name: 'Neuer Vorrat' })).toBeVisible();
		for (const [label, control] of [
			['Name', page.locator('#inventory-name')],
			['Menge', page.locator('#inventory-qty')],
			['Nachkaufen ab', page.locator('#inventory-threshold')],
			['Einheit', page.locator('#inventory-unit')],
			['Kategorie', page.locator('#inventory-category')],
		] as const) {
			const box = await measureBox(control);
			expect(box).not.toBeNull();
			if (!box) continue;
			expect(box.width, label).toBeGreaterThanOrEqual(240);
			expect(box.x + box.width, label).toBeLessThanOrEqual(width - 16 + 1);
			expect(box.height, label).toBeGreaterThanOrEqual(44);
		}
		const help = page.getByText(
			// Default Menge 0 ≤ Nachkaufen ab 1, so the form warns about the automatic shopping entry.
			'Die Menge liegt nicht über „Nachkaufen ab“ – der Vorrat kommt beim Speichern direkt auf die Einkaufsliste.',
			{ exact: true },
		);
		const helpBox = await measureBox(help);
		expect(helpBox).not.toBeNull();
		if (helpBox) {
			expect(helpBox.x).toBeGreaterThanOrEqual(16);
			expect(helpBox.x + helpBox.width).toBeLessThanOrEqual(width - 16 + 1);
		}
		for (const label of ['Abbrechen', 'Speichern']) {
			const button = page.getByRole('button', { name: label, exact: true });
			const box = await measureBox(button);
			expect(box).not.toBeNull();
			if (!box) continue;
			expect(box.width).toBeGreaterThanOrEqual(240);
			// Buttons stay 36px visually; the ::after layer carries the 44px hit area.
			const hitHeight = await button.evaluate(
				(el) => Number.parseFloat(getComputedStyle(el, '::after').height) || 0,
			);
			expect(Math.max(box.height, hitHeight)).toBeGreaterThanOrEqual(44);
			expect(box.x + box.width).toBeLessThanOrEqual(width - 16 + 1);
			expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
		}
	}

	async function assertViewportLayout(page: Page, route: LayoutRoute): Promise<void> {
		const viewportWidth = page.viewportSize()?.width ?? 320;
		const metrics = await page.evaluate(() => ({
			innerWidth: window.innerWidth,
			scrollWidth: document.documentElement.scrollWidth,
		}));
		expect(metrics.innerWidth).toBe(viewportWidth);
		const overflow = await page.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>('*')]
				.map((element) => ({
					tag: element.tagName,
					id: element.id,
					slot: element.dataset.slot,
					className: element.className,
					rect: element.getBoundingClientRect().toJSON(),
				}))
				.filter(({ rect }) => rect.left < -1 || rect.right > window.innerWidth + 1)
				.slice(0, 10),
		);
		expect(
			metrics.scrollWidth,
			`${route} overflow: ${JSON.stringify(overflow)}`,
		).toBeLessThanOrEqual(viewportWidth);
		const { nav } = await assertNav(page, viewportWidth);

		if (route === 'shopping') {
			const input = await page.locator('#shopping-name').boundingBox();
			const submit = await page.getByRole('button', { name: 'Artikel hinzufügen' }).boundingBox();
			expect(input).not.toBeNull();
			expect(submit).not.toBeNull();
			if (input && submit) {
				// Eine Eingabezeile; bei 200% rutscht die Icon-Aktion darunter.
				expect(input.width).toBeGreaterThanOrEqual(200);
				expect(input.height).toBeGreaterThanOrEqual(44);
				expect(submit.height).toBeGreaterThanOrEqual(44);
				expect(submit.x + submit.width).toBeLessThanOrEqual(viewportWidth - 16 + 1);
			}
			const row = page.locator('[data-shopping-row]').first();
			const title = row.locator('[data-slot="item-title"]');
			const actions = row.locator('[data-slot="item-actions"]');
			const rowBox = await row.boundingBox();
			const titleBox = await title.boundingBox();
			const actionsBox = await actions.boundingBox();
			expect(rowBox).not.toBeNull();
			expect(titleBox).not.toBeNull();
			expect(actionsBox).not.toBeNull();
			if (rowBox && titleBox && actionsBox) {
				const wordLines = await title.evaluate((element) => {
					const textNode = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
					if (!textNode) throw new Error('shopping title text node missing');
					const value = textNode.textContent ?? '';
					return ['Ungesüßte', 'Hafermilch'].map((word) => {
						const start = value.indexOf(word);
						const range = document.createRange();
						range.setStart(textNode, start);
						range.setEnd(textNode, start + word.length);
						return { word, lineCount: range.getClientRects().length };
					});
				});
				for (const word of wordLines) expect(word.lineCount, word.word).toBe(1);
				// Name und Aktionen überlappen nie: nebeneinander oder (bei großer Schrift) untereinander.
				expect(
					titleBox.x + titleBox.width <= actionsBox.x + 1 ||
						titleBox.y + titleBox.height <= actionsBox.y + 1,
				).toBe(true);
				expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
			}
		} else if (route === 'inventory') {
			const row = page
				.locator('[data-slot="item"]')
				.filter({ hasText: LONG_INVENTORY_NAME })
				.first();
			const title = row.locator('[data-slot="item-title"]');
			const name = title.locator(`span[title="${LONG_INVENTORY_NAME}"]`);
			const quantity = row.locator('[data-slot="item-description"]');
			const actions = row.locator('[data-slot="item-actions"]');
			const contentRow = row.locator(':scope > div').first();
			const contentRowMetrics = await contentRow.evaluate((element) => ({
				clientWidth: element.clientWidth,
				scrollWidth: element.scrollWidth,
			}));
			// 44px pseudo-element hit areas can extend 4px beyond each 36px icon button.
			expect(contentRowMetrics.scrollWidth - contentRowMetrics.clientWidth).toBeLessThanOrEqual(8);
			for (const text of [name, quantity]) {
				const metrics = await text.evaluate((element) => ({
					clientWidth: element.clientWidth,
					scrollWidth: element.scrollWidth,
				}));
				expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
			}
			await expect(name).toHaveText(LONG_INVENTORY_NAME);
			const rowBox = await row.boundingBox();
			const titleBox = await title.boundingBox();
			const actionsBox = await actions.boundingBox();
			expect(rowBox).not.toBeNull();
			expect(titleBox).not.toBeNull();
			expect(actionsBox).not.toBeNull();
			if (rowBox && titleBox && actionsBox) {
				expect(titleBox.x).toBeGreaterThanOrEqual(rowBox.x);
				expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
				expect(actionsBox.x).toBeGreaterThanOrEqual(rowBox.x);
				expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
				expectRectsNotToOverlap(titleBox, actionsBox);
			}
			const buttons = await row.getByRole('button').all();
			expect(buttons).toHaveLength(4);
			for (const button of buttons) {
				await expect(button).toBeVisible();
				const box = await button.boundingBox();
				const hitTarget = await button.evaluate((element) => {
					const after = getComputedStyle(element, '::after');
					return {
						width: Number.parseFloat(after.width),
						height: Number.parseFloat(after.height),
					};
				});
				expect(box).not.toBeNull();
				expect(hitTarget.width).toBeGreaterThanOrEqual(44);
				expect(hitTarget.height).toBeGreaterThanOrEqual(44);
				if (box && rowBox) {
					expect(box.x).toBeGreaterThanOrEqual(rowBox.x);
					expect(box.x + box.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
				}
			}
			const firstButton = buttons[0];
			if (!firstButton) throw new Error('inventory row actions are missing');
			await firstButton.focus();
			for (const button of buttons.slice(1)) {
				await page.keyboard.press('Tab');
				await expect(button).toBeFocused();
			}
		} else if (route === 'chores') {
			const row = page.locator('[data-slot="item"]').filter({ hasText: 'Bad putzen' }).first();
			expect(await row.count()).toBe(1);
			const title = row.locator('[data-slot="item-title"]');
			const actions = row.locator('[data-slot="item-actions"]');
			const rowBox = await row.boundingBox();
			const titleBox = await title.boundingBox();
			const actionsBox = await actions.boundingBox();
			expect(rowBox).not.toBeNull();
			expect(titleBox).not.toBeNull();
			expect(actionsBox).not.toBeNull();
			await assertWholeWordsOnSingleLines(title, ['Bad', 'putzen']);
			if (rowBox && titleBox && actionsBox) {
				expect(titleBox.x).toBeGreaterThanOrEqual(rowBox.x);
				expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
				expect(actionsBox.x).toBeGreaterThanOrEqual(rowBox.x);
				expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
				expectRectsNotToOverlap(titleBox, actionsBox);
			}
			for (const button of await row.getByRole('button').all()) {
				const box = await button.boundingBox();
				expect(box).not.toBeNull();
				if (!box) continue;
				// Buttons stay 36px visually; the ::after layer carries the 44px hit area.
				const hitHeight = await button.evaluate(
					(el) => Number.parseFloat(getComputedStyle(el, '::after').height) || 0,
				);
				expect(Math.max(box.height, hitHeight)).toBeGreaterThanOrEqual(44);
				expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 1);
			}
		} else {
			const contentBox = await page.locator('[data-home-content]').boundingBox();
			expect(contentBox).not.toBeNull();
			if (contentBox)
				expect(contentBox.x + contentBox.width).toBeLessThanOrEqual(viewportWidth + 1);
			const detail = page.getByText('Für dich · heute fällig', { exact: true });
			await expect(detail).toHaveCount(1);
			const detailMetrics = await detail.evaluate((element) => {
				const card = element.closest('li');
				if (!card) throw new Error('Home today row missing');
				const cardStyle = getComputedStyle(card);
				const cardInnerWidth =
					card.getBoundingClientRect().width -
					Number.parseFloat(cardStyle.paddingLeft) -
					Number.parseFloat(cardStyle.paddingRight) -
					Number.parseFloat(cardStyle.borderLeftWidth) -
					Number.parseFloat(cardStyle.borderRightWidth);
				const textNode = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
				if (!textNode) throw new Error('Home focus detail text missing');
				const value = textNode.textContent ?? '';
				const words = ['heute', 'fällig'].map((word) => {
					const start = value.indexOf(word);
					const range = document.createRange();
					range.setStart(textNode, start);
					range.setEnd(textNode, start + word.length);
					return { word, lineCount: range.getClientRects().length };
				});
				return { cardInnerWidth, detailWidth: element.getBoundingClientRect().width, words };
			});
			expect(detailMetrics.detailWidth).toBeLessThanOrEqual(detailMetrics.cardInnerWidth + 1);
			for (const word of detailMetrics.words) expect(word.lineCount, word.word).toBe(1);
		}

		if (route === 'shopping') await page.getByText(/^Erledigt \(/).click();
		await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
		await page.waitForTimeout(50);
		const lastAction =
			route === 'shopping'
				? page.getByRole('button', { name: /Erledigte Artikel entfernen/ })
				: route === 'inventory'
					? page.locator('a').filter({ hasText: 'Einkaufsliste öffnen' }).last()
					: route === 'chores'
						? page.getByRole('button', { name: /Als erledigt markieren: Bad putzen/ })
						: page.locator('[data-home-content] a').last();
		await expect(lastAction).toHaveCount(1);
		// Aufgeklappte Abschnitte und smooth scroll brauchen einen Moment, bis das Layout steht.
		await expect(async () => {
			await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
			const lastActionBox = await lastAction.boundingBox();
			const finalNavBox = await nav.boundingBox();
			expect(lastActionBox).not.toBeNull();
			expect(finalNavBox).not.toBeNull();
			if (lastActionBox && finalNavBox) {
				expect(lastActionBox.y + lastActionBox.height).toBeLessThanOrEqual(finalNavBox.y - 4);
			}
		}).toPass({ timeout: 5000 });
	}

	for (const route of ['home', 'chores', 'shopping', 'inventory'] as const) {
		for (const colorScheme of ['light'] as const) {
			for (const textScale of ['normal', '200%'] as const) {
				test(`${route} remains readable at 320px (${colorScheme}, ${textScale} text)`, async ({
					page,
				}) => {
					await page.setViewportSize({ width: 320, height: 740 });
					await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
					await setupMember(page);
					if (route === 'shopping') {
						// Keep the admin-only clear action present for the layout measurement;
						// non-admin visibility is covered by the focused authorization test.
						await page.route(`**/api/wg/${SHARE_CODE}/members*`, (request) =>
							request.fulfill({
								json: {
									members: [{ id: MEMBER_ID, name: 'dsaf', active: true }],
									viewerIsAdmin: true,
								},
							}),
						);
					}
					await mockLayoutApis(page);
					await navigateToFeature(
						page,
						route === 'home'
							? `/wg/${SHARE_CODE}`
							: `/wg/${SHARE_CODE}/${route === 'chores' ? 'putzen' : route === 'shopping' ? 'einkauf' : 'vorraete'}`,
					);
					await dismissOnboarding(page);
					await expect(
						page.getByRole('heading', {
							name:
								route === 'home'
									? 'Für dich'
									: route === 'chores'
										? 'Putzplan'
										: route === 'shopping'
											? 'Einkaufsliste'
											: 'Vorräte',
						}),
					).toBeVisible({ timeout: 30_000 });
					expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);
					if (textScale === '200%') {
						await page.evaluate(() => {
							document.documentElement.style.fontSize = '200%';
						});
						await page.setViewportSize({ width: 320, height: 740 });
						await page.waitForTimeout(100);
					}
					const rootFontSize = await page.evaluate(
						() => getComputedStyle(document.documentElement).fontSize,
					);
					// Normale Schrift skaliert auf schmalen Handys fluid (90–100 %), 200 % bleibt exakt.
					if (textScale === '200%') {
						expect(rootFontSize).toBe('32px');
					} else {
						expect(Number.parseFloat(rootFontSize)).toBeGreaterThanOrEqual(14.4);
						expect(Number.parseFloat(rootFontSize)).toBeLessThanOrEqual(16);
					}
					if (route === 'inventory') {
						await page
							.getByRole('button', { name: 'Vorrat hinzufügen', exact: true })
							.first()
							.click();
						await assertInventoryModal(page, page.viewportSize()?.width ?? 320);
						await page.screenshot({
							path: test
								.info()
								.outputPath(`inventory-modal-${colorScheme}-${textScale.replace('%', '')}.png`),
							fullPage: true,
						});
						const modalForm = page.locator('[data-slot="drawer-content"] form').last();
						await modalForm.evaluate((form) => form.scrollTo(0, form.scrollHeight));
						await page.waitForTimeout(100);
						await page.screenshot({
							path: test
								.info()
								.outputPath(
									`inventory-modal-bottom-${colorScheme}-${textScale.replace('%', '')}.png`,
								),
							fullPage: true,
						});
						await page
							.getByRole('button', { name: 'Abbrechen', exact: true })
							.click({ force: true });
						await expect(page.getByRole('heading', { name: 'Neuer Vorrat' })).toBeHidden();
						await page.waitForTimeout(500);
					}
					await assertViewportLayout(page, route);
					await page.screenshot({
						path: test
							.info()
							.outputPath(`${route}-${colorScheme}-${textScale.replace('%', '')}.png`),
						fullPage: true,
					});
				});
			}
		}
	}

	// Minimal matrix next to the 320px light case above: 320px dark at 200% text.
	const extraInventoryLayouts = [{ width: 320, colorScheme: 'dark', textScale: '200%' }] as const;

	for (const { width, colorScheme, textScale } of extraInventoryLayouts) {
		test(`inventory row remains readable at ${width}px (${colorScheme}, ${textScale} text)`, async ({
			page,
		}) => {
			await page.setViewportSize({ width, height: 740 });
			await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
			await setupMember(page);
			await mockLayoutApis(page);
			await navigateToFeature(page, `/wg/${SHARE_CODE}/vorraete`);
			await dismissOnboarding(page);
			await expect(page.getByRole('heading', { name: 'Vorräte' })).toBeVisible({ timeout: 30_000 });
			if (textScale === '200%') {
				await page.evaluate(() => {
					document.documentElement.style.fontSize = '200%';
				});
				await page.setViewportSize({ width, height: 740 });
				await page.waitForTimeout(100);
			}
			const rootFontSize = await page.evaluate(
				() => getComputedStyle(document.documentElement).fontSize,
			);
			if (textScale === '200%') {
				expect(rootFontSize).toBe('32px');
			} else {
				expect(Number.parseFloat(rootFontSize)).toBeGreaterThanOrEqual(14.4);
				expect(Number.parseFloat(rootFontSize)).toBeLessThanOrEqual(16);
			}
			await assertViewportLayout(page, 'inventory');
			await page.screenshot({
				path: test
					.info()
					.outputPath(`inventory-row-${width}-${colorScheme}-${textScale.replace('%', '')}.png`),
				fullPage: true,
			});
		});
	}
});

test.describe('entry frame overflow', () => {
	test.describe('entry headings on narrow screens', () => {
		test.skip(
			process.env.E2E_FIXTURE_MODE !== 'true' || process.env.NEXT_PUBLIC_DB_DOWN !== 'true',
			'Requires the local database-down fixture server.',
		);

		test('wraps an unbroken WG name at handset widths and 32px text', async ({ page }) => {
			const wgName = 'Donaudampfschifffahrtsgesellschaftskapitänswohngemeinschaft';
			await page.setViewportSize({ width: 320, height: 780 });
			await page.addInitScript(() => window.localStorage.clear());
			await mockNoWgs(page);
			await page.route('**/api/wg', async (route) => {
				if (route.request().method() === 'POST') {
					await route.fulfill({
						json: {
							wg: { id: 'fixture', shareCode: 'MTE8PZAT', name: wgName },
							creator: { id: 'fixture-user', name: 'Anna' },
						},
					});
					return;
				}
				await route.continue();
			});

			await page.goto('/neu');
			await page.getByRole('button', { name: 'Neue WG erstellen', exact: true }).click();
			await page.getByLabel('WG-Name').fill(wgName);
			await page.getByLabel('Dein Anzeigename').fill('Anna');
			await page.getByRole('button', { name: 'WG erstellen', exact: true }).click();

			const heading = page.getByRole('heading', { name: wgName, exact: true, level: 1 });
			await expect(heading).toBeVisible();

			for (const width of [320, 360]) {
				for (const fontSize of [26, 32]) {
					for (const colorScheme of ['light', 'dark'] as const) {
						await page.setViewportSize({ width, height: 780 });
						await page.emulateMedia({ colorScheme });
						await expect
							.poll(() =>
								page.locator('html').evaluate((element) => element.classList.contains('dark')),
							)
							.toBe(colorScheme === 'dark');
						await heading.evaluate((element, size) => {
							(element as HTMLElement).style.fontSize = `${size}px`;
						}, fontSize);
						const layout = await heading.evaluate((element) => {
							const style = getComputedStyle(element);
							const rect = element.getBoundingClientRect();
							return {
								documentWidth: document.documentElement.scrollWidth,
								viewportWidth: window.innerWidth,
								headingRight: rect.right,
								headingHeight: rect.height,
								lineHeight: Number.parseFloat(style.lineHeight),
							};
						});

						expect(
							layout.documentWidth,
							`${width}px, ${fontSize}px, ${colorScheme}`,
						).toBeLessThanOrEqual(layout.viewportWidth);
						expect(
							layout.headingRight,
							`${width}px, ${fontSize}px, ${colorScheme}`,
						).toBeLessThanOrEqual(layout.viewportWidth);
						expect(layout.headingHeight).toBeGreaterThan(layout.lineHeight);
					}
				}
			}
		});
	});
});

test.describe('public header reflow', () => {
	test('public brand and account links reflow on narrow pages', async ({ page }) => {
		await page.route('**/api/wg/mine', (route) =>
			route.fulfill({
				status: 401,
				contentType: 'application/json',
				body: '{"error":"auth_required"}',
			}),
		);

		const layoutFailures: string[] = [];
		for (const path of ['/', '/entdecken/kalender']) {
			await page.goto(path);
			const brand = page.getByRole('link', { name: 'ManaWG Startseite', exact: true });
			const account = page.getByRole('link', { name: 'Anmelden', exact: true });
			await expect(brand).toHaveAttribute('href', '/');
			await expect(account).toHaveAttribute('href', '/neu');

			for (const width of [320, 360, 390]) {
				await page.setViewportSize({ width, height: 844 });
				for (const scheme of ['light', 'dark'] as const) {
					await page.emulateMedia({ colorScheme: scheme });
					await expect
						.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
						.toBe(scheme === 'dark');
					for (const rootFontSize of [16, 32]) {
						await page.evaluate((size) => {
							document.documentElement.style.fontSize = `${size}px`;
						}, rootFontSize);
						await page.evaluate(() => document.fonts.ready);
						await expect(account).toBeVisible();

						const metrics = await page.evaluate(() => {
							const brandLink = document.querySelector<HTMLAnchorElement>(
								'a[aria-label="ManaWG Startseite"]',
							);
							const accountLink = [...document.querySelectorAll<HTMLAnchorElement>('a')].find(
								(link) => link.textContent?.trim() === 'Anmelden',
							);
							if (!brandLink || !accountLink) return null;
							const brandRect = brandLink.getBoundingClientRect();
							const accountRect = accountLink.getBoundingClientRect();
							return {
								viewportWidth: window.innerWidth,
								documentWidth: Math.max(
									document.documentElement.scrollWidth,
									document.body.scrollWidth,
								),
								brandRight: brandRect.right,
								accountRight: accountRect.right,
								overlap:
									brandRect.right > accountRect.left &&
									accountRect.right > brandRect.left &&
									brandRect.bottom > accountRect.top &&
									accountRect.bottom > brandRect.top,
							};
						});
						const label = `${path} ${width}px root ${rootFontSize}px ${scheme}`;
						if (!metrics) {
							layoutFailures.push(`${label}: header links missing`);
							continue;
						}
						if (
							metrics.documentWidth > metrics.viewportWidth ||
							metrics.brandRight > width ||
							metrics.accountRight > width ||
							metrics.overlap
						) {
							layoutFailures.push(`${label}: ${JSON.stringify(metrics)}`);
						}
					}
				}
			}

			await page.setViewportSize({ width: 320, height: 844 });
			await page.emulateMedia({ colorScheme: 'dark' });
			await page.evaluate(() => {
				document.documentElement.style.fontSize = '32px';
			});
			await brand.focus();
			await page.keyboard.press('Tab');
			await expect(account).toBeFocused();
		}

		expect(layoutFailures).toEqual([]);
	});
});

test.describe('app shell state', () => {
	test.describe('app shell navigation state', () => {
		test('restores create intent from the URL after signing out', async ({ page }) => {
			test.skip(
				!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
				'Requires the configured Supabase browser client.',
			);

			await mockNoWgs(page);

			await page.goto('/neu?action=create');
			await page.getByRole('button', { name: 'Mit anderem Konto anmelden', exact: true }).click();

			await expect(
				page.getByText('Melde dich an, danach erstellst du deine neue WG.'),
			).toBeVisible();
		});

		test('restores invitation intent from the URL after signing out', async ({ page }) => {
			test.skip(
				!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
				'Requires the configured Supabase browser client.',
			);

			await mockNoWgs(page);

			await page.goto(`/neu?code=${FIXTURE_WG.shareCode}`);
			await page.getByRole('button', { name: 'Mit anderem Konto anmelden', exact: true }).click();

			await expect(
				page.getByText('Melde dich an, um mit deinem Einladungscode beizutreten.'),
			).toBeVisible();
		});

		test('lets a signed-in single-WG user open that WG from a module preview', async ({ page }) => {
			test.skip(
				process.env.E2E_FIXTURE_MODE !== 'true' || process.env.NEXT_PUBLIC_DB_DOWN !== 'true',
				'Requires the database-down fixture server.',
			);

			await setupMember(page);
			await page.route('**/api/wg/mine', (route) =>
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						wgs: [{ id: FIXTURE_WG.id, code: FIXTURE_WG.shareCode, name: 'Meine WG' }],
					}),
				}),
			);

			await page.goto('/entdecken/einkauf');
			const openWg = page.getByRole('link', { name: 'WG öffnen', exact: true });
			await expect(openWg).toBeVisible();
			await openWg.click();
			await expect(page).toHaveURL(new RegExp(`/wg/${FIXTURE_WG.shareCode}$`));
		});

		test('opens the WG chooser from a module preview with an invitation query', async ({
			page,
		}) => {
			test.skip(
				process.env.E2E_FIXTURE_MODE !== 'true' || process.env.NEXT_PUBLIC_DB_DOWN !== 'true',
				'Requires the database-down fixture server.',
			);

			await page.route('**/api/wg/mine', (route) =>
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						wgs: [
							{ id: FIXTURE_WG.id, code: FIXTURE_WG.shareCode, name: 'Meine WG' },
							{ id: 'second-wg', code: 'ABCDEFGH', name: 'Zweite WG' },
						],
					}),
				}),
			);

			await page.goto(`/entdecken/einkauf?code=${FIXTURE_WG.shareCode}`);
			const openWgs = page.getByRole('link', { name: 'Deine WGs', exact: true });
			await expect(openWgs).toBeVisible();
			await openWgs.click();
			await expect(page).toHaveURL('/');
			await expect(page.getByRole('heading', { name: 'Deine WGs', exact: true })).toBeVisible();
			await expect(page.getByText('Zweite WG', { exact: true })).toBeVisible();
		});
	});
});

test.describe('drawer mobile zoom', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	const { id: wgId, memberId, memberName, shareCode } = FIXTURE_WG;

	const drawers = [
		{ feature: 'putzen', openButton: 'Putzaufgabe hinzufügen' },
		{ feature: 'vorraete', openButton: 'Vorrat hinzufügen' },
		{ feature: 'kalender', openButton: 'Termin hinzufügen' },
	] as const;

	async function mockHouseholdData(page: Page): Promise<void> {
		await page.route(`**/api/wg/${shareCode}/members`, (route) =>
			route.fulfill({
				json: {
					members: [
						{ id: memberId, name: memberName, color: null, active: true },
						{ id: wgId, name: 'Mina', color: null, active: true },
					],
					viewerIsAdmin: false,
				},
			}),
		);
		await page.route(`**/api/wg/${shareCode}/chores`, (route) =>
			route.fulfill({ json: { chores: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/absences`, (route) =>
			route.fulfill({ json: { absences: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/inventory`, (route) =>
			route.fulfill({ json: { items: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/events**`, (route) =>
			route.fulfill({ json: { events: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/dashboard`, (route) =>
			route.fulfill({ json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] } }),
		);
		await mockUnreadCount(page, `/api/wg/${shareCode}`);
	}

	for (const drawerCase of drawers) {
		test(`${drawerCase.feature} drawer stays usable at large text on a narrow phone`, async ({
			page,
		}) => {
			test.setTimeout(120_000);
			await setupMember(page);
			await mockHouseholdData(page);
			await page.setViewportSize({ width: 320, height: 640 });
			await navigateToFeature(page, `/wg/${shareCode}/${drawerCase.feature}`);
			await dismissOnboarding(page);
			await page.getByRole('button', { name: drawerCase.openButton, exact: true }).first().click();

			const drawer = page.getByRole('dialog');
			await expect(drawer).toBeVisible();
			const footer = drawer.locator('[data-slot="drawer-footer"]');
			const fields = drawer.locator(
				'input:visible:not([type="checkbox"]), textarea:visible, select:visible',
			);
			await expect(fields.first()).toBeVisible();
			await expect(footer.getByRole('button').first()).toHaveAccessibleName(/.+/);

			for (const fontSize of [32, 16]) {
				await page.evaluate((size) => {
					document.documentElement.style.fontSize = `${size}px`;
				}, fontSize);
				await expect
					.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize))
					.toBe(`${fontSize}px`);

				for (const height of [640, 812]) {
					await page.setViewportSize({ width: 320, height });
					for (const theme of ['light', 'dark'] as const) {
						await page.emulateMedia({ colorScheme: theme });
						await expect
							.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
							.toBe(theme === 'dark');

						const firstField = fields.first();
						const lastField = fields.last();
						await firstField.focus();
						await page.keyboard.press('Tab');
						expect(
							await drawer.evaluate((element) => element.contains(document.activeElement)),
						).toBe(true);
						await lastField.focus();
						await expect(lastField).toBeInViewport();

						if (fontSize === 32 && height === 640) {
							const scroll = await lastField.evaluate((field) => {
								let parent = field.parentElement;
								while (parent) {
									const overflowY = getComputedStyle(parent).overflowY;
									if (
										(overflowY === 'auto' || overflowY === 'scroll') &&
										parent.scrollHeight > parent.clientHeight
									) {
										return {
											clientHeight: parent.clientHeight,
											scrollHeight: parent.scrollHeight,
											scrollTop: parent.scrollTop,
										};
									}
									parent = parent.parentElement;
								}
								return null;
							});
							expect(scroll).not.toBeNull();
							expect(scroll?.scrollHeight).toBeGreaterThan(scroll?.clientHeight ?? 0);
							expect(scroll?.scrollTop).toBeGreaterThan(0);
						}

						for (const button of await footer.getByRole('button').all()) {
							await expect(button).toHaveAccessibleName(/.+/);
							await button.focus();
							await expect(button).toBeInViewport({ ratio: 1 });
						}
					}
				}
			}
		});
	}
});

test.describe('alert dialog responsive', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	async function expectAlertDialogLayout(page: Page, dialog: Locator) {
		for (const fontSize of ['16px', '32px']) {
			await page.evaluate((size) => {
				document.documentElement.style.fontSize = size;
			}, fontSize);

			for (const theme of ['light', 'dark'] as const) {
				await page.emulateMedia({ colorScheme: theme });
				await expect
					.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
					.toBe(theme === 'dark');

				for (const width of [320, 360, 390]) {
					await page.setViewportSize({ width, height: 740 });
					await dialog.evaluate(async (element) => {
						await Promise.all(
							element
								.getAnimations({ subtree: true })
								.map((animation) => animation.finished.catch(() => undefined)),
						);
					});
					const layout = await dialog.evaluate((element) => {
						const measure = (node: HTMLElement) => {
							const rect = node.getBoundingClientRect();
							const target = getComputedStyle(node, '::after');
							return {
								left: rect.left,
								right: rect.right,
								width: rect.width,
								clientWidth: node.clientWidth,
								scrollWidth: node.scrollWidth,
								touchWidth: Number.parseFloat(target.width),
								touchHeight: Number.parseFloat(target.height),
							};
						};
						const footer = element.querySelector<HTMLElement>('[data-slot="alert-dialog-footer"]');
						const header = element.querySelector<HTMLElement>('[data-slot="alert-dialog-header"]');
						const text = Array.from(
							element.querySelectorAll<HTMLElement>(
								'[data-slot="alert-dialog-title"], [data-slot="alert-dialog-description"]',
							),
						);
						return {
							rootFontSize: getComputedStyle(document.documentElement).fontSize,
							pageWidth: document.documentElement.scrollWidth,
							dialog: measure(element),
							footer: footer ? measure(footer) : null,
							header: header ? measure(header) : null,
							text: text.map(measure),
							buttons: footer
								? Array.from(footer.querySelectorAll<HTMLElement>('button')).map(measure)
								: [],
						};
					});

					expect(layout.rootFontSize).toBe(fontSize);
					expect(layout.pageWidth).toBeLessThanOrEqual(width);
					expect(layout.dialog.width).toBeLessThanOrEqual(width);
					expect(layout.dialog.scrollWidth).toBeLessThanOrEqual(layout.dialog.clientWidth + 1);
					expect(layout.footer).not.toBeNull();
					expect(layout.header).not.toBeNull();
					if (layout.footer) {
						expect(layout.footer.left).toBeGreaterThanOrEqual(layout.dialog.left - 2);
						expect(layout.footer.right).toBeLessThanOrEqual(layout.dialog.right + 2);
						expect(layout.footer.scrollWidth).toBeLessThanOrEqual(layout.footer.clientWidth + 1);
					}
					for (const item of [...(layout.header ? [layout.header] : []), ...layout.text]) {
						expect(item.right).toBeLessThanOrEqual(layout.dialog.right + 2);
						expect(item.scrollWidth).toBeLessThanOrEqual(item.clientWidth + 1);
					}
					for (const button of layout.buttons) {
						expect(button.right).toBeLessThanOrEqual(layout.dialog.right + 2);
						expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
						expect(button.touchWidth).toBeGreaterThanOrEqual(44);
						expect(button.touchHeight).toBeGreaterThanOrEqual(44);
					}
				}
			}
		}
	}

	test('keeps chore and subscription confirmations usable at phone widths and 200% text', async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const shareCode = FIXTURE_WG.shareCode;
		const viewer = {
			id: FIXTURE_WG.memberId,
			name: FIXTURE_WG.memberName,
			color: null,
			active: true,
		};
		const title = 'Aufgabe alert-layout';
		const chore = {
			id: 'alert-layout',
			title,
			intervalDays: 7,
			recurrenceType: 'days',
			nextDueAt: new Date(Date.now() + 3_600_000).toISOString(),
			assignedMemberId: viewer.id,
			lastCompletedAt: null,
			lastCompletedByName: null,
			openGapCountForAssignee: 0,
		};
		const abo = {
			id: 'alert-layout-abo',
			description: 'Musik-Abo',
			amountCents: 123456,
			currency: 'EUR',
			paidByMemberId: viewer.id,
			intervalMonths: 1,
			nextDueAt: '2026-10-01T12:00:00.000Z',
			lastCreatedAt: null,
			pausedAt: null,
			splits: [{ debtorMemberId: viewer.id, amountCents: 123456 }],
		};

		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/members*`, (route) =>
			route.fulfill({ json: { members: [viewer], viewerIsAdmin: false } }),
		);
		await page.route(`**/api/wg/${shareCode}/chores*`, (route) =>
			route.fulfill({ json: { chores: [chore], monthCompletions: {} } }),
		);
		await page.route(`**/api/wg/${shareCode}/absences*`, (route) =>
			route.fulfill({ json: { absences: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/dashboard*`, (route) =>
			route.fulfill({
				json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] },
			}),
		);
		await page.route(`**/api/wg/${shareCode}/chat/unread-count*`, (route) =>
			route.fulfill({ json: { count: 0, overflow: false } }),
		);
		await page.route(`**/api/wg/${shareCode}/recurring-expenses*`, (route) =>
			route.fulfill({ json: { recurringExpenses: [abo] } }),
		);

		await page.setViewportSize({ width: 320, height: 740 });
		await navigateToFeature(page, `/wg/${shareCode}/putzen`);
		await dismissOnboarding(page);

		const completeTrigger = page.getByRole('button', {
			name: `Als erledigt markieren: ${title}`,
		});
		await completeTrigger.focus();
		await page.keyboard.press('Enter');
		const choreDialog = page.getByRole('alertdialog');
		await expect(choreDialog).toBeVisible();
		await expectAlertDialogLayout(page, choreDialog);
		expect(await choreDialog.evaluate((element) => element.contains(document.activeElement))).toBe(
			true,
		);
		await choreDialog.getByRole('button', { name: 'Abbrechen', exact: true }).focus();
		await page.keyboard.press('Shift+Tab');
		await expect(
			choreDialog.getByRole('button', {
				name: `Erledigt bestätigen: ${title}`,
			}),
		).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(choreDialog).toBeHidden();
		await expect(completeTrigger).toBeFocused();

		await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
		await page.setViewportSize({ width: 320, height: 740 });
		await page.goto(`/wg/${shareCode}/abos`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: /Details öffnen: Musik-Abo/ }).click();
		const deleteTrigger = page.getByRole('button', { name: 'Musik-Abo löschen' });
		await expect(deleteTrigger).toBeVisible();
		await deleteTrigger.focus();
		await page.keyboard.press('Enter');
		const aboDialog = page.getByRole('alertdialog');
		await expect(aboDialog).toBeVisible();
		await expectAlertDialogLayout(page, aboDialog);
		expect(await aboDialog.evaluate((element) => element.contains(document.activeElement))).toBe(
			true,
		);
		await page.keyboard.press('Escape');
		await expect(aboDialog).toBeHidden();
		await expect(deleteTrigger).toBeFocused();
	});
});

test.describe('overlay back dismiss', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	const { shareCode } = FIXTURE_WG;

	test.use({ hasTouch: true });

	// Record CloseWatchers so the test can fire the close request Android's back
	// gesture would send; Playwright has no system back button.
	async function trackCloseWatchers(page: Page): Promise<void> {
		await page.addInitScript(() => {
			const Native = (window as unknown as { CloseWatcher?: new () => object }).CloseWatcher;
			if (!Native) return;
			const watchers: object[] = [];
			(window as unknown as { __closeWatchers: object[] }).__closeWatchers = watchers;
			(window as unknown as { CloseWatcher: unknown }).CloseWatcher = class extends Native {
				constructor() {
					super();
					watchers.push(this);
				}
			};
		});
	}

	async function pressSystemBack(page: Page): Promise<void> {
		await page.evaluate(() => {
			const watchers = (window as unknown as { __closeWatchers: { requestClose(): void }[] })
				.__closeWatchers;
			watchers.at(-1)?.requestClose();
		});
	}

	// Material 3: the Android back gesture closes an open overlay instead of
	// leaving the page.
	test('system back closes an open drawer instead of leaving the page', async ({ page }) => {
		await trackCloseWatchers(page);
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/chores`, (route) =>
			route.fulfill({ json: { chores: [] } }),
		);
		await page.setViewportSize({ width: 320, height: 640 });
		await navigateToFeature(page, `/wg/${shareCode}/putzen`);
		await dismissOnboarding(page);

		const trigger = page.getByRole('button', { name: 'Putzaufgabe hinzufügen', exact: true });
		await trigger.click();
		const drawer = page.getByRole('dialog');
		await expect(drawer).toBeVisible();

		await pressSystemBack(page);

		expect(new URL(page.url()).pathname).toBe(`/wg/${shareCode}/putzen`);
		await expect(drawer).toBeHidden();
		await expect(trigger).toBeFocused();
	});

	test('system back closes an open alert dialog instead of leaving the page', async ({ page }) => {
		await trackCloseWatchers(page);
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/members`, (route) =>
			route.fulfill({
				json: {
					members: [
						{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName, color: null, active: true },
						{ id: 'fixture-other-member', name: 'Mira', color: null, active: true },
					],
					viewerIsAdmin: true,
				},
			}),
		);
		await page.setViewportSize({ width: 320, height: 640 });
		await navigateToFeature(page, `/wg/${shareCode}/einstellungen#zugang`);
		await dismissOnboarding(page);

		const trigger = page.getByRole('button', { name: 'Komplette WG für alle löschen' });
		await trigger.click();
		const alertDialog = page.getByRole('alertdialog', { name: 'WG dauerhaft löschen?' });
		await expect(alertDialog).toBeVisible();

		await pressSystemBack(page);

		expect(new URL(page.url()).pathname).toBe(`/wg/${shareCode}/einstellungen`);
		await expect(alertDialog).toBeHidden();
		await expect(trigger).toBeFocused();
	});

	// A history-based back handler once cancelled this navigation.
	test('closing an overlay keeps the navigation it started', async ({ page }) => {
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/imports/preview`, (route) =>
			route.fulfill({
				json: {
					parsed: [
						{
							date: '2026-09-25T00:00:00.000Z',
							description: 'Wocheneinkauf',
							amountCents: 1200,
							currency: 'EUR',
							paidByName: FIXTURE_WG.memberName,
							splits: [{ memberName: FIXTURE_WG.memberName, amountCents: 1200 }],
							warnings: [],
						},
					],
					payloadHash: 'overlay-navigation',
					memberMapping: { [FIXTURE_WG.memberName]: FIXTURE_WG.memberId },
					conflicts: [],
					members: [{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName }],
				},
			}),
		);
		await page.setViewportSize({ width: 320, height: 640 });
		await navigateToFeature(page, `/wg/${shareCode}/import`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: /Splitwise CSV/ }).click();
		await page.getByText('Oder Inhalt einfügen', { exact: true }).click();
		await page.getByRole('textbox', { name: 'Inhalt des Exports' }).fill('fixture export');
		await page.getByRole('button', { name: 'Vorschau erstellen', exact: true }).click();
		await expect(
			page.getByRole('heading', { name: 'Namen WG-Mitgliedern zuordnen' }),
		).toBeVisible();

		await page.getByRole('link', { name: 'Ausgaben' }).first().click();
		await page.getByRole('button', { name: 'Verwerfen' }).click();

		await expect(page).toHaveURL(new RegExp(`/wg/${shareCode}/ausgaben$`));
		await page.waitForTimeout(1000);
		await expect(page).toHaveURL(new RegExp(`/wg/${shareCode}/ausgaben$`));
	});
});

test.describe('toast pause on hover', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');
	test.use({ hasTouch: true, isMobile: true });

	// WCAG 2.2.1 (Timing Adjustable): an auto-dismissing toast must pause while the
	// user is hovering or focusing it, and only resume counting down afterwards.
	// The toast's dismiss timer (Toast.tsx: TOAST_DURATION_MS = 4000) used to be a
	// single un-pausable setTimeout, so this test must fail against that version.
	const TOAST_DURATION_MS = 4000;
	const PAST_DURATION_MS = TOAST_DURATION_MS + 400;

	test('a toast pauses its auto-dismiss timer while hovered or focused', async ({ page }) => {
		const abo = {
			id: 'abo-netflix',
			description: 'Netflix',
			amountCents: 1499,
			currency: 'EUR',
			paidByMemberId: FIXTURE_WG.memberId,
			intervalMonths: 1,
			nextDueAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
			lastCreatedAt: null,
			pausedAt: null,
			splits: [{ debtorMemberId: FIXTURE_WG.memberId, amountCents: 1499 }],
		};

		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/recurring-expenses`, (route) => {
			if (route.request().method() === 'GET') {
				return route.fulfill({ json: { recurringExpenses: [abo] } });
			}
			return route.continue();
		});
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/recurring-expenses/*`, (route) => {
			if (route.request().method() === 'DELETE') {
				return route.fulfill({ status: 500, json: { error: 'delete_failed' } });
			}
			return route.continue();
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/abos`);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: /^Details öffnen: Netflix/ }).click();
		await page.getByRole('button', { name: 'Netflix löschen' }).click();
		await page.getByRole('button', { name: 'Löschen' }).last().click();

		const toast = page
			.getByRole('region', { name: 'Benachrichtigungen' })
			.getByRole('alert')
			.filter({ hasText: 'Fixkosten konnten nicht gelöscht werden' });
		await expect(toast).toBeVisible();
		const closeButton = toast.getByRole('button', { name: 'Benachrichtigung schließen' });

		// WCAG 2.4.3 (Focus Order): the toast stack must sit after the bottom nav
		// in the DOM so Tab reaches a toast's dismiss button right after whatever
		// the user just did, instead of jumping back to the page top.
		const navHandle = await page
			.getByRole('navigation', { name: 'WG Hauptnavigation' })
			.elementHandle();
		const toastComesAfterNav = await toast.evaluate((toastEl, navEl) => {
			// Node.DOCUMENT_POSITION_FOLLOWING = 4: navEl precedes toastEl in the DOM.
			if (!navEl) return false;
			return Boolean(navEl.compareDocumentPosition(toastEl) & 4);
		}, navHandle);
		expect(toastComesAfterNav).toBe(true);

		// Hover pause: still visible well past the normal auto-dismiss point.
		await toast.hover();
		await page.waitForTimeout(PAST_DURATION_MS);
		await expect(toast).toBeVisible();

		// Leaving restarts a fresh countdown; focusing the close button before it
		// elapses must pause it again.
		await page.mouse.move(5, 5);
		await closeButton.focus();
		await page.waitForTimeout(PAST_DURATION_MS);
		await expect(toast).toBeVisible();

		// Blurring resumes the timer, which then dismisses the toast normally.
		await closeButton.evaluate((el) => el.blur());
		await page.waitForTimeout(PAST_DURATION_MS);
		await expect(toast).toBeHidden();
	});
});
