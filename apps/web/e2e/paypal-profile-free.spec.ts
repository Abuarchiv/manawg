import { expect, test } from '@playwright/test';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

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
	await expect(page.getByRole('button', { name: 'Verbindung prüfen', exact: true })).toBeVisible();
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
	await expect(page.getByRole('button', { name: 'PayPal verbinden', exact: true })).toHaveCount(0);
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

test('retries a new PayPal return while the old account status is connected', async ({ page }) => {
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
	await expect(page.getByRole('button', { name: 'Verbindung prüfen', exact: true })).toBeEnabled();
	await expect(page.getByRole('button', { name: 'PayPal verbinden', exact: true })).toHaveCount(0);
	await expect.poll(() => confirms.length).toBe(1);
	expect(connectGets).toBeGreaterThan(0);
	expect(confirms[0]).toEqual({ action: 'confirm', merchantId: 'retry-hint' });

	retrying = true;
	const statusGetsBeforeFirstRetry = connectGets;
	await page.getByRole('button', { name: 'Verbindung prüfen', exact: true }).click();
	await expect.poll(() => connectGets).toBe(statusGetsBeforeFirstRetry + 1);
	await expect.poll(() => confirms.length).toBe(2);
	await expect(page.getByText('Eine Zahlung läuft noch. Versuche es danach erneut.')).toBeVisible();
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
