// Recurring-template expense retries: key, due date and splits across refreshes, replays and offline queueing.
// Why: a recurring expense must be booked once per period even when the network response is lost.

import { type Page, expect, test } from '@playwright/test';
import {
	API,
	type RequestAttempt,
	expectOfflineAutoSyncBackoff,
	expense,
	mockReads,
	queuedActionCount,
	recordAttempt,
	recurringExpense,
	sendQueueIfStillPending,
} from './support/expense-idempotency';
import {
	FIXTURE_WG,
	dismissOnboarding,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

skipUnlessFixtures();

async function queuedRecurringExpenseCount(page: Page): Promise<number> {
	return page.evaluate(() => {
		const queue = JSON.parse(localStorage.getItem('manawg:offline-actions') ?? '[]');
		return queue.filter(
			(action: {
				type?: string;
				payload?: { recurringExpenseId?: string; expectedRecurringNextDueAt?: string };
			}) =>
				action.type === 'expense.create' &&
				action.payload?.recurringExpenseId === 'recurring-rent' &&
				action.payload.expectedRecurringNextDueAt === '2020-01-01T00:00:00.000Z',
		).length;
	});
}

test('recurring template retries preserve key, due date, and splits after refreshed data', async ({
	page,
}) => {
	await setupMember(page);
	let serverCommitted = false;
	let committedTemplate: ReturnType<typeof recurringExpense> | null = null;
	await mockReads(
		page,
		[],
		() => (serverCommitted ? [expense('committed-expense', 'Strom')] : []),
		() => (committedTemplate ? [committedTemplate] : []),
	);
	const attempts: RequestAttempt[] = [];
	await page.route(`**${API}/recurring-expenses`, async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		const attempt = recordAttempt(route);
		attempts.push(attempt);
		if (attempts.length === 1) {
			serverCommitted = true;
			await page.evaluate(() => {
				Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
			});
			const body = attempt.body as { nextDueAt: string };
			committedTemplate = recurringExpense({
				description: 'Internet',
				amountCents: 1235,
				nextDueAt: body.nextDueAt,
			});
			return route.fulfill({ status: 500, json: { error: 'temporarily_unavailable' } });
		}
		return route.fulfill({
			json: { recurringExpense: recurringExpense({ description: 'Internet' }) },
		});
	});

	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/ausgaben?new=1&filter=recurring`);
	await dismissOnboarding(page);
	const form = page.getByRole('dialog');
	await form.getByLabel('Beschreibung').fill('Internet');
	await form.getByLabel('Betrag').fill('12,35');
	await form.getByRole('button', { name: /Fixkosten-Vorlage/ }).click();
	const saveTemplate = form.getByRole('button', { name: 'Als Vorlage merken' });
	await saveTemplate.click();
	await expect.poll(() => attempts.length).toBe(1);
	await expect(form).toBeVisible();
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	await expect(page.getByText('1 Eintrag', { exact: true })).toBeVisible();
	await saveTemplate.click();
	await expect.poll(() => attempts.length).toBe(2);
	await expect(saveTemplate).toBeEnabled();
	await expect(page.locator('[id="recurring-recurring-rent"]')).toHaveCount(1);

	expect(attempts[0]?.key).toBeTruthy();
	expect(attempts[1]?.key).toBe(attempts[0]?.key);
	expect(attempts[1]?.body).toEqual(attempts[0]?.body);
	await saveTemplate.click();
	await expect.poll(() => attempts.length).toBe(3);
	expect(attempts[2]?.key).not.toBe(attempts[1]?.key);
});

test('malformed recurring-template success queues once across split rotation, draft restore, and replay', async ({
	page,
}) => {
	await setupMember(page);
	const members = [
		{ id: FIXTURE_WG.memberId, name: 'Alexandra Beispiel', color: null, active: true },
		{ id: FIXTURE_WG.id, name: 'Max Mustermann', color: null, active: true },
	];
	await page.route(`**${API}/members`, (route) =>
		route.fulfill({ json: { members, viewerIsAdmin: false } }),
	);

	let serverCommitted = false;
	let committedTemplate: ReturnType<typeof recurringExpense> | null = null;
	const concurrentExpense = expense('committed-expense', 'Bürobedarf');
	await mockReads(
		page,
		[],
		() => (serverCommitted ? [concurrentExpense] : []),
		() => (committedTemplate ? [committedTemplate] : []),
	);
	const attempts: RequestAttempt[] = [];
	await page.route(`**${API}/recurring-expenses`, async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		const attempt = recordAttempt(route);
		attempts.push(attempt);
		if (attempts.length === 1) {
			serverCommitted = true;
			await page.evaluate(() => {
				Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
			});
			const body = attempt.body as {
				description: string;
				amountCents: number;
				nextDueAt: string;
				splits: Array<{ debtorMemberId: string; amountCents: number }>;
			};
			committedTemplate = {
				...recurringExpense({
					description: body.description,
					amountCents: body.amountCents,
					nextDueAt: body.nextDueAt,
				}),
				splits: body.splits,
			};
			return route.fulfill({
				status: 200,
				headers: { 'content-type': 'application/json' },
				body: '{"recurringExpense":',
			});
		}
		return route.fulfill({
			json: {
				recurringExpense: committedTemplate ?? recurringExpense({ description: 'Internet' }),
			},
		});
	});

	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/ausgaben?new=1&filter=recurring`);
	await dismissOnboarding(page);
	const form = page.getByRole('dialog');
	await form.getByLabel('Beschreibung').fill('Internet');
	await form.getByLabel('Betrag').fill('12,01');
	await form.getByRole('button', { name: /Fixkosten-Vorlage/ }).click();
	const saveTemplate = form.getByRole('button', { name: 'Als Vorlage merken' });

	await saveTemplate.click();
	await expect.poll(() => attempts.length).toBe(1);
	await expect(form).toBeVisible();
	await expect.poll(() => queuedActionCount(page, 'recurring.create')).toBe(1);

	const originalBody = attempts[0]?.body as {
		amountCents: number;
		splits: Array<{ debtorMemberId: string; amountCents: number }>;
	};
	expect(originalBody.amountCents).toBe(1201);
	expect(originalBody.splits.map((split) => split.amountCents).sort()).toEqual([600, 601]);
	expect(originalBody.splits.map((split) => split.debtorMemberId)).toEqual([
		FIXTURE_WG.memberId,
		FIXTURE_WG.id,
	]);

	await saveTemplate.click();
	await expect(page.getByText(/Fixkosten-Vorlage ist bereits offline vorgemerkt/)).toBeVisible();
	await expect.poll(() => queuedActionCount(page, 'recurring.create')).toBe(1);
	expect(attempts).toHaveLength(1);

	const restoredPage = await page.context().newPage();
	await restoredPage.addInitScript(() => {
		Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
	});
	await mockReads(
		restoredPage,
		[],
		() => [concurrentExpense],
		() => (committedTemplate ? [committedTemplate] : []),
	);
	await restoredPage.route(`**${API}/members`, (route) =>
		route.fulfill({ json: { members, viewerIsAdmin: false } }),
	);
	await restoredPage.route(`**${API}/shopping`, (route) =>
		route.request().method() === 'GET' ? route.fulfill({ json: { items: [] } }) : route.fallback(),
	);
	await restoredPage.route(`**${API}/inventory`, (route) => route.fulfill({ json: { items: [] } }));
	let replayEnabled = false;
	const blockedAttempts: RequestAttempt[] = [];
	await restoredPage.route(`**${API}/recurring-expenses`, async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		if (!replayEnabled) {
			blockedAttempts.push(recordAttempt(route));
			return route.abort();
		}
		attempts.push(recordAttempt(route));
		return route.fulfill({
			json: {
				recurringExpense: committedTemplate ?? recurringExpense({ description: 'Internet' }),
			},
		});
	});
	await navigateToFeature(restoredPage, `/wg/${FIXTURE_WG.shareCode}/ausgaben?filter=recurring`);
	await dismissOnboarding(restoredPage);
	const restoredForm = restoredPage.getByRole('dialog');
	// A draft does not open the form by itself; only „Ausgabe hinzufügen“ reveals it.
	await expect(restoredForm).toBeHidden();
	await restoredPage.getByRole('button', { name: 'Ausgabe hinzufügen' }).click();
	await expect(restoredForm).toBeVisible();
	await expect(restoredForm.getByLabel('Beschreibung')).toHaveValue('Internet');
	await expect(restoredForm.getByLabel('Betrag')).toHaveValue('12,01');
	await expectOfflineAutoSyncBackoff(
		restoredPage,
		'recurring.create',
		blockedAttempts,
		attempts[0]?.key ?? null,
	);
	const blockedAttemptCountBeforeClick = blockedAttempts.length;
	await restoredForm.getByRole('button', { name: /Fixkosten-Vorlage/ }).click();
	await restoredForm.getByRole('button', { name: 'Als Vorlage merken' }).click();
	await expect(
		restoredPage.getByText(/Fixkosten-Vorlage ist bereits offline vorgemerkt/),
	).toBeVisible();
	await expect.poll(() => queuedActionCount(restoredPage, 'recurring.create')).toBe(1);
	expect(
		blockedAttempts
			.slice(blockedAttemptCountBeforeClick)
			.every((attempt) => attempt.key === attempts[0]?.key),
	).toBe(true);
	expect(attempts).toHaveLength(1);

	await navigateToFeature(restoredPage, `/wg/${FIXTURE_WG.shareCode}/einkauf`);
	await expect.poll(() => queuedActionCount(restoredPage, 'recurring.create')).toBe(1);
	await expect(restoredPage.locator('[data-offline-banner]')).toContainText(
		'Offline. 1 Aktion wartet.',
	);
	replayEnabled = true;
	await sendQueueIfStillPending(restoredPage, () =>
		queuedActionCount(restoredPage, 'recurring.create'),
	);
	await expect.poll(() => attempts.length).toBe(2);
	await expect.poll(() => queuedActionCount(restoredPage, 'recurring.create')).toBe(0);
	expect(attempts).toHaveLength(2);

	expect(attempts[0]?.key).toBeTruthy();
	expect(attempts[1]?.key).toBe(attempts[0]?.key);
	expect(attempts[1]?.body).toEqual(attempts[0]?.body);
});

