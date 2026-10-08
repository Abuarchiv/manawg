// Shared fixtures and queue helpers for the expense idempotency retry specs.

import { type Page, type Route, expect } from '@playwright/test';
import { FIXTURE_WG } from './helpers';

export const API = `/api/wg/${FIXTURE_WG.shareCode}`;

const createdAt = '2026-09-25T10:00:00.000Z';

export function expense(id: string, description: string) {
	return {
		id,
		paidByMemberId: FIXTURE_WG.memberId,
		amountCents: 1234,
		currency: 'EUR',
		description,
		imageUrl: null,
		occurredAt: createdAt,
		createdAt,
		updatedAt: createdAt,
		splits: [],
	};
}

export function recurringExpense(
	overrides: Partial<{
		id: string;
		description: string;
		amountCents: number;
		nextDueAt: string;
	}> = {},
) {
	const splits: Array<{ debtorMemberId: string; amountCents: number }> = [
		{ debtorMemberId: FIXTURE_WG.memberId, amountCents: 1234 },
	];
	return {
		id: 'recurring-rent',
		description: 'Miete',
		amountCents: 1234,
		currency: 'EUR',
		paidByMemberId: FIXTURE_WG.memberId,
		intervalMonths: 1,
		nextDueAt: '2020-01-01T00:00:00.000Z',
		lastCreatedAt: null,
		splits,
		...overrides,
	};
}

export type RequestAttempt = { key: string | null; body: unknown };

export async function mockReads(
	page: Page,
	recurring: ReturnType<typeof recurringExpense>[] = [],
	readExpenses: () => ReturnType<typeof expense>[] = () => [],
	readRecurring: () => ReturnType<typeof recurringExpense>[] = () => recurring,
): Promise<void> {
	await page.route(`**${API}/expenses`, async (route) => {
		if (route.request().method() === 'GET') {
			return route.fulfill({ json: { expenses: readExpenses(), payments: [] } });
		}
		return route.fallback();
	});
	await page.route(`**${API}/recurring-expenses`, async (route) => {
		if (route.request().method() === 'GET') {
			return route.fulfill({ json: { recurringExpenses: readRecurring() } });
		}
		if (route.request().method() === 'PATCH') {
			return route.fulfill({
				json: {
					recurringExpense: recurringExpense({ nextDueAt: '2026-10-01T00:00:00.000Z' }),
				},
			});
		}
		return route.fallback();
	});
}

export function recordAttempt(route: Route): RequestAttempt {
	const request = route.request();
	return {
		key: request.headers()['idempotency-key'] ?? null,
		body: request.postDataJSON(),
	};
}

export async function queuedActionCount(page: Page, type: string): Promise<number> {
	return page.evaluate((actionType) => {
		const queue = JSON.parse(localStorage.getItem('manawg:offline-actions') ?? '[]');
		return queue.filter((action: { type?: string }) => action.type === actionType).length;
	}, type);
}

const OFFLINE_RETRY_ERROR =
	'Noch keine Verbindung: Die Aktion bleibt gespeichert und wird erneut versucht, sobald das Netz zurück ist.';

type QueuedRetryState = {
	idempotencyKey: string | null;
	attempts: number;
	lastAttemptAt: string | null;
	lastError: string | null;
};

async function queuedRetryState(page: Page, type: string): Promise<QueuedRetryState | null> {
	return page.evaluate((actionType) => {
		const queue = JSON.parse(localStorage.getItem('manawg:offline-actions') ?? '[]');
		const action = queue.find((entry: { type?: string }) => entry.type === actionType);
		if (!action) return null;
		return {
			idempotencyKey: action.idempotencyKey ?? null,
			attempts: action.attempts ?? 0,
			lastAttemptAt: action.lastAttemptAt ?? null,
			lastError: action.lastError ?? null,
		};
	}, type);
}

export async function expectOfflineAutoSyncBackoff(
	page: Page,
	type: string,
	blockedAttempts: RequestAttempt[],
	originalKey: string | null,
): Promise<void> {
	await expect.poll(() => blockedAttempts.length).toBeGreaterThan(0);
	await expect
		.poll(async () => {
			const state = await queuedRetryState(page, type);
			return Boolean(
				state &&
					state.idempotencyKey === originalKey &&
					state.attempts > 0 &&
					state.lastAttemptAt &&
					state.lastError === OFFLINE_RETRY_ERROR,
			);
		})
		.toBe(true);
	expect(blockedAttempts.every((attempt) => attempt.key === originalKey)).toBe(true);
}

export async function sendQueueIfStillPending(
	page: Page,
	countQueued: () => Promise<number>,
): Promise<void> {
	const sendButton = page.getByRole('button', { name: 'Offline-Aktionen jetzt senden' }).first();
	await page.evaluate(() => {
		Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
		window.dispatchEvent(new Event('online'));
	});
	await expect
		.poll(async () => (await countQueued()) === 0 || sendButton.isVisible().catch(() => false))
		.toBe(true);
	if ((await countQueued()) > 0) {
		await expect(sendButton).toBeVisible();
		await sendButton.click();
	}
}
