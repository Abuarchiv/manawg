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

interface StrictCall {
	via: 'share' | 'copy';
	inClick: boolean;
	text: string;
}

/**
 * A strict browser: the share sheet and the clipboard only work inside the tap itself, and an
 * awaited request ends the tap. `ClipboardItem` takes a promise, so a write started inside the tap
 * may resolve later. Every call lands in `window.__strict`.
 */
async function strictBrowser(page: Page): Promise<() => Promise<StrictCall[]>> {
	await page.addInitScript(() => {
		let inClick = false;
		const calls: StrictCall[] = [];
		(window as unknown as { __strict: StrictCall[] }).__strict = calls;
		window.addEventListener('click', () => (inClick = true), true);
		window.addEventListener('click', () => setTimeout(() => (inClick = false)));
		Object.defineProperty(navigator, 'userActivation', {
			value: {
				get isActive() {
					return inClick;
				},
			},
			configurable: true,
		});
		Object.defineProperty(navigator, 'share', {
			value: async (data: { text: string }) =>
				void calls.push({ via: 'share', inClick, text: data.text }),
			configurable: true,
		});
		Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
		class FakeClipboardItem {
			readonly items: Record<string, Promise<Blob> | Blob>;
			constructor(items: Record<string, Promise<Blob> | Blob>) {
				this.items = items;
			}
		}
		Object.defineProperty(window, 'ClipboardItem', {
			value: FakeClipboardItem,
			configurable: true,
		});
		Object.defineProperty(navigator, 'clipboard', {
			value: {
				writeText: async (text: string) => {
					if (!inClick) throw new DOMException('no gesture', 'NotAllowedError');
					calls.push({ via: 'copy', inClick, text });
				},
				write: async (items: FakeClipboardItem[]) => {
					if (!inClick) throw new DOMException('no gesture', 'NotAllowedError');
					const blob = await items[0]?.items['text/plain'];
					calls.push({ via: 'copy', inClick: true, text: (await blob?.text()) ?? '' });
				},
			},
			configurable: true,
		});
	});
	return () => page.evaluate(() => (window as unknown as { __strict: StrictCall[] }).__strict);
}

const OLD_INVITE_ID = '1f0c4b5e-2a3d-4e6f-8a9b-0c1d2e3f4a5b';