test('creating an expense from a recurring template reuses its key after a server error', async ({
	page,
}) => {
	await setupMember(page);
	const expectedRecurringNextDueAt = '2026-09-01T00:00:00.000Z';
	let currentTemplate = recurringExpense({ nextDueAt: expectedRecurringNextDueAt });
	let serverCommitted = false;
	let refreshedTemplate = false;
	await mockReads(
		page,
		[currentTemplate],
		() => (serverCommitted ? [expense('committed-recurring-expense', 'Miete')] : []),
		() => {
			if (serverCommitted) refreshedTemplate = true;
			return [currentTemplate];
		},
	);
	const attempts: RequestAttempt[] = [];
	await page.route(`**${API}/expenses`, async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		attempts.push(recordAttempt(route));
		if (attempts.length === 1) {
			serverCommitted = true;
			currentTemplate = recurringExpense({ nextDueAt: '2026-09-24T00:00:00.000Z' });
			return route.fulfill({ status: 500, json: { error: 'temporarily_unavailable' } });
		}
		return route.fulfill({
			json: { expense: expense('created-recurring-expense', 'Miete'), warning: null },
		});
	});

	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/ausgaben?filter=recurring`);
	await dismissOnboarding(page);
	const create = page.getByRole('button', { name: 'Erfassen: Miete' });
	await create.click();
	await expect.poll(() => attempts.length).toBe(1);
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	await expect.poll(() => refreshedTemplate).toBe(true);
	await expect(create).toBeVisible();
	await create.click();
	await expect.poll(() => attempts.length).toBe(2);

	expect(attempts[0]?.key).toBeTruthy();
	expect(attempts[1]?.key).toBe(attempts[0]?.key);
	expect(attempts[0]?.body).toMatchObject({
		recurringExpenseId: 'recurring-rent',
		expectedRecurringNextDueAt,
	});
	expect(attempts[1]?.body).toEqual(attempts[0]?.body);
});

test('a malformed recurring-expense success replays the queued request with its original key', async ({
	page,
}) => {
	await setupMember(page);
	const expectedRecurringNextDueAt = '2020-01-01T00:00:00.000Z';
	const currentTemplate = recurringExpense({ nextDueAt: expectedRecurringNextDueAt });
	let committedExpense: ReturnType<typeof expense> | null = null;
	await mockReads(
		page,
		[currentTemplate],
		() => (committedExpense ? [committedExpense] : []),
		() => [currentTemplate],
	);
	const attempts: RequestAttempt[] = [];
	await page.route(`**${API}/expenses`, async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		const attempt = recordAttempt(route);
		attempts.push(attempt);
		if (attempts.length === 1) {
			committedExpense = expense('created-recurring-expense', 'Miete');
			await page.evaluate(() => {
				Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
			});
			return route.fulfill({
				status: 200,
				headers: { 'content-type': 'application/json' },
				body: '{"expense":',
			});
		}
		return route.fulfill({
			json: {
				expense: committedExpense ?? expense('created-recurring-expense', 'Miete'),
				warning: null,
			},
		});
	});

	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/ausgaben?filter=recurring`);
	await dismissOnboarding(page);
	const create = page.getByRole('button', { name: 'Erfassen: Miete' });

	await create.click();
	await expect.poll(() => attempts.length).toBe(1);
	await expect.poll(() => queuedRecurringExpenseCount(page)).toBe(1);
	await create.click();
	await expect(
		page.getByText(
			'Fixkosten-Ausgabe offline vorgemerkt. Die Vorlage bleibt bis zur Synchronisierung unverändert.',
		),
	).toBeVisible();
	await expect.poll(() => queuedRecurringExpenseCount(page)).toBe(1);
	expect(attempts).toHaveLength(1);

	const replayPage = await page.context().newPage();
	await replayPage.addInitScript(() => {
		Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
	});
	await mockReads(
		replayPage,
		[currentTemplate],
		() => (committedExpense ? [committedExpense] : []),
		() => [currentTemplate],
	);
	let replayEnabled = false;
	const blockedAttempts: RequestAttempt[] = [];
	await replayPage.route(`**${API}/expenses`, async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		if (!replayEnabled) {
			blockedAttempts.push(recordAttempt(route));
			return route.abort();
		}
		attempts.push(recordAttempt(route));
		return route.fulfill({
			json: {
				expense: committedExpense ?? expense('created-recurring-expense', 'Miete'),
				warning: null,
			},
		});
	});
	await navigateToFeature(replayPage, `/wg/${FIXTURE_WG.shareCode}/ausgaben?filter=recurring`);
	await dismissOnboarding(replayPage);
	await expect.poll(() => queuedRecurringExpenseCount(replayPage)).toBe(1);
	await expectOfflineAutoSyncBackoff(
		replayPage,
		'expense.create',
		blockedAttempts,
		attempts[0]?.key ?? null,
	);
	await expect(replayPage.locator('[data-offline-banner]')).toContainText(
		'Offline. 1 Aktion wartet.',
	);

	replayEnabled = true;
	await sendQueueIfStillPending(replayPage, () => queuedRecurringExpenseCount(replayPage));
	await expect.poll(() => attempts.length).toBe(2);
	await expect.poll(() => queuedRecurringExpenseCount(replayPage)).toBe(0);
	expect(attempts).toHaveLength(2);

	expect(attempts[0]?.key).toBeTruthy();
	expect(attempts[1]?.key).toBe(attempts[0]?.key);
	expect(attempts[0]?.body).toMatchObject({
		recurringExpenseId: 'recurring-rent',
		expectedRecurringNextDueAt,
	});
	// The queued replay is stamped with its queue day; the first online attempt left it to the server.
	const { occurredAt, ...replayBody } = (attempts[1]?.body ?? {}) as Record<string, unknown>;
	expect(typeof occurredAt).toBe('string');
	expect(replayBody).toEqual(attempts[0]?.body);
});

