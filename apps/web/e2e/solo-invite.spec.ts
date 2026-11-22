// The invitation stays one tap away while nobody else lives in the WG.
// Why: with the invite only on a dismissible Start card, a solo WG would never be asked again.

import { expect, type Page, test } from '@playwright/test';
import { E2E_CREATED_WG, E2E_EXISTING_WG } from '../src/fixtures/data';
import {
	dismissOnboarding,
	EMPTY_DASHBOARD,
	FIXTURE_WG,
	mockDashboard,
	mockUnreadCount,
	navigateToFeature,
	SOLO_WG,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

const SOLO_BASE = `/api/wg/${SOLO_WG.shareCode}`;
const DUO_BASE = `/api/wg/${FIXTURE_WG.shareCode}`;
const SOLO_TEXT = 'Du bist noch allein in der WG.';
const DAY_MS = 86_400_000;
const SOLO_KEY = `manawg:start-welcome-dismissed:${E2E_CREATED_WG.id}:${SOLO_WG.memberId}`;

async function mockEmptyLists(page: Page, base: string): Promise<void> {
	await page.route(`**${base}/expenses*`, (route) =>
		route.fulfill({ json: { expenses: [], payments: [] } }),
	);
	await page.route(`**${base}/shopping*`, (route) => route.fulfill({ json: { items: [] } }));
	await page.route(`**${base}/chores*`, (route) => route.fulfill({ json: { chores: [] } }));
	await mockDashboard(page, base, EMPTY_DASHBOARD);
	await mockUnreadCount(page, base);
}

async function open(page: Page, shareCode: string, path = ''): Promise<void> {
	await navigateToFeature(page, `/wg/${shareCode}${path}`);
	await dismissOnboarding(page);
}

test.describe('solo invite row', () => {
	skipUnlessFixtures();

	test.beforeEach(async ({ page }) => {
		await setupMember(page);
	});

	for (const path of ['/expenses', '/shopping', '/chores']) {
		test(`a solo WG shows the invite on the empty ${path} page`, async ({ page }) => {
			await mockEmptyLists(page, SOLO_BASE);
			await open(page, SOLO_WG.shareCode, path);
			await expect(page.getByText(SOLO_TEXT)).toBeVisible();
			await expect(
				page.getByRole('button', { name: 'Mitbewohner einladen', exact: true }),
			).toBeVisible();
		});

		test(`a WG with flatmates shows no invite on the empty ${path} page`, async ({ page }) => {
			await mockEmptyLists(page, DUO_BASE);
			await open(page, FIXTURE_WG.shareCode, path);
			await expect(page.locator('[data-slot="empty"]')).toBeVisible();
			await expect(page.getByText(SOLO_TEXT)).toHaveCount(0);
		});
	}

	test('a solo WG keeps the invite above a filled expense list', async ({ page }) => {
		await mockEmptyLists(page, SOLO_BASE);
		await open(page, SOLO_WG.shareCode, '/expenses');
		await page.route(`**${SOLO_BASE}/expenses*`, (route) =>
			route.fulfill({
				json: {
					expenses: [
						{
							id: '5f1d6e2a-0f1e-4a53-9a39-0f8a8d6a1b11',
							wgId: E2E_CREATED_WG.id,
							paidByMemberId: SOLO_WG.memberId,
							description: 'Putzmittel',
							category: 'household',
							amountCents: 1250,
							currency: 'EUR',
							createdAt: new Date().toISOString(),
							splits: [],
						},
					],
					payments: [],
				},
			}),
		);
		await page.reload();
		await dismissOnboarding(page);
		await expect(page.getByText('Putzmittel')).toBeVisible();
		await expect(page.getByText(SOLO_TEXT)).toBeVisible();
	});
});

test.describe('Start card', () => {
	skipUnlessFixtures();

	test.beforeEach(async ({ page }) => {
		await setupMember(page);
	});

	test('dismissing while solo snoozes the card for three days', async ({ page }) => {
		await mockEmptyLists(page, SOLO_BASE);
		await open(page, SOLO_WG.shareCode);
		const card = page.getByRole('heading', { name: 'Eure WG ist bereit' });
		await expect(card).toBeVisible();
		await page.getByRole('button', { name: 'Später erinnern' }).click();
		await expect(card).toHaveCount(0);

		const stored = await page.evaluate((key) => localStorage.getItem(key), SOLO_KEY);
		expect(Number(stored)).toBeGreaterThan(Date.now() - 60_000);

		await page.reload();
		await dismissOnboarding(page);
		await expect(page.getByRole('heading', { name: 'Eure WG ist bereit' })).toHaveCount(0);

		// After three days it returns, as does the legacy permanent value.
		for (const value of [String(Date.now() - 4 * DAY_MS), '1']) {
			await page.evaluate(({ key, next }) => localStorage.setItem(key, next), {
				key: SOLO_KEY,
				next: value,
			});
			await page.reload();
			await dismissOnboarding(page);
			await expect(page.getByRole('heading', { name: 'Eure WG ist bereit' })).toBeVisible();
		}
	});

	test('a solo WG whose invite expired gets a working link above the fold', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await page.addInitScript(() => {
			const written: string[] = [];
			(window as unknown as { __copied: string[] }).__copied = written;
			// No Web Share API: the card falls back to copying.
			Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
			Object.defineProperty(navigator, 'clipboard', {
				value: { writeText: async (text: string) => void written.push(text) },
				configurable: true,
			});
		});
		await mockEmptyLists(page, SOLO_BASE);
		const opened = page.waitForRequest(
			(req) => req.method() === 'POST' && req.url().endsWith(`${SOLO_BASE}/invites/current`),
		);
		await open(page, SOLO_WG.shareCode);
		await opened;

		const link = page.locator('[data-invite-card-link]');
		await expect(link).toHaveText(/\/invite\/fixture-invite-token01$/);
		const share = page.getByRole('button', { name: /^Link teilen: Einladung in / });
		await expect(share).toBeInViewport({ ratio: 1 });
		await share.click();
		await expect(page.getByText('Einladungslink kopiert')).toBeAttached();
		const copied = await page.evaluate(
			() => (window as unknown as { __copied: string[] }).__copied,
		);
		const url = (await link.textContent()) ?? '';
		expect(copied).toHaveLength(1);
		expect(copied[0]).toContain(url);

		// The link opens the join page instead of the expired notice.
		await page.goto(new URL(url).pathname);
		await expect(page.getByText(E2E_EXISTING_WG.name).first()).toBeVisible({ timeout: 60_000 });
		await expect(page.getByText('abgelaufen')).toHaveCount(0);
	});

	for (const [label, expiresInMs] of [
		['expires', 1500],
		['is revoked', 14 * DAY_MS],
	] as const) {
		test(`a link that ${label} while the card is open is replaced before sharing`, async ({
			page,
		}) => {
			await page.addInitScript(() => {
				const written: string[] = [];
				(window as unknown as { __copied: string[] }).__copied = written;
				Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
				Object.defineProperty(navigator, 'clipboard', {
					value: { writeText: async (text: string) => void written.push(text) },
					configurable: true,
				});
			});
			await mockEmptyLists(page, SOLO_BASE);
			// The first answer is the old link; it dies while the page stays open, so the server's
			// next answer is the fresh fixture link.
			let calls = 0;
			await page.route(`**${SOLO_BASE}/invites/current`, (route) => {
				calls++;
				if (calls > 1) return route.fallback();
				return route.fulfill({
					json: {
						invite: {
							id: '1f0c4b5e-2a3d-4e6f-8a9b-0c1d2e3f4a5b',
							url: `${new URL(route.request().url()).origin}/invite/old-invite-token-00001`,
							expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
						},
					},
				});
			});
			await open(page, SOLO_WG.shareCode);
			const link = page.locator('[data-invite-card-link]');
			await expect(link).toHaveText(/old-invite-token-00001$/);
			if (expiresInMs < DAY_MS) {
				// At its expiry the card fetches the replacement on its own.
				await expect(link).toHaveText(/fixture-invite-token01$/, { timeout: 5000 });
			}
			await page.getByRole('button', { name: /^Link teilen: Einladung in / }).click();
			await expect(link).toHaveText(/fixture-invite-token01$/);
			const readCopied = () =>
				page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
			await expect.poll(async () => (await readCopied()).length).toBe(1);
			const copied = await readCopied();
			expect(copied[0]).toContain('/invite/fixture-invite-token01');
			expect(copied[0]).not.toContain('old-invite-token');
		});
	}

	test('a snoozed card asks for no link', async ({ page }) => {
		let requested = 0;
		await page.route(`**${SOLO_BASE}/invites/current`, (route) => {
			requested++;
			return route.fallback();
		});
		await mockEmptyLists(page, SOLO_BASE);
		await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
			key: SOLO_KEY,
			value: String(Date.now()),
		});
		await open(page, SOLO_WG.shareCode);
		await expect(page.getByRole('heading', { name: 'Diese Woche' })).toBeVisible();
		await page.waitForTimeout(1000);
		await expect(page.locator('[data-invite-card-link]')).toHaveCount(0);
		expect(requested).toBe(0);
	});

	test('the card gives way once a second member has joined', async ({ page }) => {
		await mockEmptyLists(page, SOLO_BASE);
		await page.route(`**${SOLO_BASE}/invites/current`, (route) =>
			route.fulfill({ json: { invite: null } }),
		);
		await page.route(`**${SOLO_BASE}/members`, (route) =>
			route.fulfill({
				json: {
					members: [
						{ id: SOLO_WG.memberId, name: 'Smoke Tester', color: null, active: true },
						{ id: '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55', name: 'Mina', color: null, active: true },
					],
					viewerIsAdmin: true,
				},
			}),
		);
		await open(page, SOLO_WG.shareCode);
		await expect(
			page.getByText('Mina ist dabei. Startet mit der ersten Ausgabe oder dem Einkauf.'),
		).toBeVisible();
		await expect(page.getByRole('button', { name: /^Link teilen: Einladung in / })).toHaveCount(0);
	});

	test('a join pushed to the solo member removes the card without a reload', async ({ page }) => {
		await page.context().grantPermissions(['notifications']);
		await mockEmptyLists(page, SOLO_BASE);
		let joined = false;
		await page.route(`**${SOLO_BASE}/members`, (route) =>
			route.fulfill({
				json: {
					members: [
						{ id: SOLO_WG.memberId, name: 'Smoke Tester', color: null, active: true },
						...(joined
							? [
									{
										id: '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55',
										name: 'Mina',
										color: null,
										active: true,
									},
								]
							: []),
					],
					viewerIsAdmin: true,
				},
			}),
		);
		// The WG tab's change poll reports the moved roster version once Mina is in.
		await page.route(`**${SOLO_BASE}/changes`, (route) =>
			route.fulfill({ json: { data: '0', members: joined ? '1' : '0', chat: '0' } }),
		);
		const cdp = await page.context().newCDPSession(page);
		const registrations: string[] = [];
		cdp.on('ServiceWorker.workerRegistrationUpdated', (event) => {
			for (const registration of event.registrations)
				registrations.push(registration.registrationId);
		});
		await cdp.send('ServiceWorker.enable');
		await open(page, SOLO_WG.shareCode);
		await expect(page.locator('[data-invite-card-link]')).toBeVisible();
		await expect
			.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller)), {
				timeout: 20_000,
			})
			.toBe(true);

		// Mina joins elsewhere; the server pushes "member.joined" to the solo member.
		joined = true;
		await cdp.send('ServiceWorker.deliverPushMessage', {
			origin: new URL(page.url()).origin,
			registrationId: registrations.at(-1) ?? '',
			data: JSON.stringify({ title: 'Mina ist dabei', body: 'Smoke Test WG', url: '/' }),
		});
		// Well before the 30-second members poll.
		await expect(page.locator('[data-invite-card-link]')).toHaveCount(0, { timeout: 5000 });
		await expect(
			page.getByText('Mina ist dabei. Startet mit der ersten Ausgabe oder dem Einkauf.'),
		).toBeVisible();
	});

	test('with a flatmate the card names them and leads to the first entry', async ({ page }) => {
		await mockEmptyLists(page, DUO_BASE);
		await open(page, FIXTURE_WG.shareCode);
		await expect(
			page.getByText('Mina ist dabei. Startet mit der ersten Ausgabe oder dem Einkauf.'),
		).toBeVisible();
		await expect(page.getByRole('link', { name: 'Ausgabe hinzufügen' })).toHaveAttribute(
			'href',
			`/wg/${FIXTURE_WG.shareCode}/expenses?new=1`,
		);
		await expect(page.getByRole('link', { name: 'Einkauf öffnen' })).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Mitbewohner einladen', exact: true }),
		).toBeVisible();

		await page.getByRole('button', { name: 'Einstiegshinweis dauerhaft ausblenden' }).click();
		await page.reload();
		await dismissOnboarding(page);
		await expect(page.getByRole('heading', { name: 'Eure WG ist bereit' })).toHaveCount(0);
	});
});
