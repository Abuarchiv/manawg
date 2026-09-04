import { type Page, expect, test } from '@playwright/test';

const wgId = '989ac820-58b7-431f-9c65-28721264f333';
const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const buyerId = '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55';
const base = '/wg/MTE8PZAT';
const draftKey = `manawg:draft:MTE8PZAT:${memberId}:expense`;

async function identify(page: Page) {
	await page.addInitScript(
		({ wgId, memberId }) => {
			localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
		},
		{ wgId, memberId },
	);
}

async function emptyExpenses(page: Page) {
	await page.route('**/api/wg/MTE8PZAT/expenses', (route) =>
		route.fulfill({ json: { expenses: [] } }),
	);
	await page.route('**/api/wg/MTE8PZAT/recurring-expenses', (route) =>
		route.fulfill({ json: { recurringExpenses: [] } }),
	);
}

const emptyDashboard = {
	balances: [],
	spendByDay: [],
	totalSpendCents: 0,
	weekSpendCents: 0,
	monthSpendCents: 0,
	openShoppingCount: 0,
	openShoppingTop: [],
	dueChores: [],
	activity: [],
	latestAnnouncement: null,
	myOpenAnnouncements: [],
	wgHealth: { score: 100, label: 'ruhig', items: [] },
	dueRecurringExpenses: [],
	absentMembers: [],
	setup: {
		choreCount: 0,
		hasExpense: false,
		hasShoppingItem: false,
		hasAnnouncement: false,
		notificationsEnabled: true,
	},
};

async function noHorizontalOverflow(page: Page) {
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
}