test('recurring-source form retries keep the original due date and POST body', async ({ page }) => {
	await setupMember(page);
	const expectedRecurringNextDueAt = '2026-09-01T00:00:00.000Z';
	let currentTemplate = recurringExpense({ nextDueAt: expectedRecurringNextDueAt });
	let serverCommitted = false;
	let refreshedTemplate = false;
	await mockReads(
		page,
		[currentTemplate],
		() => (serverCommitted ? [expense('committed-recurring-expense', 'Miete')] : []),
		() => {
			if (serverCommitted) refreshedTemplate = true;
			return [currentTemplate];
		},
	);
	const attempts: RequestAttempt[] = [];
	await page.route(`**${API}/expenses`, async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		attempts.push(recordAttempt(route));
		if (attempts.length === 1) {
			serverCommitted = true;
			currentTemplate = recurringExpense({ nextDueAt: '2026-09-24T00:00:00.000Z' });
			return route.fulfill({ status: 500, json: { error: 'temporarily_unavailable' } });
		}
		return route.fulfill({
			json: { expense: expense('created-recurring-expense', 'Miete'), warning: null },
		});
	});

	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/ausgaben?recurring=recurring-rent`);
	await dismissOnboarding(page);
	const form = page.getByRole('dialog');
	const save = form.getByRole('button', { name: 'Ausgabe speichern' });
	await save.click();
	await expect.poll(() => attempts.length).toBe(1);
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	await expect.poll(() => refreshedTemplate).toBe(true);
	await save.click();
	await expect.poll(() => attempts.length).toBe(2);

	expect(attempts[0]?.key).toBeTruthy();
	expect(attempts[1]?.key).toBe(attempts[0]?.key);
	expect(attempts[0]?.body).toMatchObject({
		recurringExpenseId: 'recurring-rent',
		expectedRecurringNextDueAt,
	});
	expect(attempts[1]?.body).toEqual(attempts[0]?.body);
});

test('recurring template retries keep separate keys when requests are interleaved', async ({
	page,
}) => {
	await setupMember(page);
	await mockReads(page, [
		recurringExpense({ id: 'recurring-rent', description: 'Miete' }),
		recurringExpense({ id: 'recurring-internet', description: 'Internet' }),
	]);
	const attempts: RequestAttempt[] = [];
	const releaseResponses: Array<() => void> = [];
	await page.route(`**${API}/expenses`, async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		attempts.push(recordAttempt(route));
		await new Promise<void>((resolve) => releaseResponses.push(resolve));
		return route.fulfill({ status: 500, json: { error: 'temporarily_unavailable' } });
	});

	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/ausgaben?filter=recurring`);
	await dismissOnboarding(page);
	const rent = page.getByRole('button', { name: 'Erfassen: Miete' });
	const internet = page.getByRole('button', {
		name: 'Erfassen: Internet',
	});
	try {
		for (const [index, button] of [rent, internet, rent].entries()) {
			// Keep WebKit's smooth scrolling from moving the target during the click.
			await button.evaluate((element) =>
				element.scrollIntoView({ block: 'center', behavior: 'instant' }),
			);
			await button.click();
			await expect.poll(() => attempts.length).toBe(index + 1);
			await expect(rent).toBeDisabled();
			await expect(internet).toBeDisabled();
			releaseResponses[index]?.();
			await expect(rent).toBeEnabled();
			await expect(internet).toBeEnabled();
		}
	} finally {
		for (const release of releaseResponses) release();
	}

	expect(attempts[0]?.key).toBeTruthy();
	expect(attempts[1]?.key).not.toBe(attempts[0]?.key);
	expect(attempts[2]?.key).toBe(attempts[0]?.key);
	expect(attempts[2]?.body).toEqual(attempts[0]?.body);
});

