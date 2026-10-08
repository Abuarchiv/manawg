// Expense create retries: key reuse for identical payloads and ambiguous acknowledgements.
// Why: ambiguous network failures must reuse the original key so a retry can never book an expense twice.

import { expect, test } from '@playwright/test';
import {
	API,
	type RequestAttempt,
	expectOfflineAutoSyncBackoff,
	expense,
	mockReads,
	queuedActionCount,
	recordAttempt,
	sendQueueIfStillPending,
} from './support/expense-idempotency';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './support/helpers';

test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

function normalizeExpenseCreateBody(body: unknown): unknown {
	if (typeof body !== 'object' || body === null || Array.isArray(body)) return body;
	const payload = body as Record<string, unknown>;
	// The expense API accepts missing or null imageUrl and stores both as null.
	return { ...payload, imageUrl: payload.imageUrl ?? null };
}

test('expense retries keep the key for the same payload and change it when the payload changes', async ({
	page,
}) => {
	await setupMember(page);
	let serverCommitted = false;
	await mockReads(page, [], () =>
		serverCommitted ? [expense('committed-expense', 'Wocheneinkauf')] : [],
	);
	const attempts: RequestAttempt[] = [];
	await page.route(`**${API}/expenses`, async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		attempts.push(recordAttempt(route));
		if (attempts.length === 1) serverCommitted = true;
		if (attempts.length < 3) {
			return route.fulfill({ status: 500, json: { error: 'temporarily_unavailable' } });
		}
		return route.fulfill({
			json: { expense: expense('created-expense', 'Neue Beschreibung'), warning: null },
		});
	});

	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/ausgaben?new=1`);
	await dismissOnboarding(page);
	const form = page.getByRole('dialog');
	await form.getByLabel('Beschreibung').fill('Wocheneinkauf');
	await form.getByLabel('Betrag').fill('12,35');
	const submit = form.getByRole('button', { name: 'Ausgabe speichern' });

	await submit.click();
	await expect.poll(() => attempts.length).toBe(1);
	await expect(form).toBeVisible();
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	await expect(page.getByText('1 Eintrag', { exact: true })).toBeVisible();
	await submit.click();
	await expect.poll(() => attempts.length).toBe(2);
	await expect(form).toBeVisible();
	await form.getByLabel('Beschreibung').fill('Neue Beschreibung');
	await submit.click();
	await expect.poll(() => attempts.length).toBe(3);

	expect(attempts[0]?.key).toBeTruthy();
	expect(attempts[1]?.key).toBe(attempts[0]?.key);
	expect(attempts[1]?.body).toEqual(attempts[0]?.body);
	expect(attempts[0]?.body).not.toHaveProperty('recurringExpenseId');
	expect(attempts[0]?.body).not.toHaveProperty('expectedRecurringNextDueAt');
	expect(attempts[2]?.key).not.toBe(attempts[1]?.key);
});

test('an ambiguously acknowledged expense replays its queued request with the original key', async ({
	page,
}) => {
	await setupMember(page);
	let committedExpense: ReturnType<typeof expense> | null = null;
	await mockReads(page, [], () => (committedExpense ? [committedExpense] : []));
	const attempts: RequestAttempt[] = [];
	await page.route(`**${API}/expenses`, async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		const attempt = recordAttempt(route);
		attempts.push(attempt);
		if (!committedExpense) {
			committedExpense = expense('created-expense', 'Wocheneinkauf');
			await page.evaluate(() => {
				Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
			});
			return route.fulfill({
				status: 200,
				headers: { 'content-type': 'application/json' },
				body: '{"expense":',
			});
		}
		return route.fulfill({ json: { expense: committedExpense, warning: null } });
	});

	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/ausgaben?new=1`);
	await dismissOnboarding(page);
	const form = page.getByRole('dialog');
	await form.getByLabel('Beschreibung').fill('Wocheneinkauf');
	await form.getByLabel('Betrag').fill('12,35');
	await form.getByRole('button', { name: 'Ausgabe speichern' }).click();
	await expect.poll(() => attempts.length).toBe(1);
	await expect(form).toBeHidden();
	await expect.poll(() => queuedActionCount(page, 'expense.create')).toBe(1);

	const replayPage = await page.context().newPage();
	await replayPage.addInitScript(() => {
		Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
	});
	await mockReads(replayPage, [], () => (committedExpense ? [committedExpense] : []));
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
				expense: committedExpense ?? expense('created-expense', 'Wocheneinkauf'),
				warning: null,
			},
		});
	});
	await replayPage.goto(`/wg/${FIXTURE_WG.shareCode}/ausgaben`);
	await dismissOnboarding(replayPage);
	await expect.poll(() => queuedActionCount(replayPage, 'expense.create')).toBe(1);
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
	await sendQueueIfStillPending(replayPage, () => queuedActionCount(replayPage, 'expense.create'));
	await expect.poll(() => attempts.length).toBe(2);
	await expect.poll(() => queuedActionCount(replayPage, 'expense.create')).toBe(0);
	expect(attempts).toHaveLength(2);

	expect(attempts[0]?.key).toBeTruthy();
	expect(attempts[1]?.key).toBe(attempts[0]?.key);
	expect(normalizeExpenseCreateBody(attempts[1]?.body)).toEqual(
		normalizeExpenseCreateBody(attempts[0]?.body),
	);
});

test('discarding an ambiguous expense starts a new request key for identical form data', async ({
	page,
}) => {
	await setupMember(page);
	await mockReads(page);
	const attempts: RequestAttempt[] = [];
	await page.route(`**${API}/expenses`, async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		attempts.push(recordAttempt(route));
		if (attempts.length === 1) {
			return route.fulfill({ status: 500, json: { error: 'temporarily_unavailable' } });
		}
		return route.fulfill({
			json: { expense: expense('new-expense', 'Wocheneinkauf'), warning: null },
		});
	});

	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/ausgaben?new=1`);
	await dismissOnboarding(page);
	const form = page.getByRole('dialog');
	await form.getByLabel('Beschreibung').fill('Wocheneinkauf');
	await form.getByLabel('Betrag').fill('12,35');
	await form.getByRole('button', { name: 'Ausgabe speichern' }).click();
	await expect.poll(() => attempts.length).toBe(1);
	await form.getByRole('button', { name: 'Ausgabe abbrechen' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Entwurf verwerfen' }).click();
	await expect(form).toBeHidden();
	await page
		.locator('[data-page-primary-action]')
		.getByRole('button', { name: 'Ausgabe hinzufügen' })
		.click();

	const newForm = page.getByRole('dialog');
	await newForm.getByLabel('Beschreibung').fill('Wocheneinkauf');
	await newForm.getByLabel('Betrag').fill('12,35');
	await newForm.getByRole('button', { name: 'Ausgabe speichern' }).click();
	await expect.poll(() => attempts.length).toBe(2);

	expect(attempts[0]?.key).toBeTruthy();
	expect(attempts[1]?.key).not.toBe(attempts[0]?.key);
});
