import { expect, test } from '@playwright/test';
import { dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

const BASE = '/api/wg/MTE8PZAT';

function mockDashboard(page: import('@playwright/test').Page, value: unknown) {
	return page.route(`**${BASE}/dashboard`, (route) => route.fulfill({ status: 200, json: value }));
}

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
	await mockDashboard(page, {
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
	await expect(exchange.getByRole('link', { name: 'Chat, Zähler nicht verfügbar' })).toBeVisible();
});

test('hides confirmed zero visually and keeps its meaning accessible', async ({ page }) => {
	await setupMember(page);
	await mockDashboard(page, {
		openShoppingCount: 0,
		dueChores: [],
		dueRecurringExpenses: [],
	});
	await page.route(`**${BASE}/chat/unread-count`, (route) =>
		route.fulfill({ status: 200, json: { count: 0, overflow: false } }),
	);

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
	await mockDashboard(page, {
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
	await page.route(`**${BASE}/chat/unread-count`, (route) =>
		route.fulfill({ status: 200, json: { count: 0, overflow: false } }),
	);

	await navigateToFeature(page, '/wg/MTE8PZAT/vorraete');
	await dismissOnboarding(page);

	const household = page.getByRole('navigation', { name: 'Haushalt' });
	const shopping = household.getByRole('link', { name: 'Einkäufe, 123 offen' });
	await expect(shopping).toBeVisible();
	await expect(shopping).toHaveText('Einkäufe99+');
	await expect(household.getByRole('link', { name: 'Putzplan, 1 für dich fällig' })).toBeVisible();
});

test('keeps unread count after a failed chat read acknowledgement', async ({ page }) => {
	await setupMember(page);
	await mockDashboard(page, {
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

test('marks cached counts stale when the refresh fails', async ({ page }) => {
	await setupMember(page);
	await mockDashboard(page, {
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
	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
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