test('recurring expense retry keeps its key until template advance succeeds', async ({ page }) => {
	await setupMember(page);
	let serverCommitted = false;
	const committedExpense = expense('committed-recurring-expense', 'Miete');
	await mockReads(page, [recurringExpense()], () => (serverCommitted ? [committedExpense] : []));
	const attempts: RequestAttempt[] = [];
	let advanceAttempts = 0;
	await page.route(`**${API}/recurring-expenses`, async (route) => {
		if (route.request().method() !== 'PATCH') return route.fallback();
		advanceAttempts += 1;
		if (advanceAttempts === 1) {
			return route.fulfill({ status: 500, json: { error: 'temporarily_unavailable' } });
		}
		return route.fulfill({
			json: { recurringExpense: recurringExpense({ nextDueAt: '2026-10-01T00:00:00.000Z' }) },
		});
	});
	await page.route(`**${API}/expenses`, async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		attempts.push(recordAttempt(route));
		serverCommitted = true;
		return route.fulfill({ json: { expense: committedExpense, warning: null } });
	});

	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/ausgaben?filter=recurring`);
	await dismissOnboarding(page);
	const create = page.getByRole('button', { name: 'Erfassen: Miete' });
	await create.click();
	await expect.poll(() => attempts.length).toBe(1);
	await expect.poll(() => advanceAttempts).toBe(1);
	await expect(create).toBeEnabled();
	await create.click();
	await expect.poll(() => attempts.length).toBe(2);
	await expect.poll(() => advanceAttempts).toBe(2);

	expect(attempts[0]?.key).toBeTruthy();
	expect(attempts[1]?.key).toBe(attempts[0]?.key);
	await expect(page.locator('#expense-committed-recurring-expense')).toHaveCount(1);
});

test('an already-advanced period gets a new key and due date on the next create', async ({
	page,
}) => {
	await setupMember(page);
	const originalDueAt = '2026-09-01T00:00:00.000Z';
	const advancedDueAt = '2026-09-24T00:00:00.000Z';
	let currentTemplate = recurringExpense({ nextDueAt: originalDueAt });
	let serverCommitted = false;
	let refreshedAdvancedTemplate = false;
	await mockReads(
		page,
		[currentTemplate],
		() => (serverCommitted ? [expense('prior-period-expense', 'Miete')] : []),
		() => {
			if (currentTemplate.nextDueAt === advancedDueAt) refreshedAdvancedTemplate = true;
			return [currentTemplate];
		},
	);
	const postAttempts: RequestAttempt[] = [];
	const advanceAttempts: RequestAttempt[] = [];
	await page.route(`**${API}/recurring-expenses`, async (route) => {
		if (route.request().method() !== 'PATCH') return route.fallback();
		advanceAttempts.push(recordAttempt(route));
		if (advanceAttempts.length === 1) {
			currentTemplate = recurringExpense({ nextDueAt: advancedDueAt });
			return route.fulfill({
				status: 409,
				json: { error: 'recurring_expense_already_advanced' },
			});
		}
		currentTemplate = recurringExpense({ nextDueAt: '2026-10-24T00:00:00.000Z' });
		return route.fulfill({ json: { recurringExpense: currentTemplate } });
	});
	await page.route(`**${API}/expenses`, async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		postAttempts.push(recordAttempt(route));
		serverCommitted = true;
		return route.fulfill({
			json: {
				expense: expense(`recurring-period-${postAttempts.length}`, 'Miete'),
				warning: null,
			},
		});
	});

	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/ausgaben?filter=recurring`);
	await dismissOnboarding(page);
	const create = page.getByRole('button', { name: 'Erfassen: Miete' });
	await create.click();
	await expect.poll(() => postAttempts.length).toBe(1);
	await expect.poll(() => advanceAttempts.length).toBe(1);
	await expect.poll(() => refreshedAdvancedTemplate).toBe(true);
	await expect(create).toBeEnabled();
	await create.click();
	await expect.poll(() => postAttempts.length).toBe(2);

	expect(postAttempts[0]?.key).toBeTruthy();
	expect(postAttempts[1]?.key).not.toBe(postAttempts[0]?.key);
	expect(postAttempts[0]?.body).toMatchObject({
		recurringExpenseId: 'recurring-rent',
		expectedRecurringNextDueAt: originalDueAt,
	});
	expect(postAttempts[1]?.body).toMatchObject({
		recurringExpenseId: 'recurring-rent',
		expectedRecurringNextDueAt: advancedDueAt,
	});
});