test.describe('Daily product experience', () => {
	test.setTimeout(120_000);
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

	test('puts a useful first action before empty statistics and opens the chore draft', async ({
		page,
	}) => {
		await identify(page);
		await page.route('**/api/wg/MTE8PZAT/dashboard', (route) =>
			route.fulfill({ json: emptyDashboard }),
		);
		await page.goto(base);
		const action = page.getByRole('link', { name: 'Erste Aufgabe anlegen', exact: true });
		await expect(action).toBeVisible();
		await expect(page.getByLabel('Ausgaben pro Tag, letzte 14 Tage')).toBeHidden();
		const actionBox = await action.boundingBox();
		const statBox = await page.getByText('Deine Bilanz', { exact: true }).boundingBox();
		expect(actionBox?.y).toBeLessThan(statBox?.y ?? Number.NEGATIVE_INFINITY);
		await noHorizontalOverflow(page);
		await page.screenshot({
			path: '/tmp/astra-ux-dashboard-first.png',
			fullPage: true,
			animations: 'disabled',
		});
		await action.click();
		await expect(page.getByRole('textbox', { name: 'Aufgabe', exact: true })).toHaveValue(
			'Bad putzen',
		);
	});

	test('puts actual today work before statistics for a returning resident', async ({ page }) => {
		await identify(page);
		await page.route('**/api/wg/MTE8PZAT/dashboard', (route) =>
			route.fulfill({
				json: {
					...emptyDashboard,
					openShoppingCount: 1,
					openShoppingTop: ['Hafermilch'],
					setup: { ...emptyDashboard.setup, hasShoppingItem: true },
				},
			}),
		);
		await page.goto(base);
		const focus = page.getByRole('link').filter({ hasText: 'Hafermilch fehlt noch' });
		await expect(focus).toBeVisible();
		expect((await focus.boundingBox())?.y).toBeLessThan(
			(await page.getByText('Deine Bilanz', { exact: true }).boundingBox())?.y ??
				Number.NEGATIVE_INFINITY,
		);
		await expect(page.getByText('Willkommen in deiner WG')).toBeHidden();
		await page.screenshot({
			path: '/tmp/astra-ux-dashboard-return.png',
			fullPage: true,
			animations: 'disabled',
		});
	});

	test('hands a bought item to an explicit payer and split review without a write', async ({
		page,
	}) => {
		await identify(page);
		await emptyExpenses(page);
		let writes = 0;
		page.on('request', (request) => {
			if (request.method() === 'POST' && request.url().endsWith('/expenses')) writes += 1;
		});
		const name = 'Hafermilch ohne Zucker für den gemeinsamen Frühstücksvorrat';
		await page.route('**/api/wg/MTE8PZAT/shopping', (route) =>
			route.fulfill({
				json: {
					items: [
						{
							id: 'bought-product',
							name,
							quantity: '2 Packungen',
							addedByMemberId: memberId,
							boughtByMemberId: buyerId,
							boughtAt: new Date().toISOString(),
							createdAt: new Date().toISOString(),
						},
					],
				},
			}),
		);
		await page.goto(`${base}/einkauf`);
		const row = page.locator('#shopping-bought-product');
		await expect(row.getByText('Hinzugefügt von dsaf')).toBeVisible();
		await expect(row.getByText('Gekauft von Mina')).toBeVisible();
		const handoff = row.getByRole('link', { name: `${name} als Ausgabe übernehmen` });
		await expect(handoff).toHaveText('Als Ausgabe übernehmen');
		await noHorizontalOverflow(page);
		await page.screenshot({
			path: '/tmp/astra-ux-shopping.png',
			fullPage: true,
			animations: 'disabled',
		});
		await handoff.click();
		await expect(page.getByLabel('Beschreibung', { exact: true })).toHaveValue(name);
		await expect(page.getByLabel('Bezahlt von')).toHaveValue(buyerId);
		await expect(
			page.getByText('Die Ausgabe ist noch nicht gespeichert. Prüfe Betrag und Aufteilung.'),
		).toBeVisible();
		await page.getByLabel('Betrag', { exact: true }).fill('30,01');
		const preview = page.getByRole('region', { name: 'So wird die Ausgabe aufgeteilt' });
		await expect(preview).toContainText('dsaf schuldet Mina 15,01');
		await expect(preview).toContainText('Mina: eigener Anteil 15,00');
		const previewBox = await preview.boundingBox();
		const saveBox = await page
			.getByRole('button', { name: 'Ausgabe speichern', exact: true })
			.boundingBox();
		expect(saveBox?.y).toBeGreaterThan(
			(previewBox?.y ?? Number.POSITIVE_INFINITY) + (previewBox?.height ?? 0),
		);
		await expect(preview).toContainText('Hier wird kein Geld überwiesen.');
		await page
			.getByRole('button', { name: 'Ausgabe speichern', exact: true })
			.scrollIntoViewIfNeeded();
		await page.screenshot({
			path: '/tmp/astra-ux-expense-review-viewport.png',
			animations: 'disabled',
		});
		await page.screenshot({
			path: '/tmp/astra-ux-expense-split.png',
			fullPage: true,
			animations: 'disabled',
		});
		expect(writes).toBe(0);
	});

	test('keeps an expense draft when closing and never overwrites it with shopping prefill', async ({
		page,
	}) => {
		await identify(page);
		await emptyExpenses(page);
		await page.goto(`${base}/ausgaben`);
		await page.getByRole('button', { name: 'Ausgabe erfassen', exact: true }).click();
		await page.getByLabel('Beschreibung', { exact: true }).fill('Mein angefangener Einkauf');
		await page.getByLabel('Betrag', { exact: true }).fill('19,80');
		await page.getByRole('button', { name: 'Ausgabenformular schließen', exact: true }).click();
		await expect(page.getByLabel('Beschreibung', { exact: true })).toBeHidden();
		await page.getByRole('button', { name: 'Ausgabe erfassen', exact: true }).click();
		await expect(page.getByLabel('Beschreibung', { exact: true })).toHaveValue(
			'Mein angefangener Einkauf',
		);
		await page.goto(`${base}/ausgaben?desc=Hafermilch&paidBy=${buyerId}&source=shopping`);
		await expect(page.getByLabel('Beschreibung', { exact: true })).toHaveValue(
			'Mein angefangener Einkauf',
		);
		await expect(page.getByText('Dein vorhandener Entwurf bleibt erhalten.')).toBeVisible();
		expect(
			await page.evaluate(
				(key) => JSON.parse(localStorage.getItem(key) ?? '{}').description,
				draftKey,
			),
		).toBe('Mein angefangener Einkauf');
	});

	test('reviews chore completion and uses the confirmed next responsibility', async ({ page }) => {
		await identify(page);
		const chore = {
			id: 'daily-chore',
			title: 'Bad gründlich reinigen und Handtücher austauschen',
			intervalDays: 7,
			recurrenceType: 'days',
			nextDueAt: '2026-09-05T10:00:00.000Z',
			assignedMemberId: memberId,
			lastCompletedAt: null,
			lastCompletedByName: null,
			openGapCountForAssignee: 0,
		};
		let completed = false;
		let writes = 0;
		const next = { ...chore, assignedMemberId: buyerId, nextDueAt: '2026-09-19T10:00:00.000Z' };
		await page.route('**/api/wg/MTE8PZAT/chores', (route) =>
			route.fulfill({ json: { chores: [completed ? next : chore] } }),
		);
		await page.route('**/api/wg/MTE8PZAT/absences', (route) =>
			route.fulfill({ json: { absences: [] } }),
		);
		await page.route('**/api/wg/MTE8PZAT/chores/daily-chore/complete', (route) => {
			writes += 1;
			completed = true;
			return route.fulfill({ json: { chore: next } });
		});
		await page.goto(`${base}/putzen`);
		await page.getByRole('button', { name: `Als erledigt markieren: ${chore.title}` }).click();
		await expect(page.getByText('Voraussichtlich als Nächstes: Mina.')).toBeVisible();
		await expect(
			page.getByText('Die Rotation berücksichtigt Aufgaben und Abwesenheiten.'),
		).toBeVisible();
		expect(writes).toBe(0);
		await page.screenshot({
			path: '/tmp/astra-ux-chore-review.png',
			fullPage: true,
			animations: 'disabled',
		});
		await page.getByRole('button', { name: `Erledigen abbrechen: ${chore.title}` }).click();
		expect(writes).toBe(0);
		await page.getByRole('button', { name: `Als erledigt markieren: ${chore.title}` }).click();
		await page.getByRole('button', { name: `Erledigt bestätigen: ${chore.title}` }).click();
		await expect(
			page.getByRole('status').filter({ hasText: 'Nächster Termin: 19.09.' }),
		).toContainText('Mina ist dran');
		expect(writes).toBe(1);
		await noHorizontalOverflow(page);
	});

	test('shows contextual form actions at 320px and explains chat versus notices', async ({
		page,
	}) => {
		await identify(page);
		await emptyExpenses(page);
		await page.setViewportSize({ width: 320, height: 844 });
		await page.goto(`${base}/ausgaben`);
		await expect(page.getByRole('button', { name: 'Ausgabe erfassen', exact: true })).toHaveText(
			'Ausgabe erfassen',
		);
		await noHorizontalOverflow(page);
		await page.goto(`${base}/chat`);
		await expect(page.getByRole('heading', { name: 'Chat', exact: true })).toBeVisible();
		await expect(page.getByText(/Für schnelle Abstimmung\./)).toBeVisible();
		await expect(
			page.getByRole('link', { name: 'Dauerhafte Infos auf die Pinnwand' }),
		).toHaveAttribute('href', `${base}/pinnwand`);
		await noHorizontalOverflow(page);
	});
});

