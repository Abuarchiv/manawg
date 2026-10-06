// PayPal UI and onboarding: checkout flow, profile-free connect, settings error handling, document security.
// Why: money-moving UI must show truthful states and never leak partner data into the document.

import { type Page, expect, test } from '@playwright/test';
import {
	FIXTURE_WG,
	dismissOnboarding,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
} from './_helpers';

test.describe('paypal checkout', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	const PAYPAL_CONFIGURED = Boolean(
		process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID &&
			process.env.NEXT_PUBLIC_PAYPAL_PARTNER_ATTRIBUTION_ID,
	);

	const OTHER_MEMBER_ID = '11111111-1111-4111-8111-111111111111';

	async function setupDebtPage(
		page: Page,
		options: {
			debtorId: string;
			creditorId: string;
			creditorMerchantId: string | null;
			onReadExpenses?: (count: number) => void;
			isSettled?: () => boolean;
		},
	): Promise<void> {
		const { shareCode, memberId } = FIXTURE_WG;
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/members`, (route) =>
			route.fulfill({
				json: {
					members: [
						{
							id: memberId,
							name: 'Abu',
							color: null,
							active: true,
							paypalMerchantId: options.creditorId === memberId ? options.creditorMerchantId : null,
						},
						{
							id: OTHER_MEMBER_ID,
							name: 'Mina',
							color: null,
							active: true,
							paypalMerchantId:
								options.creditorId === OTHER_MEMBER_ID ? options.creditorMerchantId : null,
						},
					],
					viewerIsAdmin: false,
				},
			}),
		);
		let expenseReads = 0;
		await page.route(`**/api/wg/${shareCode}/expenses`, (route) => {
			expenseReads += 1;
			options.onReadExpenses?.(expenseReads);
			const settled = options.isSettled?.() ?? false;
			return route.fulfill({
				json: {
					expenses: [
						{
							id: 'expense-rent',
							paidByMemberId: options.creditorId,
							amountCents: 1000,
							currency: 'EUR',
							description: 'Miete',
							occurredAt: '2026-09-01T10:00:00.000Z',
							splits: [
								{
									id: 'split-rent',
									expenseId: 'expense-rent',
									debtorMemberId: options.debtorId,
									amountCents: 1000,
									settledAt: settled ? '2026-09-27T10:00:00.000Z' : null,
								},
							],
						},
					],
					payments: [],
				},
			});
		});
		await page.route(`**/api/wg/${shareCode}/recurring-expenses`, (route) =>
			route.fulfill({ json: { recurringExpenses: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/dashboard`, (route) =>
			route.fulfill({ json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] } }),
		);
		await mockUnreadCount(page, `/api/wg/${shareCode}`);
		await navigateToFeature(page, `/wg/${shareCode}/ausgaben`);
		await dismissOnboarding(page);
	}

	function paypalSdkStubScript(merchantId: string): string {
		return `
		window.__paypalCheckoutSdkStubLoaded = true;
		window[${JSON.stringify(`p${merchantId}`)}] = {
			Buttons: (options) => ({
				render: async (container) => {
					const cancel = document.createElement('button');
					cancel.type = 'button';
					cancel.textContent = 'PayPal abbrechen';
					cancel.onclick = () => options.onCancel?.();
					container.appendChild(cancel);
					const approve = document.createElement('button');
					approve.type = 'button';
					approve.textContent = 'PayPal bestätigen';
					approve.onclick = async () => {
						try {
							const orderID = await options.createOrder();
							await options.onApprove({ orderID });
						} catch (error) {
							options.onError(error);
						}
					};
					container.appendChild(approve);
				},
				close: async () => {},
			}),
		};
	`;
	}

	test('unlinked recipients can connect PayPal, while debtors keep manual settlement', async ({
		page,
	}) => {
		test.skip(!PAYPAL_CONFIGURED, 'PayPal-Hinweise erscheinen nur mit PayPal-Konfiguration');
		await setupDebtPage(page, {
			debtorId: OTHER_MEMBER_ID,
			creditorId: FIXTURE_WG.memberId,
			creditorMerchantId: null,
		});

		await expect(page.getByRole('list', { name: 'Deine offenen Zahlungen' })).toBeVisible();
		await expect(
			page.getByText('Verbinde PayPal, damit andere Mitglieder dir Geld senden können.'),
		).toBeVisible();
		const connectLink = page.getByRole('link', { name: 'PayPal verbinden', exact: true });
		await expect(connectLink).toHaveAttribute('href', `/wg/${FIXTURE_WG.shareCode}/einstellungen`);
		await expect(page.getByRole('button', { name: 'Ausgleichen', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Mit PayPal zahlen', exact: true })).toHaveCount(
			0,
		);
	});

	test('debtors see when the recipient has not connected PayPal', async ({ page }) => {
		test.skip(!PAYPAL_CONFIGURED, 'PayPal-Hinweise erscheinen nur mit PayPal-Konfiguration');
		await setupDebtPage(page, {
			debtorId: FIXTURE_WG.memberId,
			creditorId: OTHER_MEMBER_ID,
			creditorMerchantId: null,
		});

		await expect(
			page.getByText('PayPal-Zahlungen sind erst möglich, wenn Mina PayPal verbunden hat.'),
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'Ausgleichen', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Mit PayPal zahlen', exact: true })).toHaveCount(
			0,
		);
	});

	test('PayPal approval changes debt only after server-confirmed capture', async ({ page }) => {
		test.skip(
			!process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ||
				!process.env.NEXT_PUBLIC_PAYPAL_PARTNER_ATTRIBUTION_ID,
			'requires fixture PayPal client configuration',
		);

		const merchantId = 'fixture-merchant';
		let captureCanComplete = false;
		let settled = false;
		let expenseReads = 0;
		const captureBodies: Array<{ orderId?: string }> = [];
		const settlementPosts: unknown[] = [];
		const orderBodies: unknown[] = [];
		const orderLookups: string[] = [];
		const sdkRequests: string[] = [];
		const paypalUrl = `**/api/wg/${FIXTURE_WG.shareCode}/paypal`;
		const orderPath = `/api/wg/${FIXTURE_WG.shareCode}/paypal/order`;
		const documentPath = `/wg/${FIXTURE_WG.shareCode}/ausgaben`;
		const documentResponse = page.waitForResponse(
			(response) =>
				response.request().resourceType() === 'document' &&
				new URL(response.url()).pathname === documentPath &&
				response.status() === 200,
		);
		await page.route(
			(url) => url.pathname === orderPath,
			async (route) => {
				if (route.request().method() === 'GET') {
					orderLookups.push(route.request().url());
					return route.fulfill({ json: { status: 'NONE' } });
				}
				orderBodies.push(route.request().postDataJSON());
				return route.fulfill({ json: { orderId: `ORDER-${orderBodies.length}` } });
			},
		);
		await page.route(`${paypalUrl}/capture`, async (route) => {
			captureBodies.push(route.request().postDataJSON() as { orderId?: string });
			if (!captureCanComplete) {
				return route.fulfill({ status: 400, json: { error: 'paypal_capture_failed' } });
			}
			settled = true;
			return route.fulfill({ json: { status: 'COMPLETED' } });
		});
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/expenses/settle-batch`, async (route) => {
			if (route.request().method() === 'POST') settlementPosts.push(route.request().postDataJSON());
			return route.fulfill({ json: { settled: 0, settledCents: 0, splits: [] } });
		});
		await page.route('https://www.paypal.com/sdk/js**', async (route) => {
			sdkRequests.push(route.request().url());
			return route.fulfill({
				status: 200,
				contentType: 'application/javascript',
				body: paypalSdkStubScript(merchantId),
			});
		});
		await setupDebtPage(page, {
			debtorId: FIXTURE_WG.memberId,
			creditorId: OTHER_MEMBER_ID,
			creditorMerchantId: merchantId,
			isSettled: () => settled,
			onReadExpenses: (count) => {
				expenseReads = count;
			},
		});
		const response = await documentResponse;
		const csp = response.headers()['content-security-policy'] ?? '';
		const scriptSrc =
			csp.split(';').find((directive) => directive.trim().startsWith('script-src ')) ?? '';
		const nonce = scriptSrc.match(/'nonce-([^']+)'/)?.[1];
		if (!nonce) throw new Error('CSP nonce missing from the original document');
		expect(scriptSrc).toContain("'strict-dynamic'");
		expect(scriptSrc).not.toContain("'unsafe-eval'");
		expect(
			await page.evaluate(() => document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce),
		).toBe(nonce);

		await expect(page.getByText(/Du schuldest Mina/)).toBeVisible();
		await page.getByRole('button', { name: 'Mit PayPal zahlen', exact: true }).click();
		const cancelButton = page.getByRole('button', { name: 'PayPal abbrechen', exact: true });
		const approveButton = page.getByRole('button', { name: 'PayPal bestätigen', exact: true });
		await expect(cancelButton).toBeVisible();
		const sdkScript = page.locator(`script[data-namespace="p${merchantId}"]`);
		await expect(sdkScript).toHaveCount(1);
		expect(sdkRequests).toHaveLength(1);
		expect(
			await sdkScript.evaluate((script) => ({
				nonce: (script as HTMLScriptElement).nonce,
				cspNonce: script.getAttribute('data-csp-nonce'),
			})),
		).toEqual({ nonce, cspNonce: nonce });
		expect(
			await page.evaluate(
				() =>
					(window as Window & { __paypalCheckoutSdkStubLoaded?: boolean })
						.__paypalCheckoutSdkStubLoaded,
			),
		).toBe(true);
		expect(orderLookups).toHaveLength(1);
		await cancelButton.click();
		await expect(page.getByText(/Du schuldest Mina/)).toBeVisible();
		expect(orderBodies).toHaveLength(0);
		expect(captureBodies).toHaveLength(0);

		await approveButton.click();
		await expect(page.getByText(/PayPal konnte die Zahlung nicht bestätigen/)).toBeVisible();
		await expect(
			page.getByText('PayPal verarbeitet diese Zahlung noch. Starte keine weitere Zahlung.'),
		).toBeVisible();
		const retryStatusButton = page.getByRole('button', {
			name: 'Zahlungsstatus prüfen',
			exact: true,
		});
		await expect(retryStatusButton).toBeVisible();
		await expect(approveButton).toBeHidden();
		await expect(page.getByText(/Du schuldest Mina/)).toBeVisible();
		const readsBeforeComplete = expenseReads;
		expect(captureBodies).toEqual([{ orderId: 'ORDER-1' }]);
		expect(orderBodies).toHaveLength(1);
		expect(settlementPosts).toEqual([]);

		captureCanComplete = true;
		await retryStatusButton.click();
		await expect.poll(() => expenseReads).toBeGreaterThan(readsBeforeComplete);
		await expect(page.getByText(/Du schuldest Mina/)).toHaveCount(0);
		expect(captureBodies).toEqual([{ orderId: 'ORDER-1' }, { orderId: 'ORDER-1' }]);
		expect(orderBodies).toHaveLength(1);
		expect(settlementPosts).toEqual([]);
	});
});

test.describe('paypal profile free', () => {
	// page.route provider doubles must not be bypassed by the built app's service worker.
	test.use({ serviceWorkers: 'block' });
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	test('profile can start and confirm PayPal while legacy status lookup is unavailable', async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width: 320, height: 800 });
		await setupMember(page);

		let serverConfirmed = false;
		let connectGets = 0;
		const connectPosts: Array<{ action?: string; consent?: boolean; merchantId?: string }> = [];
		const connectEndpoint = `**/api/wg/${FIXTURE_WG.shareCode}/paypal/connect`;
		const actionUrl = 'https://www.paypal.com/connect?trackingId=fixture-provider-hint';
		await page.route(connectEndpoint, async (route) => {
			if (route.request().method() === 'GET') {
				connectGets += 1;
				return route.fulfill({ status: 500, json: { error: 'paypal_status_failed' } });
			}
			const body = route.request().postDataJSON() as {
				action?: string;
				consent?: boolean;
				merchantId?: string;
			};
			connectPosts.push(body);
			if (body.action === 'start') return route.fulfill({ json: { url: actionUrl } });
			if (body.action === 'confirm') {
				serverConfirmed = true;
				return route.fulfill({ json: { connected: true } });
			}
			return route.fulfill({ status: 400, json: { error: 'invalid_action' } });
		});
		await page.route('https://www.paypal.com/**', (route) =>
			route.fulfill({ contentType: 'text/html', body: '<title>PayPal fixture</title>' }),
		);

		const profileMemberPath = `/api/wg/${FIXTURE_WG.shareCode}/members/${FIXTURE_WG.memberId}`;
		const profileMemberGets: string[] = [];
		page.on('request', (request) => {
			if (request.method() === 'GET' && new URL(request.url()).pathname === profileMemberPath) {
				profileMemberGets.push(request.url());
			}
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen`);
		await dismissOnboarding(page);
		await expect(page.getByRole('heading', { name: 'Dein Profil', exact: true })).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByText(FIXTURE_WG.memberName, { exact: true })).toBeVisible();
		await expect(page.getByText('PayPal Merchant-ID', { exact: true })).toHaveCount(0);
		await expect(page.getByRole('textbox', { name: /merchant.?id/i })).toHaveCount(0);
		await expect.poll(() => connectGets).toBeGreaterThan(0);
		await expect(
			page.getByRole('alert').filter({
				hasText: 'PayPal-Verbindung konnte nicht geprüft werden. Bitte versuche es erneut.',
			}),
		).toBeVisible();
		await expect(
			page.getByText(
				'Mit „PayPal verbinden“ stimmst du zu, dass die für die Verknüpfung nötigen Kontodaten zwischen ManaWG und PayPal ausgetauscht werden.',
				{ exact: true },
			),
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'PayPal verbinden', exact: true })).toBeEnabled();

		const light = page.getByRole('button', { name: 'Hell', exact: true });
		const dark = page.getByRole('button', { name: 'Dunkel', exact: true });
		await expect(light).toBeVisible();
		await expect(dark).toBeVisible();
		await light.click();
		await expect(page.locator('html')).not.toHaveClass(/dark/);
		await expect(dark).toHaveAttribute('aria-pressed', 'false');
		await page.screenshot({
			path: testInfo.outputPath('paypal-connect-light-320.png'),
			animations: 'disabled',
		});
		await dark.click();
		await expect(page.locator('html')).toHaveClass(/dark/);
		await expect(dark).toHaveAttribute('aria-pressed', 'true');
		await page.screenshot({
			path: testInfo.outputPath('paypal-connect-dark-320.png'),
			animations: 'disabled',
		});

		await page.getByRole('button', { name: 'PayPal verbinden', exact: true }).click();
		await expect(page).toHaveURL(actionUrl);
		expect(connectPosts[0]).toEqual({ action: 'start', consent: true });

		const connectGetsBeforeReturn = connectGets;
		await page.goto(
			`/wg/${FIXTURE_WG.shareCode}/einstellungen?keep=1&paypal=return&merchantIdInPayPal=untrusted-hint&trackingId=untrusted&consentStatus=granted`,
		);
		await dismissOnboarding(page);
		await expect(page.getByText('PayPal verbunden', { exact: true })).toBeVisible();
		expect(serverConfirmed).toBe(true);
		expect(connectGets).toBeGreaterThan(connectGetsBeforeReturn);
		expect(connectPosts.at(-1)).toEqual({
			action: 'confirm',
			merchantId: 'untrusted-hint',
		});
		const cleanUrl = new URL(page.url());
		expect(cleanUrl.searchParams.get('keep')).toBe('1');
		for (const hint of ['paypal', 'merchantIdInPayPal', 'trackingId', 'consentStatus']) {
			expect(cleanUrl.searchParams.has(hint)).toBe(false);
		}

		await page.waitForLoadState('networkidle');
		expect(profileMemberGets).toEqual([]);
	});

	test('pending and cancelled PayPal returns never show the recipient as connected', async ({
		page,
	}) => {
		await setupMember(page);
		let confirmCalls = 0;
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/paypal/connect`, async (route) => {
			if (route.request().method() === 'GET') {
				return route.fulfill({ json: { available: true, connected: false } });
			}
			const body = route.request().postDataJSON() as { action?: string };
			if (body.action === 'confirm') {
				confirmCalls += 1;
				return route.fulfill({ status: 409, json: { error: 'paypal_onboarding_pending' } });
			}
			return route.fulfill({ status: 400, json: { error: 'invalid_action' } });
		});

		await navigateToFeature(
			page,
			`/wg/${FIXTURE_WG.shareCode}/einstellungen?keep=1&paypal=return&merchantIdInPayPal=hint`,
		);
		await dismissOnboarding(page);
		await expect(page.getByRole('heading', { name: 'Dein Profil', exact: true })).toBeVisible();
		await expect(page.getByText('PayPal-Verbindung wartet noch auf Bestätigung.')).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Verbindung prüfen', exact: true }),
		).toBeVisible();
		await expect(page.getByText('PayPal verbunden', { exact: true })).toHaveCount(0);
		expect(confirmCalls).toBe(1);
		let cleanUrl = new URL(page.url());
		expect(cleanUrl.searchParams.get('keep')).toBe('1');
		expect(cleanUrl.searchParams.has('merchantIdInPayPal')).toBe(false);

		await page.goto(
			`/wg/${FIXTURE_WG.shareCode}/einstellungen?keep=1&paypal=cancel&trackingId=untrusted`,
		);
		await dismissOnboarding(page);
		await expect(page.getByText('PayPal-Verbindung wurde abgebrochen.')).toBeVisible();
		await expect(page.getByText('PayPal verbunden', { exact: true })).toHaveCount(0);
		expect(confirmCalls).toBe(1);
		cleanUrl = new URL(page.url());
		expect(cleanUrl.searchParams.get('keep')).toBe('1');
		expect(cleanUrl.searchParams.has('paypal')).toBe(false);
		expect(cleanUrl.searchParams.has('trackingId')).toBe(false);
	});

	test('shows a plain unavailable state when PayPal connection is not configured', async ({
		page,
	}) => {
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/paypal/connect`, (route) =>
			route.fulfill({ json: { available: false, connected: false } }),
		);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen`);
		await dismissOnboarding(page);
		await expect(page.getByRole('heading', { name: 'Dein Profil', exact: true })).toBeVisible();
		await expect(
			page.getByText('PayPal ist derzeit nicht verfügbar.', { exact: true }),
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'PayPal verbinden', exact: true })).toHaveCount(
			0,
		);
	});

	test('does not redirect to an untrusted PayPal action host', async ({ page }) => {
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/paypal/connect`, async (route) => {
			if (route.request().method() === 'GET') {
				return route.fulfill({ json: { available: true, connected: false } });
			}
			return route.fulfill({ json: { url: 'https://www.paypal.com.attacker.example/connect' } });
		});
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen`);
		await dismissOnboarding(page);
		await expect(page.getByRole('heading', { name: 'Dein Profil', exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'PayPal verbinden', exact: true }).click();
		await expect(
			page.getByText(
				'PayPal hat einen ungültigen Verbindungslink zurückgegeben. Bitte versuche es erneut.',
			),
		).toBeVisible();
		expect(new URL(page.url()).pathname).toBe(`/wg/${FIXTURE_WG.shareCode}/einstellungen`);
	});

	test('retries a new PayPal return while the old account status is connected', async ({
		page,
	}) => {
		await setupMember(page);
		let connectGets = 0;
		let startCalls = 0;
		let retrying = false;
		let retryConfirmCalls = 0;
		const confirms: Array<{ action?: string; merchantId?: string }> = [];
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/paypal/connect`, async (route) => {
			if (route.request().method() === 'GET') {
				connectGets += 1;
				return retrying
					? route.fulfill({ status: 503, json: { error: 'temporarily_unavailable' } })
					: route.fulfill({ json: { available: true, connected: true } });
			}
			const body = route.request().postDataJSON() as { action?: string; merchantId?: string };
			if (body.action === 'start') {
				startCalls += 1;
				return route.fulfill({ json: { url: 'https://www.paypal.com/connect' } });
			}
			if (body.action === 'confirm') {
				confirms.push(body);
				if (!retrying) {
					return route.fulfill({ status: 502, json: { error: 'provider_unavailable' } });
				}
				retryConfirmCalls += 1;
				if (retryConfirmCalls === 1) {
					return route.fulfill({ status: 409, json: { error: 'paypal_payment_pending' } });
				}
				return route.fulfill({ json: { connected: true } });
			}
			return route.fulfill({ status: 400, json: { error: 'invalid_action' } });
		});

		await navigateToFeature(
			page,
			`/wg/${FIXTURE_WG.shareCode}/einstellungen?keep=1&paypal=return&merchantIdInPayPal=retry-hint&trackingId=private`,
		);
		await dismissOnboarding(page);
		await expect(page.getByRole('heading', { name: 'Dein Profil', exact: true })).toBeVisible();
		await expect(
			page.getByText('PayPal-Verbindung konnte nicht geprüft werden. Bitte versuche es erneut.'),
		).toBeVisible();
		await expect(page.getByText('PayPal verbunden', { exact: true })).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'Verbindung prüfen', exact: true }),
		).toBeEnabled();
		await expect(page.getByRole('button', { name: 'PayPal verbinden', exact: true })).toHaveCount(
			0,
		);
		await expect.poll(() => confirms.length).toBe(1);
		expect(connectGets).toBeGreaterThan(0);
		expect(confirms[0]).toEqual({ action: 'confirm', merchantId: 'retry-hint' });

		retrying = true;
		const statusGetsBeforeFirstRetry = connectGets;
		await page.getByRole('button', { name: 'Verbindung prüfen', exact: true }).click();
		await expect.poll(() => connectGets).toBe(statusGetsBeforeFirstRetry + 1);
		await expect.poll(() => confirms.length).toBe(2);
		await expect(
			page.getByText('Eine Zahlung läuft noch. Versuche es danach erneut.'),
		).toBeVisible();
		const statusGetsBeforeSecondRetry = connectGets;
		await page.getByRole('button', { name: 'Verbindung prüfen', exact: true }).click();
		await expect.poll(() => connectGets).toBe(statusGetsBeforeSecondRetry + 1);
		await expect.poll(() => confirms.length).toBe(3);
		expect(confirms[1]).toEqual({ action: 'confirm', merchantId: 'retry-hint' });
		expect(confirms[2]).toEqual({ action: 'confirm', merchantId: 'retry-hint' });
		expect(startCalls).toBe(0);
		await expect(page.getByText('PayPal verbunden', { exact: true })).toBeVisible();
		expect(retryConfirmCalls).toBe(2);
		const cleanUrl = new URL(page.url());
		expect(cleanUrl.searchParams.get('keep')).toBe('1');
		expect(cleanUrl.searchParams.has('merchantIdInPayPal')).toBe(false);
		expect(cleanUrl.searchParams.has('trackingId')).toBe(false);
	});

	test('can finish provider onboarding without a callback using only the pending cookie', async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width: 320, height: 800 });
		await setupMember(page);
		const posts: unknown[] = [];
		let completeCalls = 0;
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/paypal/connect`, async (route) => {
			if (route.request().method() === 'GET')
				return route.fulfill({ json: { available: true, connected: false } });
			const body = route.request().postDataJSON() as { action?: string };
			posts.push(body);
			if (body.action !== 'complete')
				return route.fulfill({ status: 400, json: { error: 'paypal_request_invalid' } });
			completeCalls += 1;
			return completeCalls === 1
				? route.fulfill({ status: 409, json: { error: 'paypal_onboarding_pending' } })
				: route.fulfill({ json: { connected: true } });
		});
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen`);
		await dismissOnboarding(page);
		const check = page.getByRole('button', { name: 'Verbindung prüfen', exact: true });
		await expect(check).toBeEnabled();
		await page.screenshot({
			path: testInfo.outputPath('paypal-recovery-light-320.png'),
			animations: 'disabled',
		});
		await page.getByRole('button', { name: 'Dunkel', exact: true }).click();
		await page.screenshot({
			path: testInfo.outputPath('paypal-recovery-dark-320.png'),
			animations: 'disabled',
		});
		await check.click();
		await expect(page.getByText('PayPal-Verbindung wartet noch auf Bestätigung.')).toBeVisible();
		await expect(page.getByText('PayPal verbunden', { exact: true })).toHaveCount(0);
		await check.click();
		await expect(page.getByText('PayPal verbunden', { exact: true })).toBeVisible();
		expect(posts).toEqual([{ action: 'complete' }, { action: 'complete' }]);
		await expect(page.getByRole('textbox', { name: /merchant.?id/i })).toHaveCount(0);
	});

	test('missing callback hint uses server completion and expired state offers a fresh connection', async ({
		page,
	}) => {
		await setupMember(page);
		const posts: unknown[] = [];
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/paypal/connect`, async (route) => {
			if (route.request().method() === 'GET')
				return route.fulfill({ json: { available: true, connected: false } });
			posts.push(route.request().postDataJSON());
			return route.fulfill({ status: 409, json: { error: 'paypal_connection_expired' } });
		});
		await navigateToFeature(
			page,
			`/wg/${FIXTURE_WG.shareCode}/einstellungen?keep=1&paypal=return&trackingId=untrusted`,
		);
		await dismissOnboarding(page);
		await expect(
			page.getByText('Die PayPal-Verbindung ist abgelaufen. Bitte starte sie erneut.'),
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'PayPal verbinden', exact: true })).toBeEnabled();
		await expect(page.getByText('PayPal verbunden', { exact: true })).toHaveCount(0);
		expect(posts).toEqual([{ action: 'complete' }]);
		const url = new URL(page.url());
		expect(url.searchParams.get('keep')).toBe('1');
		expect(url.searchParams.has('paypal')).toBe(false);
		expect(url.searchParams.has('trackingId')).toBe(false);
	});
});

test.describe('paypal settings error association', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	test('PayPal status failure is announced and can be retried from the keyboard', async ({
		page,
	}) => {
		await setupMember(page);

		let retryRequested = false;
		let statusGets = 0;
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/paypal/connect`, async (route) => {
			if (route.request().method() === 'GET') {
				statusGets += 1;
				if (!retryRequested) {
					return route.fulfill({ status: 503, json: { error: 'temporary_failure' } });
				}
				return route.fulfill({ json: { available: true, connected: false } });
			}
			// Retrying without a started onboarding has nothing to complete.
			return route.fulfill({ status: 409, json: { error: 'paypal_connection_expired' } });
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen`);
		const errorAlert = page.getByRole('alert').filter({
			hasText: 'PayPal-Verbindung konnte nicht geprüft werden. Bitte versuche es erneut.',
		});
		await expect(errorAlert).toBeVisible({ timeout: 30_000 });
		expect(statusGets).toBeGreaterThan(0);
		await expect(page.getByRole('textbox', { name: /merchant.?id/i })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'PayPal verbinden', exact: true })).toBeEnabled();

		const retry = page.getByRole('button', { name: 'Verbindung prüfen', exact: true });
		await expect(retry).toBeVisible();
		const getsBeforeRetry = statusGets;
		await retry.focus();
		retryRequested = true;
		await page.keyboard.press('Enter');

		await expect(errorAlert).toBeHidden();
		await expect(page.getByRole('button', { name: 'PayPal verbinden', exact: true })).toBeEnabled();
		await expect.poll(() => statusGets).toBeGreaterThan(getsBeforeRetry);
	});
});

test.describe('paypal settings load error', () => {
	// page.route provider doubles must not be bypassed by the built app's service worker.
	test.use({ serviceWorkers: 'block' });
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	for (const width of [320, 360]) {
		for (const theme of ['Hell', 'Dunkel'] as const) {
			if (width !== 320) continue;
			test(`${width}px ${theme}: unknown status keeps explicit connect available and can be retried`, async ({
				page,
			}) => {
				await page.setViewportSize({ width, height: 780 });
				await setupMember(page);

				let retryRequested = false;
				let statusGets = 0;
				const startBodies: unknown[] = [];
				const completeBodies: unknown[] = [];
				await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/paypal/connect`, async (route) => {
					if (route.request().method() === 'GET') {
						statusGets += 1;
						if (!retryRequested) {
							return route.fulfill({ status: 503, json: { error: 'temporary_failure' } });
						}
						return route.fulfill({ json: { available: true, connected: false } });
					}
					const body = route.request().postDataJSON() as { action?: string };
					if (body.action === 'start') startBodies.push(body);
					if (body.action === 'complete') {
						completeBodies.push(body);
						return route.fulfill({ status: 409, json: { error: 'paypal_connection_expired' } });
					}
					return route.fulfill({ status: 400, json: { error: 'unexpected_action' } });
				});

				await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen`);
				const themeButton = page.getByRole('button', { name: theme, exact: true });
				await expect(themeButton).toBeVisible({ timeout: 30_000 });
				const errorAlert = page.getByRole('alert').filter({
					hasText: 'PayPal-Verbindung konnte nicht geprüft werden. Bitte versuche es erneut.',
				});
				await expect(errorAlert).toBeVisible();
				expect(statusGets).toBeGreaterThan(0);
				await expect(page.getByRole('textbox', { name: /merchant.?id/i })).toHaveCount(0);
				await expect(
					page.getByRole('button', { name: 'PayPal verbinden', exact: true }),
				).toBeEnabled();

				await themeButton.click();
				if (theme === 'Dunkel') await expect(page.locator('html')).toHaveClass(/dark/);
				else await expect(page.locator('html')).not.toHaveClass(/dark/);
				const layout = await page.evaluate(() => ({
					viewport: document.documentElement.clientWidth,
					content: document.documentElement.scrollWidth,
				}));
				expect(layout.content).toBeLessThanOrEqual(layout.viewport);
				expect(startBodies).toEqual([]);

				const retry = page.getByRole('button', { name: 'Verbindung prüfen', exact: true });
				await expect(retry).toBeVisible();
				const getsBeforeRetry = statusGets;
				await retry.focus();
				retryRequested = true;
				await page.keyboard.press('Enter');

				await expect(errorAlert).toBeHidden();
				await expect.poll(() => completeBodies).toEqual([{ action: 'complete' }]);
				// Without a started onboarding there is nothing to expire: stay quietly unconnected.
				await expect(
					page.getByText('Die PayPal-Verbindung ist abgelaufen. Bitte starte sie erneut.'),
				).toHaveCount(0);
				await expect(
					page.getByRole('button', { name: 'PayPal verbinden', exact: true }),
				).toBeEnabled();
				await expect.poll(() => statusGets).toBeGreaterThan(getsBeforeRetry);
				expect(startBodies).toEqual([]);
			});
		}
	}

	test('failed status retry preserves the status error without attempting cookie completion', async ({
		page,
	}) => {
		await setupMember(page);
		const posts: unknown[] = [];
		let gets = 0;
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/paypal/connect`, async (route) => {
			if (route.request().method() === 'GET') {
				gets += 1;
				return route.fulfill({ status: 503, json: { error: 'temporary_failure' } });
			}
			posts.push(route.request().postDataJSON());
			return route.fulfill({ status: 409, json: { error: 'paypal_connection_expired' } });
		});
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen`);
		await expect.poll(() => gets).toBeGreaterThan(0);
		const before = gets;
		await page.getByRole('button', { name: 'Verbindung prüfen', exact: true }).click();
		await expect.poll(() => gets).toBeGreaterThan(before);
		await expect(
			page.getByText('PayPal-Verbindung konnte nicht geprüft werden. Bitte versuche es erneut.'),
		).toBeVisible();
		expect(posts).toEqual([]);
		await expect(
			page.getByText('Die PayPal-Verbindung ist abgelaufen. Bitte starte sie erneut.'),
		).toHaveCount(0);
	});
});

test.describe('paypal document security', () => {
	test.skip(
		!process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ||
			!process.env.NEXT_PUBLIC_PAYPAL_PARTNER_ATTRIBUTION_ID,
		'requires the PayPal SDK public configuration used by the application',
	);

	function directive(csp: string, name: string): string | undefined {
		return csp
			.split(';')
			.map((item) => item.trim())
			.find((item) => item.startsWith(`${name} `))
			?.slice(name.length)
			.trim();
	}

	for (const path of ['/', '/neu']) {
		test(`PayPal document security works from ${path} and retains the popup opener`, async ({
			page,
		}) => {
			await page.route('https://paypal.test/**', (route) =>
				route.fulfill({
					status: 200,
					contentType: 'text/html',
					body: '<title>PayPal popup probe</title>',
				}),
			);

			const response = await page.goto(path);
			if (!response) throw new Error(`No document response for ${path}`);
			const headers = response.headers();
			expect(headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');

			const csp = headers['content-security-policy'] ?? '';
			expect(csp).toBeTruthy();
			const scriptSrc = directive(csp, 'script-src') ?? '';
			const connectSrc = directive(csp, 'connect-src') ?? '';
			const frameSrc = directive(csp, 'frame-src') ?? '';
			const policyNonce = scriptSrc.match(/'nonce-([^']+)'/)?.[1];
			expect(policyNonce).toBeTruthy();
			expect(frameSrc).toContain('https://www.paypal.com');
			expect(frameSrc).toContain('https://www.sandbox.paypal.com');
			expect(connectSrc).toContain('https://www.paypal.com');
			expect(connectSrc).toContain('https://www.sandbox.paypal.com');

			const documentNonce = await page.evaluate(
				() => document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce,
			);
			expect(documentNonce).toBe(policyNonce);

			await page.evaluate(() => {
				const button = document.createElement('button');
				button.type = 'button';
				button.id = 'paypal-popup-probe';
				button.textContent = 'Open PayPal popup';
				button.style.position = 'fixed';
				button.style.top = '16px';
				button.style.right = '16px';
				button.style.zIndex = '2147483647';
				button.addEventListener('click', () =>
					window.open('https://paypal.test/checkout', 'paypal-checkout'),
				);
				document.body.append(button);
			});
			const popupPromise = page.waitForEvent('popup');
			await page.locator('#paypal-popup-probe').click();
			const popup = await popupPromise;
			await popup.waitForLoadState('domcontentloaded');
			expect(await popup.evaluate(() => window.opener !== null)).toBe(true);
		});
	}
});
