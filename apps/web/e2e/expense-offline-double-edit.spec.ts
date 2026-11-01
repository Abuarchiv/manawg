// Two offline edits of the same expense reach the server as one PATCH.
// Why: a second queued edit carrying the client-side version would be rejected with a 409.

import { expect, test } from '@playwright/test';
import { API, expense, mockReads, queuedActionCount } from './support/expense-idempotency';
import {
	dismissOnboarding,
	FIXTURE_WG,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

skipUnlessFixtures();

test('a second offline edit replaces the queued update and replays once', async ({
	page,
	context,
}) => {
	const { memberId, memberName, shareCode } = FIXTURE_WG;
	const original = {
		...expense('offline-double-edit', 'Einkauf'),
		category: 'other',
		splits: [{ id: 's1', debtorMemberId: memberId, amountCents: 1234, settledAt: null }],
	};
	await setupMember(page);
	await page.route(`**/api/wg/${shareCode}/members`, (route) =>
		route.fulfill({
			json: {
				members: [{ id: memberId, name: memberName, color: null, active: true }],
				viewerIsAdmin: false,
			},
		}),
	);
	await mockReads(page, [], () => [original as unknown as ReturnType<typeof expense>]);
	// Offline, requests fail like real ones; the optimistic rows stay on screen.
	let offline = false;
	await page.route(`**${API}/expenses`, (route) =>
		offline && route.request().method() === 'GET' ? route.abort() : route.fallback(),
	);
	const patches: Array<{ description: string; expectedUpdatedAt: string }> = [];
	await page.route(`**${API}/expenses/${original.id}`, (route) => {
		if (route.request().method() !== 'PATCH') return route.fallback();
		if (offline) return route.abort();
		const body = route.request().postDataJSON();
		patches.push(body);
		if (body.expectedUpdatedAt !== original.updatedAt) {
			return route.fulfill({ status: 409, json: { error: 'expense_changed' } });
		}
		return route.fulfill({ json: { expense: { ...original, description: body.description } } });
	});
	await page.route(`**/api/wg/${shareCode}/dashboard`, (route) =>
		route.fulfill({ json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] } }),
	);
	await navigateToFeature(page, `/wg/${shareCode}/expenses`);
	await dismissOnboarding(page);

	offline = true;
	await context.setOffline(true);
	let current = original.description;
	for (const next of ['Einkauf A', 'Einkauf B']) {
		await page.getByRole('button', { name: `Aktionen für ${current}` }).click();
		await page.getByRole('menuitem', { name: 'Bearbeiten', exact: true }).click();
		const form = page.getByRole('dialog');
		await form.getByLabel('Beschreibung').fill(next);
		await form.getByRole('button', { name: 'Ausgabe speichern', exact: true }).click();
		await expect(form).toBeHidden();
		current = next;
	}
	expect(await queuedActionCount(page, 'expense.update')).toBe(1);

	offline = false;
	await context.setOffline(false);
	await page.evaluate(() => window.dispatchEvent(new Event('online')));
	await expect.poll(() => patches.length).toBe(1);
	expect(patches[0]).toMatchObject({
		description: 'Einkauf B',
		expectedUpdatedAt: original.updatedAt,
	});
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('manawg:offline-actions')))
		.toMatch(/^(\[\])?$|^null$/);
});