test.describe('Reviewed settlement', () => {
	test.setTimeout(120_000);
	for (const changed of [false, true]) {
		test(changed
			? 'requires a new review after a concurrent settlement change'
			: 'confirms only the reviewed partial amount and records, never the full net balance', async ({
			page,
		}) => {
			await identify(page);
			await page.route('**/api/wg/MTE8PZAT/recurring-expenses', (route) =>
				route.fulfill({ json: { recurringExpenses: [] } }),
			);
			await page.route('**/api/wg/MTE8PZAT/expenses', (route) =>
				route.fulfill({
					json: {
						expenses: [
							{
								id: 'expense-reviewed',
								paidByMemberId: buyerId,
								amountCents: 3000,
								currency: 'EUR',
								description: 'Gemeinsamer Einkauf',
								imageUrl: null,
								occurredAt: '2026-09-01T10:00:00Z',
								createdAt: '2026-09-01T10:00:00Z',
								updatedAt: '2026-09-01T10:00:00Z',
								splits: [
									{
										id: 'split-reviewed',
										debtorMemberId: memberId,
										amountCents: 1000,
										settledAt: null,
									},
								],
							},
						],
					},
				}),
			);
			let posts: unknown[] = [];
			const review = {
				netCents: 1500,
				settleableCents: 1000,
				remainingCents: 500,
				splits: [{ id: 'split-reviewed', expenseId: 'expense-reviewed', amountCents: 1000 }],
			};
			await page.route('**/api/wg/MTE8PZAT/expenses/settle-batch*', (route) => {
				if (route.request().method() === 'GET') return route.fulfill({ json: review });
				posts = [...posts, route.request().postDataJSON()];
				return changed
					? route.fulfill({ status: 409, json: { error: 'settlement_changed' } })
					: route.fulfill({ json: { settled: 1, settledCents: 1000, remainingCents: 500 } });
			});
			await page.goto(`${base}/ausgaben`);
			await page.getByRole('button', { name: 'Bereits erfolgte Zahlung eintragen' }).click();
			const preview = page.getByRole('region', { name: 'Zahlung prüfen' });
			await expect(preview).toContainText('Hier wird kein Geld überwiesen.');
			await expect(preview).toContainText('Gemeinsamer Einkauf');
			await expect(preview).toContainText('5,00');
			await page.setViewportSize({ width: 390, height: 844 });
			await preview.getByRole('button', { name: 'Abbrechen', exact: true }).focus();
			await page.keyboard.press('Tab');
			const confirm = preview.getByRole('button', { name: /10,00.*als bezahlt eintragen/ });
			await expect(confirm).toBeFocused();
			const confirmBox = await confirm.boundingBox();
			const navBox = await page
				.getByRole('navigation', { name: 'WG Hauptnavigation' })
				.boundingBox();
			expect(
				(confirmBox?.y ?? Number.POSITIVE_INFINITY) + (confirmBox?.height ?? 0),
			).toBeLessThanOrEqual(navBox?.y ?? Number.NEGATIVE_INFINITY);
			const visibleScroll = await page.evaluate(() => window.scrollY);
			await preview.getByRole('button', { name: 'Abbrechen', exact: true }).focus();
			expect(await page.evaluate(() => window.scrollY)).toBe(visibleScroll);
			await confirm.focus();
			expect(await page.evaluate(() => window.scrollY)).toBe(visibleScroll);
			await confirm.evaluate((button) => button.scrollIntoView({ block: 'center' }));
			await page.screenshot({
				path: '/tmp/astra-ux-settlement-review-viewport.png',
				animations: 'disabled',
			});
			await page.screenshot({
				path: '/tmp/astra-ux-settlement-review.png',
				fullPage: true,
				animations: 'disabled',
			});
			expect(posts).toHaveLength(0);
			await preview.getByRole('button', { name: 'Abbrechen', exact: true }).click();
			expect(posts).toHaveLength(0);
			await page.getByRole('button', { name: 'Bereits erfolgte Zahlung eintragen' }).click();
			await preview.getByRole('button', { name: /10,00.*als bezahlt eintragen/ }).click();
			await expect.poll(() => posts.length).toBe(1);
			expect(posts[0]).toEqual({
				fromMemberId: memberId,
				toMemberId: buyerId,
				expected: {
					netCents: 1500,
					settleableCents: 1000,
					splits: [{ id: 'split-reviewed', amountCents: 1000 }],
				},
			});
			if (changed) {
				await expect(
					page.getByRole('alert').filter({ hasText: 'Die offenen Beträge haben sich geändert.' }),
				).toBeVisible();
				await expect(preview).toBeHidden();
			} else {
				await expect(page.getByRole('status').filter({ hasText: '10,00' })).toContainText('5,00');
			}
		});
	}
});