test('an accepted offline recurring expense is not queued again after reload', async ({ page }) => {
	await setupMember(page);
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
	});
	await mockReads(page, [recurringExpense()]);
	await page.route(`**${API}/expenses`, async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		return route.abort();
	});

	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/ausgaben?filter=recurring`);
	await dismissOnboarding(page);
	await page.getByRole('button', { name: 'Erfassen: Miete' }).click();
	await expect(page.getByText(/Fixkosten-Ausgabe offline vorgemerkt/)).toBeVisible();
	await expect.poll(() => queuedRecurringExpenseCount(page)).toBe(1);

	// A fresh page in the same context preserves localStorage without the
	// setupMember init script that intentionally clears the queue on reload.
	const reloadedPage = await page.context().newPage();
	await reloadedPage.addInitScript(() => {
		Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
	});
	await mockReads(reloadedPage, [recurringExpense()]);
	let replayEnabled = false;
	const replayAttempts: RequestAttempt[] = [];
	await reloadedPage.route(`**${API}/expenses`, async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		if (!replayEnabled) return route.abort();
		replayAttempts.push(recordAttempt(route));
		return route.fulfill({
			json: { expense: expense('synced-recurring-expense', 'Miete'), warning: null },
		});
	});
	await reloadedPage.goto(`/wg/${FIXTURE_WG.shareCode}/ausgaben?filter=recurring`);
	await dismissOnboarding(reloadedPage);
	await expect.poll(() => queuedRecurringExpenseCount(reloadedPage)).toBe(1);
	const create = reloadedPage.getByRole('button', {
		name: 'Erfassen: Miete',
	});
	await expect(create).toBeVisible();
	await create.click();
	await expect.poll(() => queuedRecurringExpenseCount(reloadedPage)).toBe(1);

	replayEnabled = true;
	await sendQueueIfStillPending(reloadedPage, () => queuedRecurringExpenseCount(reloadedPage));
	await expect.poll(() => replayAttempts.length).toBe(1);
	await expect.poll(() => queuedRecurringExpenseCount(reloadedPage)).toBe(0);
	expect(replayAttempts[0]?.key).toBeTruthy();
	expect(replayAttempts[0]?.body).toMatchObject({
		recurringExpenseId: 'recurring-rent',
		expectedRecurringNextDueAt: '2020-01-01T00:00:00.000Z',
	});
});
