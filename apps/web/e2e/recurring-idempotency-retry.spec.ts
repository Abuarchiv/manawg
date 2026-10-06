// Recurring template create retries and idempotency keys: retries keep their key, due date and
// splits across refreshed data, split rotation, draft restore and interleaved requests.

import { expect, test } from '@playwright/test';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';
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
} from './support/expense-retry';

test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

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
	// The draft does not open the form on its own; „Ausgabe hinzufügen“ reveals it.
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
	const rent = page.getByRole('button', { name: 'Fixkosten-Ausgabe direkt erstellen: Miete' });
	const internet = page.getByRole('button', {
		name: 'Fixkosten-Ausgabe direkt erstellen: Internet',
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