test('the payer’s own share is never an unpaid debt or a self-payment action', async ({ page }) => {
	await identify(page);
	await page.route('**/api/wg/MTE8PZAT/recurring-expenses', (route) =>
		route.fulfill({ json: { recurringExpenses: [] } }),
	);
	await page.route('**/api/wg/MTE8PZAT/expenses', (route) =>
		route.fulfill({
			json: {
				expenses: [
					{
						id: 'own-share',
						description: 'Wocheneinkauf',
						paidByMemberId: memberId,
						amountCents: 2000,
						currency: 'EUR',
						imageUrl: null,
						occurredAt: '2026-09-01T10:00:00Z',
						createdAt: '2026-09-01T10:00:00Z',
						updatedAt: '2026-09-01T10:00:00Z',
						splits: [
							{ id: 'own-split', debtorMemberId: memberId, amountCents: 1000, settledAt: null },
							{ id: 'other-split', debtorMemberId: buyerId, amountCents: 1000, settledAt: null },
						],
					},
				],
			},
		}),
	);
	await page.goto(`${base}/ausgaben?highlight=own-share`);
	await page.getByRole('button', { name: /Details für Wocheneinkauf/ }).click();
	await expect(page.getByText('Eigener Anteil', { exact: true })).toBeVisible();
	await expect(page.getByText('0/1 beglichen', { exact: true })).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'dsaf Zahlung als beglichen markieren' }),
	).toBeHidden();
	await expect(
		page.getByRole('button', { name: 'Mina Zahlung als beglichen markieren' }),
	).toBeVisible();
});