/** Members route of the solo WG; Mina is in once `joined()` says so. */
async function mockRoster(page: Page, joined: () => boolean): Promise<void> {
	await page.route(`**${SOLO_BASE}/members`, (route) =>
		route.fulfill({
			json: {
				members: [
					{ id: SOLO_WG.memberId, name: 'Smoke Tester', color: null, active: true },
					...(joined()
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
			if (expiresInMs >= DAY_MS) {
				// Revoked elsewhere: the card asks again once the tab is back in front.
				await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
			}
			// At its expiry the card fetches the replacement on its own.
			await expect(link).toHaveText(/fixture-invite-token01$/, { timeout: 5000 });
			await page.getByRole('button', { name: /^Link teilen: Einladung in / }).click();
			const readCopied = () =>
				page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
			await expect.poll(async () => (await readCopied()).length).toBe(1);
			const copied = await readCopied();
			expect(copied[0]).toContain('/invite/fixture-invite-token01');
			expect(copied[0]).not.toContain('old-invite-token');
		});
	}

	test('a share sheet that lost the tap copies a freshly checked link on the next tap', async ({
		page,
	}) => {
		const readCalls = await strictBrowser(page);
		await mockEmptyLists(page, SOLO_BASE);
		let checks = 0;
		await page.route(`**${SOLO_BASE}/invites/current`, (route) => {
			checks++;
			return route.fallback();
		});
		await open(page, SOLO_WG.shareCode);
		await expect(page.locator('[data-invite-card-link]')).toHaveText(/fixture-invite-token01$/);
		const share = page.getByRole('button', { name: /^Link teilen: Einladung in / });
		const loaded = checks;
		await share.click();
		await expect(page.getByText('Link geprüft. Tippe nochmal zum Kopieren.')).toBeVisible();
		expect(await readCalls()).toEqual([]);
		await share.click();
		await expect(page.getByText('Einladungslink kopiert')).toBeAttached();
		// Each tap asked the server; no confirmation was reused.
		expect(checks - loaded).toBe(2);
		const calls = await readCalls();
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ via: 'copy', inClick: true });
		expect(calls[0]?.text).toContain('/invite/fixture-invite-token01');
		// The copy is not for good: the tap after tries the share sheet again.
		await share.click();
		await expect(page.getByText('Link geprüft. Tippe nochmal zum Kopieren.')).toBeVisible();
	});

	test('a link revoked between the taps is not shared while the live update hangs', async ({
		page,
	}) => {
		const readCalls = await strictBrowser(page);
		await mockEmptyLists(page, SOLO_BASE);
		let revoked = false;
		await page.route(`**${SOLO_BASE}/invites/current`, (route) => {
			if (revoked) return route.fallback();
			return route.fulfill({
				json: {
					invite: {
						id: OLD_INVITE_ID,
						url: `${new URL(route.request().url()).origin}/invite/old-invite-token-00001`,
						expiresAt: new Date(Date.now() + 14 * DAY_MS).toISOString(),
					},
				},
			});
		});
		// The live channel is up, then its long poll hangs: the revoke reaches the card only
		// through the tap's own check.
		let answered = false;
		await page.route(`**${SOLO_BASE}/changes*`, (route) => {
			if (answered) return new Promise(() => {});
			answered = true;
			return route.fulfill({ json: { data: '0', members: '0', chat: '0' } });
		});
		await open(page, SOLO_WG.shareCode);
		const link = page.locator('[data-invite-card-link]');
		await expect(link).toHaveText(/old-invite-token-00001$/);
		await expect.poll(() => answered).toBe(true);
		const share = page.getByRole('button', { name: /^Link teilen: Einladung in / });
		await share.click();
		await expect(page.getByText('Link geprüft. Tippe nochmal zum Kopieren.')).toBeVisible();
		revoked = true;
		await share.click();
		await expect(link).toHaveText(/fixture-invite-token01$/);
		await expect(page.getByText('Neuer Link bereit. Tippe nochmal zum Teilen.')).toBeVisible();
		await page.waitForTimeout(500);
		const calls = await readCalls();
		expect(calls.filter((call) => call.text.includes('old-invite-token'))).toEqual([]);
	});

	test('a confirmed link revoked before the second tap is replaced by the live update', async ({
		page,
	}) => {
		const readCalls = await strictBrowser(page);
		await mockEmptyLists(page, SOLO_BASE);
		let revoked = false;
		await page.route(`**${SOLO_BASE}/invites/current`, (route) => {
			if (revoked) return route.fallback();
			return route.fulfill({
				json: {
					invite: {
						id: OLD_INVITE_ID,
						url: `${new URL(route.request().url()).origin}/invite/old-invite-token-00001`,
						expiresAt: new Date(Date.now() + 14 * DAY_MS).toISOString(),
					},
				},
			});
		});
		await page.route(`**${SOLO_BASE}/changes*`, (route) =>
			route.fulfill({ json: { data: revoked ? '1' : '0', members: '0', chat: '0' } }),
		);
		await open(page, SOLO_WG.shareCode);
		const link = page.locator('[data-invite-card-link]');
		await expect(link).toHaveText(/old-invite-token-00001$/);
		await page.getByRole('button', { name: /^Link teilen: Einladung in / }).click();
		await expect(page.getByText('Link geprüft. Tippe nochmal zum Kopieren.')).toBeVisible();
		revoked = true;
		// No reload, focus or visibility change: the live channel alone replaces the link.
		await expect(link).toHaveText(/fixture-invite-token01$/, { timeout: 2500 });
		expect(await readCalls()).toEqual([]);
	});

	test('a confirmed link that expires before the second tap is not shared', async ({ page }) => {
		const readCalls = await strictBrowser(page);
		await mockEmptyLists(page, SOLO_BASE);
		// The load and the first tap's check see the old link; the replacement is slow to arrive.
		let calls = 0;
		let expiresAt = 0;
		await page.route(`**${SOLO_BASE}/invites/current`, async (route) => {
			calls++;
			if (calls > 2) {
				await new Promise((resolve) => setTimeout(resolve, 4000));
				return route.fallback();
			}
			if (!expiresAt) expiresAt = Date.now() + 6000;
			return route.fulfill({
				json: {
					invite: {
						id: '1f0c4b5e-2a3d-4e6f-8a9b-0c1d2e3f4a5b',
						url: `${new URL(route.request().url()).origin}/invite/old-invite-token-00001`,
						expiresAt: new Date(expiresAt).toISOString(),
					},
				},
			});
		});
		await open(page, SOLO_WG.shareCode);
		const link = page.locator('[data-invite-card-link]');
		await expect(link).toHaveText(/old-invite-token-00001$/);
		const share = page.getByRole('button', { name: /^Link teilen: Einladung in / });
		await share.click();
		await expect(page.getByText('Link geprüft. Tippe nochmal zum Kopieren.')).toBeVisible();
		await page.waitForFunction((at) => Date.now() > at, expiresAt);
		await share.click({ force: true });
		await page.waitForTimeout(500);
		expect(await readCalls()).toEqual([]);
		await expect(link).toHaveText(/fixture-invite-token01$/, { timeout: 10_000 });
	});

	test('a link revoked after the last refresh is never shared', async ({ page }) => {
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
		// The card loads the old link; it is revoked on the server, and no refresh runs before the tap.
		let calls = 0;
		await page.route(`**${SOLO_BASE}/invites/current`, (route) => {
			calls++;
			if (calls > 1) return route.fallback();
			return route.fulfill({
				json: {
					invite: {
						id: '1f0c4b5e-2a3d-4e6f-8a9b-0c1d2e3f4a5b',
						url: `${new URL(route.request().url()).origin}/invite/old-invite-token-00001`,
						expiresAt: new Date(Date.now() + 14 * DAY_MS).toISOString(),
					},
				},
			});
		});
		await open(page, SOLO_WG.shareCode);
		const link = page.locator('[data-invite-card-link]');
		await expect(link).toHaveText(/old-invite-token-00001$/);
		const share = page.getByRole('button', { name: /^Link teilen: Einladung in / });
		await share.click();
		await expect(page.getByText('Neuer Link bereit. Tippe nochmal zum Teilen.')).toBeVisible();
		await expect(link).toHaveText(/fixture-invite-token01$/);
		const readCopied = () =>
			page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
		expect(await readCopied()).toEqual([]);
		await share.click();
		await expect.poll(async () => (await readCopied()).length).toBe(1);
		expect((await readCopied())[0]).toContain('/invite/fixture-invite-token01');
	});

	test('a failed share says so on screen', async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
			Object.defineProperty(navigator, 'clipboard', {
				value: { writeText: async () => Promise.reject(new Error('denied')) },
				configurable: true,
			});
			document.execCommand = () => false;
		});
		await mockEmptyLists(page, SOLO_BASE);
		await open(page, SOLO_WG.shareCode);
		await expect(page.locator('[data-invite-card-link]')).toBeVisible();
		await page.getByRole('button', { name: /^Link teilen: Einladung in / }).click();
		const notice = page.getByText('Teilen fehlgeschlagen');
		await expect(notice).toBeVisible();
		// Not just the screen-reader announcement: a real line of text on the card.
		expect((await notice.boundingBox())?.width ?? 0).toBeGreaterThan(20);
	});

	for (const event of ['visibilitychange', 'focus'] as const) {
		test(`a join noticed on ${event} swaps the card for the welcome`, async ({ page }) => {
			await mockEmptyLists(page, SOLO_BASE);
			let joined = false;
			await page.route(`**${SOLO_BASE}/invites/current`, (route) =>
				joined ? route.fulfill({ json: { invite: null } }) : route.fallback(),
			);
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
			await open(page, SOLO_WG.shareCode);
			await expect(page.locator('[data-invite-card-link]')).toBeVisible();
			joined = true;
			await page.evaluate(
				(name) => (name === 'focus' ? window : document).dispatchEvent(new Event(name)),
				event,
			);
			await expect(
				page.getByText('Mina ist dabei. Startet mit der ersten Ausgabe oder dem Einkauf.'),
			).toBeVisible();
			await expect(page.locator('[data-invite-card-link]')).toHaveCount(0);
		});
	}

	test('a join without a push removes the open card within seconds', async ({ page }) => {
		await mockEmptyLists(page, SOLO_BASE);
		let joined = false;
		await page.route(`**${SOLO_BASE}/invites/current`, (route) =>
			joined ? route.fulfill({ json: { invite: null } }) : route.fallback(),
		);
		await mockRoster(page, () => joined);
		await page.route(`**${SOLO_BASE}/changes*`, (route) =>
			route.fulfill({ json: { data: '0', members: joined ? '1' : '0', chat: '0' } }),
		);
		await open(page, SOLO_WG.shareCode);
		await expect(page.locator('[data-invite-card-link]')).toBeVisible();
		// Mina joins on her phone; this tab neither reloads nor changes visibility or focus.
		joined = true;
		await expect(page.locator('[data-invite-card-link]')).toHaveCount(0, { timeout: 2500 });
		await expect(
			page.getByText('Mina ist dabei. Startet mit der ersten Ausgabe oder dem Einkauf.'),
		).toBeVisible();
	});

	test('a join without a push removes the card in an idle tab', async ({ page }) => {
		await page.clock.install();
		await mockEmptyLists(page, SOLO_BASE);
		let joined = false;
		await page.route(`**${SOLO_BASE}/invites/current`, (route) =>
			joined ? route.fulfill({ json: { invite: null } }) : route.fallback(),
		);
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
		// The roster version moves with the join, as the database trigger does.
		await page.route(`**${SOLO_BASE}/changes*`, (route) =>
			route.fulfill({ json: { data: '0', members: joined ? '1' : '0', chat: '0' } }),
		);
		await open(page, SOLO_WG.shareCode);
		await expect(page.locator('[data-invite-card-link]')).toBeVisible();
		// Nobody touches the tab: the list polls have gone idle by the time Mina joins.
		await page.clock.fastForward('06:00');
		joined = true;
		await page.clock.runFor(60_000);
		await expect(
			page.getByText('Mina ist dabei. Startet mit der ersten Ausgabe oder dem Einkauf.'),
		).toBeVisible();
		await expect(page.locator('[data-invite-card-link]')).toHaveCount(0);
	});

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
		await page.route(`**${SOLO_BASE}/changes*`, (route) =>
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
