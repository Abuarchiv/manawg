// English offline: the offline page and the offline queue in the data settings.
// Why: These screens are the fallback when the connection fails; a German string here breaks the calm.

import { type Page, type Route, expect, test } from '@playwright/test';
import {
	FIXTURE_WG,
	dismissOnboarding,
	navigateToFeature,
	seedLocalAccount,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';
import { expectNoGermanChrome, expectNoHorizontalOverflow, setEnglishLocale } from './support/i18n';

const SCHEMES = ['light', 'dark'] as const;
const WIDTHS = [320, 390] as const;
const HOUR_MS = 60 * 60 * 1000;
const KNOWN_WG = {
	code: FIXTURE_WG.shareCode,
	name: 'Fixture flat',
	lastVisitedAt: 1_758_272_400_000,
};

let nextKey = 1;

function queued(
	type: string,
	payload: Record<string, unknown>,
	extra: Record<string, unknown> = {},
) {
	const id = nextKey++;
	return {
		id: `${type}:${FIXTURE_WG.shareCode}:l-${id}`,
		idempotencyKey: `${String(id).padStart(8, '0')}-1111-4111-8111-111111111111`,
		type,
		wgId: FIXTURE_WG.id,
		shareCode: FIXTURE_WG.shareCode,
		memberId: FIXTURE_WG.memberId,
		createdAt: new Date().toISOString(),
		payload,
		...extra,
	};
}

const NO_CONNECTION = {
	attempts: 1,
	lastAttemptAt: new Date().toISOString(),
	lastError:
		'Noch keine Verbindung: Die Aktion bleibt gespeichert und wird erneut versucht, sobald das Netz zurück ist.',
	lastErrorMessage: {
		key: 'common.errors.withSubject',
		values: {
			subject: { key: 'offline.failure.noConnection.title' },
			detail: { key: 'offline.failure.noConnection.detail' },
		},
	},
	noConnection: true,
};

const SERVER_CHECK = {
	attempts: 1,
	lastAttemptAt: new Date().toISOString(),
	lastError: 'Server prüfen: 404:chore_not_found',
	lastErrorMessage: {
		key: 'offline.state.serverCheck',
		values: {
			title: { key: 'offline.failure.choreMissing.title' },
			detail: { key: 'offline.failure.choreMissing.detail' },
		},
	},
	needsReview: 'server',
};

async function mockMembership(page: Page, status = 200): Promise<void> {
	await page.route('**/api/wg/mine', (route: Route) =>
		route.fulfill({
			status,
			contentType: 'application/json',
			body: JSON.stringify(
				status === 200
					? {
							wgs: [
								{
									id: FIXTURE_WG.id,
									code: FIXTURE_WG.shareCode,
									name: KNOWN_WG.name,
									memberId: FIXTURE_WG.memberId,
								},
							],
						}
					: { error: 'auth_required', code: 'auth_required' },
			),
		}),
	);
}

async function seedState(page: Page, actions: unknown[]): Promise<void> {
	await setupMember(page);
	await seedLocalAccount(page);
	await page.addInitScript(
		({ wg, stored }) => {
			localStorage.setItem('manawg_known_wgs', JSON.stringify([wg]));
			localStorage.setItem('manawg:offline-actions', JSON.stringify(stored));
		},
		{ wg: KNOWN_WG, stored: actions },
	);
}

async function expectEnglishPage(page: Page, width: number): Promise<void> {
	await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
	await expectNoGermanChrome(page);
	if (width === 320) await expectNoHorizontalOverflow(page);
}

test.describe('offline page in English', () => {
	skipUnlessFixtures();

	for (const colorScheme of SCHEMES) {
		for (const width of WIDTHS) {
			test(`queue, errors and flats render English at ${width}px (${colorScheme})`, async ({
				context,
				page,
				baseURL,
			}) => {
				test.setTimeout(180_000);
				await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
				await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
				await page.setViewportSize({ width, height: 780 });
				await mockMembership(page);
				await seedState(page, [
					queued('shopping.create', { name: 'Oat milk', quantity: '1' }),
					queued('absence.create', {
						memberId: FIXTURE_WG.memberId,
						startDate: '2026-11-01',
						endDate: '2026-11-03',
						reason: null,
					}),
					queued('announcement.create', {
						content: 'Boiler repaired',
						kind: 'info',
						imageUrl: null,
					}),
					queued(
						'shopping.update',
						{ itemId: 'item-1', name: 'Bread', bought: true },
						NO_CONNECTION,
					),
					queued('chore.complete', { choreId: 'chore-1' }, SERVER_CHECK),
					queued('chore.create', {
						title: 'Mop the hall',
						intervalDays: 7,
						assignedMemberId: null,
					}),
				]);

				await navigateToFeature(page, '/offline');
				await expect(page).toHaveTitle('Offline — ManaWG');
				await expect(page.getByRole('heading', { name: 'You are connected again.' })).toBeVisible({
					timeout: 60_000,
				});
				await expect(page.getByText('Back online', { exact: true })).toBeVisible();
				await expect(page.getByRole('heading', { name: 'Queue', level: 2 })).toBeVisible();
				await expect(page.getByText('6 actions waiting.')).toBeVisible();
				await expect(page.getByText('Cleaning rota task', { exact: true })).toBeVisible();
				await expect(page.getByText('Mop the hall')).toBeVisible();
				await expect(page.getByText('Mark task as done')).toBeVisible();
				await expect(page.getByText('Tick off Bread')).toBeVisible();
				await expect(
					page.getByText(
						'No connection yet: The action stays saved and is tried again when the network is back.',
					),
				).toBeVisible();
				await expect(
					page.getByText(
						'Needs a check. Cleaning rota task missing: The task no longer exists. Remove this offline action or add the task again.',
					),
				).toBeVisible();
				await expect(page.getByText('+2 more actions in the queue.')).toBeVisible();
				await expect(page.getByRole('link', { name: 'Check all actions' })).toBeVisible();
				await expect(page.getByText('just now').first()).toBeVisible();
				await expect(page.getByRole('button', { name: 'Sync offline actions now' })).toBeVisible();
				await expect(
					page.getByRole('button', { name: 'Check offline status again' }),
				).toBeVisible();
				await expect(page.getByRole('link', { name: 'Back to Fixture flat' })).toBeVisible();
				await expect(page.getByRole('heading', { name: 'Back to your flat' })).toBeVisible();
				await expect(page.getByRole('link', { name: 'Enter code' })).toBeVisible();
				await expectEnglishPage(page, width);
			});
		}
	}

	test('offline, signed-out and unreachable states render English', async ({
		context,
		page,
		baseURL,
	}) => {
		test.setTimeout(180_000);
		await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
		await page.setViewportSize({ width: 320, height: 780 });
		await mockMembership(page);
		await seedState(page, []);
		await navigateToFeature(page, '/offline');
		await expect(page.getByRole('heading', { name: 'You are connected again.' })).toBeVisible({
			timeout: 60_000,
		});
		await expect(
			page.getByText('Your connection is back. Sync waiting actions or go back to your flat.'),
		).toBeVisible();

		await page.unroute('**/api/wg/mine');
		await context.setOffline(true);
		await page.evaluate(() => window.dispatchEvent(new Event('offline')));
		await expect(page.getByRole('heading', { name: 'You are offline right now.' })).toBeVisible();
		await expect(page.getByText('Offline mode', { exact: true })).toBeVisible();
		await expect(
			page.getByText(
				'Your locally saved actions stay visible. Once you are back online, you can sync them.',
			),
		).toBeVisible();
		await expect(page.getByText('Your flat opens once you are back online.')).toBeVisible();
		await expect(page.getByText('Reload the page once you are online.')).toBeVisible();
		await expectEnglishPage(page, 320);
	});

	test('a signed-out visitor and an unreachable server see English', async ({
		context,
		page,
		baseURL,
	}) => {
		test.setTimeout(180_000);
		await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
		await page.setViewportSize({ width: 320, height: 780 });
		await mockMembership(page, 401);
		await seedState(page, [queued('shopping.create', { name: 'Oat milk', quantity: null })]);
		await navigateToFeature(page, '/offline');
		await expect(
			page.getByRole('heading', { name: 'Sign in to see your offline actions.' }),
		).toBeVisible({ timeout: 60_000 });
		await expect(
			page.getByText('After you sign in, you will see your waiting actions.'),
		).toBeVisible();
		await expect(page.getByText('Sign-in needed', { exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
		await expectEnglishPage(page, 320);

		await page.unroute('**/api/wg/mine');
		await page.route('**/api/wg/mine', (route) => route.abort());
		await page.reload();
		await expect(
			page.getByRole('heading', { name: 'The server is unreachable right now.' }),
		).toBeVisible({ timeout: 60_000 });
		await expect(page.getByText('Server unreachable', { exact: true })).toBeVisible();
		await expect(page.getByText('Shopping stays saved on this device.')).toBeVisible();
		await expectEnglishPage(page, 320);
	});

	test('a manual sync reports its result and holds a rejected action for review', async ({
		context,
		page,
		baseURL,
	}) => {
		test.setTimeout(180_000);
		await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
		await page.setViewportSize({ width: 390, height: 780 });
		await mockMembership(page);
		let posts = 0;
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/shopping`, (route) => {
			posts += 1;
			return posts === 1
				? route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
				: route.fulfill({
						status: 404,
						contentType: 'application/json',
						body: JSON.stringify({ error: 'item_not_found' }),
					});
		});
		await seedState(page, [
			queued('shopping.create', { name: 'Oat milk', quantity: null }),
			queued('shopping.create', { name: 'Bread', quantity: null }),
		]);
		await navigateToFeature(page, '/offline');
		await page.getByRole('button', { name: 'Sync offline actions now' }).click();

		await expect(page.getByRole('status').filter({ hasText: /^1 action synced\./ })).toHaveText(
			'1 action synced. 1 action is still waiting.',
		);
		await expect(
			page.getByText(
				'Needs a check. Shopping item missing: The item no longer exists. Remove this offline action or add the item again.',
			),
		).toBeVisible();
		await expect(page.getByText('1 action waiting.').first()).toBeVisible();
		await expectEnglishPage(page, 390);
	});
});

test.describe('offline queue in the data settings in English', () => {
	skipUnlessFixtures();

	for (const colorScheme of SCHEMES) {
		for (const width of WIDTHS) {
			test(`items, comparison and discard render English at ${width}px (${colorScheme})`, async ({
				context,
				page,
				baseURL,
			}) => {
				test.setTimeout(180_000);
				await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
				await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
				await page.setViewportSize({ width, height: 780 });
				await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/shopping`, (route) =>
					route.request().method() === 'GET'
						? route.fulfill({
								json: {
									items: [{ id: 'server-1', name: 'Oat milk', quantity: null, boughtAt: null }],
								},
							})
						: route.abort(),
				);
				await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/recurring-expenses`, (route) =>
					route.request().method() === 'GET'
						? route.fulfill({
								json: {
									recurringExpenses: [{ id: 'rec-1', nextDueAt: '2026-12-05T08:00:00.000Z' }],
								},
							})
						: route.abort(),
				);
				await seedState(page, [
					queued('shopping.create', { name: 'Oat milk', quantity: '1' }, NO_CONNECTION),
					queued(
						'announcement.create',
						{ content: 'Boiler repaired', kind: 'info', imageUrl: null },
						SERVER_CHECK,
					),
					queued(
						'recurring.advance',
						{ recurringExpenseId: 'rec-1', expectedRecurringNextDueAt: '2026-11-05T08:00:00.000Z' },
						{ createdAt: new Date(Date.now() - 8 * HOUR_MS).toISOString() },
					),
				]);

				await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#daten`);
				await dismissOnboarding(page);
				const section = page.getByRole('region', { name: 'Offline queue' });
				await expect(section).toBeVisible({ timeout: 60_000 });
				await expect(section.getByText('3 actions waiting.')).toBeVisible();
				await expect(
					section.getByRole('button', { name: 'Sync offline queue again' }),
				).toBeVisible();
				await expect(section.getByText('1x').first()).toBeVisible();
				await expect(
					section.getByText(
						'Needs a check. Cleaning rota task missing: The task no longer exists. Remove this offline action or add the task again.',
					),
				).toBeVisible();
				await expect(
					section.getByText(
						'Check fixed costs: Check whether the template has already been advanced.',
					),
				).toBeVisible();
				await expect(
					section.getByRole('link', { name: 'Check flat entry: Boiler repaired' }),
				).toBeVisible();

				await section.getByRole('button', { name: 'Compare with server: Oat milk' }).click();
				await expect(
					section.getByText(
						'A similar shopping item already exists. It is open there. Check before sending whether this would be a duplicate.',
					),
				).toBeVisible();
				await section
					.getByRole('button', { name: 'Compare with server: Catch up the due date' })
					.click();
				await expect(
					section.getByText(
						'The server template is now on 5 December 2026 instead of 5 November 2026. Check before sending whether the due date has already been caught up.',
					),
				).toBeVisible();
				await expect(
					section.getByRole('button', { name: 'Edit offline action: Oat milk' }),
				).toBeVisible();

				await section.getByRole('button', { name: 'Discard offline action: Oat milk' }).click();
				const dialog = page.getByRole('alertdialog', { name: 'Discard offline action?' });
				await expect(dialog).toBeVisible();
				await expect(
					dialog.getByText(
						'“Oat milk” has not been sent yet and cannot be restored once discarded.',
					),
				).toBeVisible();
				await expect(dialog.getByRole('button', { name: 'Keep' })).toBeVisible();
				await expect(dialog.getByRole('button', { name: 'Discard' })).toBeVisible();
				await dialog.getByRole('button', { name: 'Keep' }).click();
				await expect(dialog).toBeHidden();
				await expectEnglishPage(page, width);
			});
		}
	}
});