test.describe('Draft reload intent', () => {
	test.setTimeout(120_000);
	test('keeps the expense edit target and version after reload, including a stale response', async ({
		page,
	}) => {
		await identify(page);
		const expense = {
			id: 'persisted-edit',
			description: 'Internet',
			paidByMemberId: memberId,
			amountCents: 3000,
			currency: 'EUR',
			imageUrl: null,
			occurredAt: '2026-09-01T10:00:00Z',
			createdAt: '2026-09-01T10:00:00Z',
			updatedAt: '2026-09-01T10:00:00Z',
			splits: [],
		};
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', (route) =>
			route.fulfill({ json: { recurringExpenses: [] } }),
		);
		let posts = 0;
		const patches: Record<string, unknown>[] = [];
		await page.route('**/api/wg/MTE8PZAT/expenses', (route) => {
			if (route.request().method() === 'POST') {
				posts += 1;
				return route.fulfill({ json: { expense } });
			}
			return route.fulfill({ json: { expenses: [expense] } });
		});
		await page.route('**/api/wg/MTE8PZAT/expenses/persisted-edit', (route) => {
			patches.push(route.request().postDataJSON());
			return route.fulfill({ status: 409, json: { error: 'expense_changed' } });
		});
		await page.goto(`${base}/ausgaben?highlight=persisted-edit`);
		await page.getByRole('button', { name: 'Ausgabe bearbeiten: Internet' }).click();
		await page.getByLabel('Beschreibung', { exact: true }).fill('Internet September');
		await page.reload();
		await expect(page.getByLabel('Beschreibung', { exact: true })).toHaveValue(
			'Internet September',
		);
		await page.getByRole('button', { name: 'Ausgabe speichern', exact: true }).click();
		await expect.poll(() => patches.length).toBe(1);
		expect(posts).toBe(0);
		expect(patches[0]?.expectedUpdatedAt).toBe(expense.updatedAt);
		await expect(
			page.getByRole('alert').filter({ hasText: 'Diese Ausgabe wurde inzwischen geändert.' }),
		).toBeVisible();
		await expect(page.getByLabel('Beschreibung', { exact: true })).toHaveValue(
			'Internet September',
		);
	});

	test('restores a monthly chore draft without converting it to days', async ({ page }) => {
		await identify(page);
		await page.route('**/api/wg/MTE8PZAT/chores', (route) =>
			route.fulfill({ json: { chores: [] } }),
		);
		await page.route('**/api/wg/MTE8PZAT/absences', (route) =>
			route.fulfill({ json: { absences: [] } }),
		);
		await page.goto(`${base}/putzen`);
		await page.getByRole('button', { name: 'Putzaufgabe erfassen' }).click();
		await page.getByRole('textbox', { name: 'Aufgabe', exact: true }).fill('Fenster reinigen');
		await page.getByRole('button', { name: 'Monate', exact: true }).click();
		await page.getByRole('button', { name: 'quartalsweise', exact: true }).click();
		await page.reload();
		await expect(page.getByRole('textbox', { name: 'Aufgabe', exact: true })).toHaveValue(
			'Fenster reinigen',
		);
		await expect(page.getByRole('button', { name: 'Monate', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await expect(page.getByRole('button', { name: 'quartalsweise', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
	});
});

test('a damaged edit target remains blocked after reload without creating a new expense', async ({
	page,
}) => {
	await identify(page);
	await page.addInitScript((key) => {
		if (localStorage.getItem(key)) return;
		localStorage.setItem(
			key,
			JSON.stringify({
				description: 'Nicht duplizieren',
				amountStr: '20,00',
				editingExpense: { id: '../another-wg', updatedAt: 'invalid' },
			}),
		);
	}, draftKey);
	let writes = 0;
	await page.route('**/api/wg/MTE8PZAT/expenses', (route) => {
		if (route.request().method() !== 'GET') writes += 1;
		return route.fulfill({ json: { expenses: [] } });
	});
	await page.route('**/api/wg/MTE8PZAT/recurring-expenses', (route) =>
		route.fulfill({ json: { recurringExpenses: [] } }),
	);
	await page.goto(`${base}/ausgaben`);
	for (let attempt = 0; attempt < 2; attempt += 1) {
		await expect(page.getByLabel('Beschreibung', { exact: true })).toHaveValue('Nicht duplizieren');
		await page.getByRole('button', { name: 'Ausgabe speichern', exact: true }).click();
		await expect(
			page.getByRole('alert').filter({ hasText: 'Die Zuordnung dieses Entwurfs ist beschädigt.' }),
		).toBeVisible();
		expect(writes).toBe(0);
		await page.reload();
	}
});

test('keeps three months through offline queue, edit restoration and replay', async ({ page }) => {
	test.setTimeout(120_000);
	await identify(page);
	let offline = true;
	const replayed: Record<string, unknown>[] = [];
	await page.route('**/api/wg/MTE8PZAT/chores', (route) => {
		if (route.request().method() === 'POST') {
			if (offline) return route.abort('failed');
			replayed.push(route.request().postDataJSON());
			return route.fulfill({ json: { chores: [] } });
		}
		return route.fulfill({ json: { chores: [] } });
	});
	await page.route('**/api/wg/MTE8PZAT/absences', (route) =>
		route.fulfill({ json: { absences: [] } }),
	);
	await page.goto(`${base}/putzen`);
	await page.getByRole('button', { name: 'Putzaufgabe erfassen' }).click();
	await page.getByRole('textbox', { name: 'Aufgabe', exact: true }).fill('Fenster vierteljährlich');
	await page.getByRole('button', { name: 'Monate', exact: true }).click();
	await page.getByRole('button', { name: 'quartalsweise', exact: true }).click();
	await page.getByRole('button', { name: 'Aufgabe hinzufügen', exact: true }).click();
	await expect
		.poll(() =>
			page.evaluate(
				() => JSON.parse(localStorage.getItem('manawg:offline-actions') ?? '[]')[0]?.payload,
			),
		)
		.toMatchObject({ intervalDays: 3, recurrenceType: 'months' });
	await page.goto(`${base}/einstellungen#daten`);
	await page
		.getByRole('button', { name: 'Offline-Aktion bearbeiten: Fenster vierteljährlich' })
		.click();
	await expect(page.getByRole('textbox', { name: 'Aufgabe', exact: true })).toHaveValue(
		'Fenster vierteljährlich',
	);
	await expect(page.getByRole('button', { name: 'Monate', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true',
	);
	await expect(page.getByRole('button', { name: 'quartalsweise', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true',
	);
	await page.goto(`${base}/einstellungen#daten`);
	offline = false;
	await page
		.getByRole('button', { name: 'Offline-Warteschlange erneut synchronisieren', exact: true })
		.click();
	await expect.poll(() => replayed.length).toBe(1);
	expect(replayed[0]).toMatchObject({ intervalDays: 3, recurrenceType: 'months' });
	await expect
		.poll(() =>
			page.evaluate(
				() => JSON.parse(localStorage.getItem('manawg:offline-actions') ?? '[]').length,
			),
		)
		.toBe(0);
});

test('keeps settlement confirmation visible after the paid debt disappears', async ({ page }) => {
	await identify(page);
	let paid = false;
	await page.route('**/api/wg/MTE8PZAT/recurring-expenses', (route) =>
		route.fulfill({ json: { recurringExpenses: [] } }),
	);
	await page.route('**/api/wg/MTE8PZAT/expenses', (route) =>
		route.fulfill({
			json: {
				expenses: paid
					? []
					: [
							{
								id: 'full-payment',
								description: 'Vorräte',
								paidByMemberId: buyerId,
								amountCents: 1000,
								currency: 'EUR',
								imageUrl: null,
								occurredAt: '2026-09-01T10:00:00Z',
								createdAt: '2026-09-01T10:00:00Z',
								updatedAt: '2026-09-01T10:00:00Z',
								splits: [
									{
										id: 'full-share',
										debtorMemberId: memberId,
										amountCents: 1000,
										settledAt: null,
									},
								],
							},
						],
			},
		}),
	);
	await page.route('**/api/wg/MTE8PZAT/expenses/settle-batch*', (route) => {
		if (route.request().method() === 'GET')
			return route.fulfill({
				json: {
					netCents: 1000,
					settleableCents: 1000,
					remainingCents: 0,
					splits: [{ id: 'full-share', expenseId: 'full-payment', amountCents: 1000 }],
				},
			});
		paid = true;
		return route.fulfill({ json: { settled: 1, settledCents: 1000, remainingCents: 0 } });
	});
	await page.goto(`${base}/ausgaben`);
	await page.getByRole('button', { name: 'Bereits erfolgte Zahlung eintragen' }).click();
	await page.getByRole('button', { name: /10,00.*als bezahlt eintragen/ }).click();
	await expect(page.getByRole('heading', { name: 'Offene Zahlungen' })).toBeHidden();
	await expect(page.getByRole('status').filter({ hasText: 'Zahlung eingetragen:' })).toContainText(
		'10,00',
	);
});

test('queue editing protects partial and unknown draft data', async ({ page }) => {
	await identify(page);
	await page.route('**/api/wg/MTE8PZAT/chores', (route) =>
		route.request().method() === 'GET'
			? route.fulfill({ json: { chores: [] } })
			: route.abort('failed'),
	);
	const protectedDrafts = [
		{ title: '', intervalDays: 3, recurrenceType: 'months' },
		{ title: '', intervalDays: 7, customNote: 'Nicht verlieren' },
	];
	await page.goto(`${base}/einstellungen#daten`);
	for (const draft of protectedDrafts) {
		await page.evaluate(
			({ draft, memberId, wgId }) => {
				localStorage.setItem(`manawg:draft:MTE8PZAT:${memberId}:chore`, JSON.stringify(draft));
				localStorage.setItem(
					'manawg:offline-actions',
					JSON.stringify([
						{
							id: 'protected-queue',
							wgId,
							shareCode: 'MTE8PZAT',
							memberId,
							type: 'chore.create',
							createdAt: new Date().toISOString(),
							payload: { title: 'Wartende Aufgabe', intervalDays: 7, assignedMemberId: null },
						},
					]),
				);
			},
			{ draft, memberId, wgId },
		);
		await page.reload();
		await page.getByRole('button', { name: 'Offline-Aktion bearbeiten: Wartende Aufgabe' }).click();
		await expect(
			page.getByText(/Es existiert bereits ein anderer ungespeicherter Formular-Entwurf/),
		).toBeVisible();
		expect(
			await page.evaluate(
				(memberId) =>
					JSON.parse(localStorage.getItem(`manawg:draft:MTE8PZAT:${memberId}:chore`) ?? '{}'),
				memberId,
			),
		).toEqual(draft);
		await expect(page).toHaveURL(/einstellungen/);
	}
});

test.describe('Suggestion draft preservation', () => {
	test.setTimeout(120_000);

	test('shopping suggestions preserve partial payer, splits and unknown fields until explicit replacement', async ({
		page,
	}) => {
		await identify(page);
		await emptyExpenses(page);
		await page.addInitScript(
			({ draftKey, memberId, buyerId }) => {
				localStorage.setItem(
					draftKey,
					JSON.stringify({
						description: '',
						amountStr: '',
						paidByMemberId: buyerId,
						splitMode: 'manual',
						manualSplits: { [memberId]: '7,00' },
						customNote: 'Ungespeicherte Details',
					}),
				);
			},
			{ draftKey, memberId, buyerId },
		);
		await page.goto(`${base}/ausgaben?desc=Milch&paidBy=${memberId}&source=shopping`);
		await expect(page.getByLabel('Bezahlt von')).toHaveValue(buyerId);
		await expect(page.getByLabel('Anteil dsaf in Euro')).toHaveValue('7,00');
		await expect(page.getByLabel('Beschreibung', { exact: true })).toHaveValue('');
		await expect(page.getByText('Dein vorhandener Entwurf bleibt erhalten.')).toBeVisible();
		expect(
			await page.evaluate(
				(key) => JSON.parse(localStorage.getItem(key) ?? '{}').customNote,
				draftKey,
			),
		).toBe('Ungespeicherte Details');
		const replace = page.getByRole('button', { name: 'Entwurf verwerfen und „Milch“ übernehmen' });
		await replace.click();
		await page.getByRole('dialog').getByRole('button', { name: 'Entwurf behalten' }).click();
		await expect(page.getByLabel('Anteil dsaf in Euro')).toHaveValue('7,00');
		await replace.click();
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Entwurf verwerfen', exact: true })
			.click();
		await expect(page.getByLabel('Beschreibung', { exact: true })).toHaveValue('Milch');
		await expect(page.getByLabel('Bezahlt von')).toHaveValue(memberId);
		await expect(page.getByRole('button', { name: 'Aufteilung: Gleichmäßig' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await expect
			.poll(() =>
				page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').customNote, draftKey),
			)
			.toBeUndefined();
	});

	for (const accept of [false, true]) {
		test(accept
			? 'recurring suggestions replace a draft and advance only after explicit acceptance'
			: 'saving a retained draft does not advance a blocked recurring suggestion', async ({
			page,
		}) => {
			await identify(page);
			await page.addInitScript(
				({ draftKey, memberId }) =>
					localStorage.setItem(
						draftKey,
						JSON.stringify({
							description: 'Vorhandener Entwurf',
							amountStr: '20,00',
							paidByMemberId: memberId,
							splitMode: 'equal',
							manualSplits: {},
						}),
					),
				{ draftKey, memberId },
			);
			const template = {
				id: 'recurring-suggestion',
				description: 'Internet-Vorlage',
				amountCents: 3990,
				paidByMemberId: buyerId,
				intervalMonths: 1,
				nextDueAt: '2026-09-01T10:00:00Z',
				lastCreatedAt: null,
				splits: [
					{ debtorMemberId: memberId, amountCents: 1995 },
					{ debtorMemberId: buyerId, amountCents: 1995 },
				],
			};
			const saves: Record<string, unknown>[] = [];
			let advances = 0;
			await page.route('**/api/wg/MTE8PZAT/expenses', (route) => {
				if (route.request().method() !== 'POST') return route.fulfill({ json: { expenses: [] } });
				const body = route.request().postDataJSON();
				saves.push(body);
				return route.fulfill({
					json: {
						expense: {
							...body,
							id: 'suggestion-save',
							currency: 'EUR',
							occurredAt: '2026-09-04T10:00:00Z',
							createdAt: '2026-09-04T10:00:00Z',
							updatedAt: '2026-09-04T10:00:00Z',
							splits: body.splits.map((split: Record<string, unknown>, index: number) => ({
								...split,
								id: `saved-share-${index}`,
								settledAt: null,
							})),
						},
					},
				});
			});
			await page.route('**/api/wg/MTE8PZAT/recurring-expenses', (route) => {
				if (route.request().method() === 'PATCH') {
					advances += 1;
					return route.fulfill({ json: { recurringExpense: template } });
				}
				return route.fulfill({ json: { recurringExpenses: [template] } });
			});
			await page.goto(`${base}/ausgaben?recurring=recurring-suggestion`);
			await expect(page.getByText('Dein vorhandener Entwurf bleibt erhalten.')).toBeVisible();
			await expect(page.getByLabel('Beschreibung', { exact: true })).toHaveValue(
				'Vorhandener Entwurf',
			);
			if (accept) {
				await page
					.getByRole('button', { name: 'Entwurf verwerfen und „Internet-Vorlage“ übernehmen' })
					.click();
				await page
					.getByRole('dialog')
					.getByRole('button', { name: 'Entwurf verwerfen', exact: true })
					.click();
				await expect(page.getByLabel('Beschreibung', { exact: true })).toHaveValue(
					template.description,
				);
				await expect(page.getByLabel('Anteil dsaf in Euro')).toHaveValue('19,95');
			}
			await page.getByRole('button', { name: 'Ausgabe speichern', exact: true }).click();
			await expect(page.getByLabel('Beschreibung', { exact: true })).toBeHidden();
			expect(saves).toHaveLength(1);
			expect(saves[0]?.description).toBe(accept ? template.description : 'Vorhandener Entwurf');
			expect(advances).toBe(accept ? 1 : 0);
		});
	}

	test('dashboard chore suggestions preserve existing monthly draft and require explicit replacement', async ({
		page,
	}) => {
		await identify(page);
		const choreDraftKey = `manawg:draft:MTE8PZAT:${memberId}:chore`;
		await page.addInitScript(
			({ key, buyerId }) =>
				localStorage.setItem(
					key,
					JSON.stringify({
						title: 'Fenster reinigen',
						intervalDays: 3,
						recurrenceType: 'months',
						assignedMemberId: buyerId,
						customNote: 'Nicht verlieren',
					}),
				),
			{ key: choreDraftKey, buyerId },
		);
		await page.route('**/api/wg/MTE8PZAT/dashboard', (route) =>
			route.fulfill({ json: emptyDashboard }),
		);
		await page.route('**/api/wg/MTE8PZAT/chores', (route) =>
			route.fulfill({ json: { chores: [] } }),
		);
		await page.route('**/api/wg/MTE8PZAT/absences', (route) =>
			route.fulfill({ json: { absences: [] } }),
		);
		await page.goto(base);
		await page.getByRole('link', { name: 'Erste Aufgabe anlegen', exact: true }).click();
		await expect(page.getByRole('textbox', { name: 'Aufgabe', exact: true })).toHaveValue(
			'Fenster reinigen',
		);
		await expect(page.getByRole('button', { name: 'quartalsweise', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await expect(page.getByText('Dein vorhandener Entwurf bleibt erhalten.')).toBeVisible();
		expect(
			await page.evaluate(
				(key) => JSON.parse(localStorage.getItem(key) ?? '{}').customNote,
				choreDraftKey,
			),
		).toBe('Nicht verlieren');
		await page
			.getByRole('button', { name: 'Entwurf verwerfen und „Bad putzen“ übernehmen' })
			.click();
		await page.getByRole('dialog').getByRole('button', { name: 'Entwurf behalten' }).click();
		await expect(page.getByRole('textbox', { name: 'Aufgabe', exact: true })).toHaveValue(
			'Fenster reinigen',
		);
		await page
			.getByRole('button', { name: 'Entwurf verwerfen und „Bad putzen“ übernehmen' })
			.click();
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Entwurf verwerfen', exact: true })
			.click();
		await expect(page.getByRole('textbox', { name: 'Aufgabe', exact: true })).toHaveValue(
			'Bad putzen',
		);
		await expect(page.getByRole('button', { name: 'wöchentlich', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
	});
});

test('the deferred expense form shows loading and focuses its first field after the chunk arrives', async ({
	page,
}) => {
	test.setTimeout(120_000);
	await identify(page);
	await emptyExpenses(page);
	await page.goto(`${base}/ausgaben`);
	await expect(page.getByRole('button', { name: 'Ausgabe erfassen', exact: true })).toBeVisible();
	let release: (() => void) | undefined;
	const chunkCanLoad = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route('**/*.js', async (route) => {
		await chunkCanLoad;
		await route.continue();
	});
	try {
		await page.getByRole('button', { name: 'Ausgabe erfassen', exact: true }).click();
		await expect(
			page.getByRole('status').filter({ hasText: 'Ausgabenformular wird geladen…' }),
		).toBeVisible();
		await expect(page.getByLabel('Beschreibung', { exact: true })).toBeHidden();
	} finally {
		release?.();
	}
	await expect(page.getByLabel('Beschreibung', { exact: true })).toBeFocused();
});
