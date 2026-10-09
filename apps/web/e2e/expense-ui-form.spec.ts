// Expense form: manual split validation, finance dialogs, OCR runtime.
// Why: Split and rounding input is the most error-prone user path.

import { type Locator, type Page, type Response, expect, test } from '@playwright/test';
import {
	FIXTURE_WG,
	dismissOnboarding,
	mockUnreadCount,
	navigateToFeature,
	nextHistoryPop,
	setupMember,
} from './support/helpers';

test.describe('manual split validation', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	const INVALID_SPLIT_MESSAGE =
		'Mindestens ein Anteil ist ungültig. Gib einen gültigen Betrag ein oder lasse das Feld leer.';
	const MEMBERS = [
		{ id: FIXTURE_WG.memberId, name: 'Alexandra Beispielfamilienname', color: null, active: true },
		{ id: FIXTURE_WG.id, name: 'Maximilian Mustermann-Langname', color: null, active: true },
	];

	async function mockFinanceReads(page: Page): Promise<void> {
		const { shareCode } = FIXTURE_WG;
		await page.route(`**/api/wg/${shareCode}/members`, (route) =>
			route.fulfill({ json: { members: MEMBERS, viewerIsAdmin: false } }),
		);
		await page.route(`**/api/wg/${shareCode}/expenses`, (route) =>
			route.fulfill({ json: { expenses: [], payments: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/recurring-expenses`, (route) =>
			route.fulfill({ json: { recurringExpenses: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/dashboard`, (route) =>
			route.fulfill({ json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] } }),
		);
		await mockUnreadCount(page, `/api/wg/${shareCode}`);
	}

	test('blocks an invalid manual expense share, then submits the corrected split', async ({
		page,
	}) => {
		const { shareCode } = FIXTURE_WG;
		let submitted = null as Record<string, unknown> | null;
		let postCount = 0;
		await page.setViewportSize({ width: 320, height: 640 });
		await setupMember(page);
		await mockFinanceReads(page);
		await page.route(`**/api/wg/${shareCode}/expenses`, async (route) => {
			if (route.request().method() === 'POST') {
				postCount += 1;
				submitted = route.request().postDataJSON() as Record<string, unknown>;
				await route.fulfill({ status: 500, json: { error: 'test_response' } });
				return;
			}
			await route.fulfill({ json: { expenses: [], payments: [] } });
		});

		await navigateToFeature(page, `/wg/${shareCode}/ausgaben`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: 'Ausgabe hinzufügen' }).first().click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('Beschreibung', { exact: true }).fill('Internet');
		await dialog.getByLabel('Betrag', { exact: true }).fill('10');
		await dialog.getByRole('button', { name: 'Aufteilung: Manuell', exact: true }).click();
		const firstShare = dialog.getByLabel('Anteil Alexandra Beispielfamilienname in Euro');
		const invalidShare = dialog.getByLabel('Anteil Maximilian Mustermann-Langname in Euro');
		await firstShare.fill('10');
		await invalidShare.fill('-5');
		await dialog.getByRole('button', { name: 'Ausgabe speichern', exact: true }).click();
		await expect(dialog.getByText(INVALID_SPLIT_MESSAGE, { exact: true })).toBeVisible();
		await expect(firstShare).toHaveAttribute('aria-invalid', 'true');
		await expect(firstShare).toHaveAttribute('aria-describedby', 'expense-splits-error');
		expect((await invalidShare.boundingBox())?.width).toBeGreaterThan(0);
		expect(submitted).toBeNull();
		expect(postCount).toBe(0);

		await firstShare.fill('6');
		await invalidShare.fill('4');
		await dialog.getByRole('button', { name: 'Ausgabe speichern', exact: true }).click();
		await expect.poll(() => postCount).toBe(1);
		expect(submitted?.splits).toEqual([
			{ debtorMemberId: FIXTURE_WG.memberId, amountCents: 600 },
			{ debtorMemberId: FIXTURE_WG.id, amountCents: 400 },
		]);
	});

	test('blocks a malformed manual Abo share, then submits the corrected split', async ({
		page,
	}) => {
		const { shareCode } = FIXTURE_WG;
		let submitted = null as Record<string, unknown> | null;
		let postCount = 0;
		await page.setViewportSize({ width: 320, height: 640 });
		await setupMember(page);
		await mockFinanceReads(page);
		await page.route(`**/api/wg/${shareCode}/recurring-expenses`, async (route) => {
			if (route.request().method() === 'POST') {
				postCount += 1;
				submitted = route.request().postDataJSON() as Record<string, unknown>;
				await route.fulfill({ status: 500, json: { error: 'test_response' } });
				return;
			}
			await route.fulfill({ json: { recurringExpenses: [] } });
		});

		await navigateToFeature(page, `/wg/${shareCode}/abos`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: 'Fixkosten hinzufügen' }).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('Beschreibung', { exact: true }).fill('Internet');
		await dialog.getByLabel('Betrag', { exact: true }).fill('10');
		await dialog.getByRole('button', { name: 'Manuell', exact: true }).click();
		const firstShare = dialog.getByLabel('Anteil Alexandra Beispielfamilienname in Euro');
		const invalidShare = dialog.getByLabel('Anteil Maximilian Mustermann-Langname in Euro');
		await firstShare.fill('10');
		await invalidShare.fill('unbekannt');
		await dialog.getByRole('button', { name: 'Fixkosten anlegen', exact: true }).click();
		await expect(dialog.getByText(INVALID_SPLIT_MESSAGE, { exact: true })).toBeVisible();
		await expect(invalidShare).toHaveAttribute('aria-invalid', 'true');
		await expect(invalidShare).toHaveAttribute('aria-describedby', 'abo-splits-error');
		expect((await invalidShare.boundingBox())?.width).toBeGreaterThan(0);
		expect(submitted).toBeNull();
		expect(postCount).toBe(0);

		await firstShare.fill('6');
		await invalidShare.fill('4');
		await dialog.getByRole('button', { name: 'Fixkosten anlegen', exact: true }).click();
		await expect.poll(() => postCount).toBe(1);
		expect(submitted?.splits).toEqual([
			{ debtorMemberId: FIXTURE_WG.memberId, amountCents: 600 },
			{ debtorMemberId: FIXTURE_WG.id, amountCents: 400 },
		]);
	});

	test('keeps blank and zero Abo shares opt-out while posting valid shares', async ({ page }) => {
		const { shareCode } = FIXTURE_WG;
		let submitted = null as Record<string, unknown> | null;
		let postCount = 0;
		await page.setViewportSize({ width: 360, height: 640 });
		await setupMember(page);
		await mockFinanceReads(page);
		await page.route(`**/api/wg/${shareCode}/recurring-expenses`, async (route) => {
			if (route.request().method() === 'POST') {
				postCount += 1;
				submitted = route.request().postDataJSON() as Record<string, unknown>;
				await route.fulfill({ status: 500, json: { error: 'test_response' } });
				return;
			}
			await route.fulfill({ json: { recurringExpenses: [] } });
		});

		await navigateToFeature(page, `/wg/${shareCode}/abos`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: 'Fixkosten hinzufügen' }).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('Beschreibung', { exact: true }).fill('Internet');
		await dialog.getByLabel('Betrag', { exact: true }).fill('10');
		await dialog.getByRole('button', { name: 'Manuell', exact: true }).click();
		const firstShare = dialog.getByLabel('Anteil Alexandra Beispielfamilienname in Euro');
		const optOutShare = dialog.getByLabel('Anteil Maximilian Mustermann-Langname in Euro');
		await firstShare.fill('10');
		await dialog.getByRole('button', { name: 'Fixkosten anlegen', exact: true }).click();
		await expect.poll(() => postCount).toBe(1);
		expect(submitted?.splits).toEqual([{ debtorMemberId: FIXTURE_WG.memberId, amountCents: 1000 }]);

		submitted = null as Record<string, unknown> | null;
		postCount = 0;
		await expect(
			dialog.getByRole('button', { name: 'Fixkosten anlegen', exact: true }),
		).toBeEnabled();
		await optOutShare.fill('0');
		await dialog.getByRole('button', { name: 'Fixkosten anlegen', exact: true }).click();
		await expect.poll(() => postCount).toBe(1);
		expect(submitted?.splits).toEqual([{ debtorMemberId: FIXTURE_WG.memberId, amountCents: 1000 }]);
	});
});

test.describe('finance dialog mobile', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	async function expectManualSplitLayout(
		page: Page,
		dialog: Locator,
		shareInputPrefix: 'share-' | 'abo-share-',
	): Promise<void> {
		const rows = dialog.locator(`[data-slot="field"]:has(input[id^="${shareInputPrefix}"])`);
		await expect(rows).toHaveCount(2);
		const cancelButton = page.getByRole('button', { name: 'Abbrechen', exact: true });
		for (const rootFontSize of [16, 32]) {
			await page.evaluate((size) => {
				document.documentElement.style.fontSize = `${size}px`;
			}, rootFontSize);
			await expect
				.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize))
				.toBe(`${rootFontSize}px`);
			for (const theme of ['light', 'dark'] as const) {
				await page.emulateMedia({ colorScheme: theme });
				await expect
					.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
					.toBe(theme === 'dark');
				for (const width of [320, 360, 390]) {
					await page.setViewportSize({ width, height: 740 });
					const layout = await dialog.evaluate((element) => ({
						clientWidth: element.clientWidth,
						scrollWidth: element.scrollWidth,
					}));
					expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth),
					).toBeLessThanOrEqual(width);
					const cancelBounds = await cancelButton.boundingBox();
					expect(cancelBounds).not.toBeNull();
					if (cancelBounds) expect(cancelBounds.x + cancelBounds.width).toBeLessThanOrEqual(width);
					const metrics = await rows.evaluateAll((elements) =>
						elements.map((element) => {
							const row = element as HTMLElement;
							const label = row.querySelector<HTMLElement>('[data-slot="field-label"]');
							const amount = row.querySelector<HTMLElement>('[data-slot="input-group"]');
							if (!label || !amount) return null;
							const labelBounds = label.getBoundingClientRect();
							const amountBounds = amount.getBoundingClientRect();
							return {
								clientWidth: row.clientWidth,
								scrollWidth: row.scrollWidth,
								direction: getComputedStyle(row).flexDirection,
								labelWidth: labelBounds.width,
								labelRight: labelBounds.right,
								labelTop: labelBounds.top,
								labelBottom: labelBounds.bottom,
								amountLeft: amountBounds.left,
								amountTop: amountBounds.top,
								amountBottom: amountBounds.bottom,
								amountWidth: amountBounds.width,
							};
						}),
					);
					expect(metrics.every((metric) => metric !== null)).toBe(true);
					for (const metric of metrics) {
						if (!metric) throw new Error('Manual share field layout could not be measured');
						expect(
							metric.labelWidth,
							JSON.stringify({ width, rootFontSize, metric }),
						).toBeGreaterThan(0);
						expect(metric.direction).toBe('column');
						expect(metric.scrollWidth).toBeLessThanOrEqual(metric.clientWidth + 1);
						const overlaps =
							metric.labelRight > metric.amountLeft + 1 &&
							metric.labelBottom > metric.amountTop + 1 &&
							metric.labelTop < metric.amountBottom - 1;
						expect(overlaps).toBe(false);
					}
				}
			}
		}
		await page.evaluate(() => {
			document.documentElement.style.fontSize = '16px';
		});
		await page.setViewportSize({ width: 1440, height: 900 });
		// Wide screens keep the 28rem phone dialog, so split rows stay stacked with a full-width amount.
		await expect
			.poll(() =>
				rows.first().evaluate((row) => {
					const amount = row.querySelector<HTMLElement>('[data-slot="input-group"]');
					return {
						dialogWidth: Math.round(row.closest('[role="dialog"]')?.clientWidth ?? 0),
						direction: getComputedStyle(row).flexDirection,
						amountWidth: Math.round(amount?.getBoundingClientRect().width ?? 0),
					};
				}),
			)
			.toEqual({ dialogWidth: 448, direction: 'column', amountWidth: 416 });
	}

	test('keeps finance forms in narrow viewports at 200% text size', async ({ page }) => {
		const { shareCode, id, memberId } = FIXTURE_WG;
		await setupMember(page);
		await page.setViewportSize({ width: 320, height: 640 });
		await page.route(`**/api/wg/${shareCode}/members`, (route) =>
			route.fulfill({
				json: {
					members: [
						{ id: memberId, name: 'Alexandra von Hohenlohe-Waldberg', color: null, active: true },
						{ id, name: 'Maximilian-Wilhelm Demonstrationshausen', color: null, active: true },
					],
					viewerIsAdmin: false,
				},
			}),
		);
		await page.route(`**/api/wg/${shareCode}/expenses`, (route) =>
			route.fulfill({ json: { expenses: [], payments: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/recurring-expenses`, (route) =>
			route.fulfill({ json: { recurringExpenses: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/dashboard`, (route) =>
			route.fulfill({ json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] } }),
		);
		await mockUnreadCount(page, `/api/wg/${shareCode}`);
		await navigateToFeature(page, `/wg/${shareCode}/ausgaben`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: 'Ausgabe hinzufügen' }).first().click();
		const expenseDialog = page.getByRole('dialog');
		await expect(expenseDialog).toBeVisible();
		await expenseDialog.getByText('Manuell', { exact: true }).click();
		await expectManualSplitLayout(page, expenseDialog, 'share-');
		await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
		await page.getByRole('alertdialog').getByRole('button', { name: 'Entwurf verwerfen' }).click();
		await expect(expenseDialog).toBeHidden();
		await nextHistoryPop(page);
		await page.goto(`/wg/${shareCode}/abos`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: 'Fixkosten hinzufügen' }).click();
		const aboDialog = page.getByRole('dialog');
		await expect(aboDialog).toBeVisible();
		await aboDialog.getByText('Manuell', { exact: true }).click();
		await expectManualSplitLayout(page, aboDialog, 'abo-share-');
		await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
		await expect(aboDialog).toBeHidden();
	});
});

test.describe('ocr runtime', () => {
	const OCR_LANGUAGE_DATA_URLS = [
		'https://cdn.jsdelivr.net/npm/@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz',
		'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
	] as const;
	// Tesseract.js-core 5.1.1 tries an optional fetch of its embedded WASM data URI.
	// WebKit blocks it via connect-src, then successfully falls back to decoding
	// the same bytes. Match only that exact message and WASM magic prefix; do not
	// permit data: URLs in CSP.
	const WEBKIT_WASM_DATA_CSP_MESSAGE =
		'Refused to connect to data:application/octet-stream;base64,<embedded-wasm> because it does not appear in the connect-src directive of the Content Security Policy.';
	const WEBKIT_WASM_DATA_CSP_PATTERN =
		/^Refused to connect to data:application\/octet-stream;base64,(AGFzbQE[A-Za-z0-9+/=]*(?:\.{3}[A-Za-z0-9+/=]*)?) because it does not appear in the connect-src directive of the Content Security Policy\.$/;

	function isExpectedWebKitWasmDataCsp(message: string): boolean {
		return WEBKIT_WASM_DATA_CSP_PATTERN.test(message.trimEnd());
	}

	const IMPORT_PATH = `/wg/${FIXTURE_WG.shareCode}/import`;
	const FIXTURE_ENV_ENABLED =
		process.env.E2E_FIXTURE_MODE === 'true' &&
		process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE === 'true' &&
		process.env.NEXT_PUBLIC_DB_DOWN === 'true' &&
		process.env.PLAYWRIGHT_USE_BUILD === 'true';

	test.skip(
		process.env.OCR_RUNTIME_E2E !== 'true' || !FIXTURE_ENV_ENABLED,
		'OCR runtime proof is opt-in: set OCR_RUNTIME_E2E=true with the production fixture build. The real Tesseract worker, WASM core, and German/English models require public access to cdn.jsdelivr.net.',
	);
	test.use({ serviceWorkers: 'block' });

	interface NetworkEvidence {
		cdnResponses: Map<string, number>;
		cspViolations: string[];
		pageErrors: string[];
		apiWrites: string[];
	}

	function observeNetwork(page: Page): NetworkEvidence {
		const evidence: NetworkEvidence = {
			cdnResponses: new Map(),
			cspViolations: [],
			pageErrors: [],
			apiWrites: [],
		};

		page.context().on('response', (response) => {
			if (response.url().startsWith('https://cdn.jsdelivr.net/')) {
				evidence.cdnResponses.set(response.url(), response.status());
			}
		});
		page.context().on('request', (request) => {
			if (request.method() === 'GET') return;
			const path = new URL(request.url()).pathname;
			if (path.startsWith('/api/')) {
				evidence.apiWrites.push(`${request.method()} ${path}`);
			}
		});
		page.on('console', (message) => {
			if (
				message.type() === 'error' &&
				/Content Security Policy|Refused to (?:compile|load|execute)/i.test(message.text())
			) {
				const text = message.text();
				if (isExpectedWebKitWasmDataCsp(text)) {
					evidence.cspViolations.push(WEBKIT_WASM_DATA_CSP_MESSAGE);
				} else {
					evidence.cspViolations.push(
						text.length > 512 ? `${text.slice(0, 256)}…${text.slice(-256)}` : text,
					);
				}
			}
		});
		page.on('pageerror', (error) => evidence.pageErrors.push(error.message));
		return evidence;
	}

	function cspSources(policy: string, name: string): string[] {
		const directive = policy
			.split(';')
			.map((entry) => entry.trim())
			.find((entry) => entry.startsWith(`${name} `));
		return directive?.slice(name.length).trim().split(/\s+/) ?? [];
	}

	function expectStrictOcrPolicy(response: Response): void {
		const csp = response.headers()['content-security-policy'];
		expect(csp).toBeTruthy();
		const scriptSrc = cspSources(csp ?? '', 'script-src');
		const connectSrc = cspSources(csp ?? '', 'connect-src');

		expect(scriptSrc).toContain("'wasm-unsafe-eval'");
		expect(scriptSrc).not.toContain("'unsafe-eval'");
		expect(connectSrc).toContain(OCR_LANGUAGE_DATA_URLS[0]);
		expect(connectSrc).toContain(OCR_LANGUAGE_DATA_URLS[1]);
		expect(connectSrc).not.toContain('https://cdn.jsdelivr.net');
	}

	function expectOnlyExpectedCspViolations(
		violations: readonly string[],
		browserName: string,
	): void {
		const unexpected = violations.filter(
			(message) => browserName !== 'webkit' || message !== WEBKIT_WASM_DATA_CSP_MESSAGE,
		);
		expect(unexpected).toEqual([]);
	}

	async function openOcrImport(page: Page): Promise<Response> {
		await setupMember(page);
		const documentResponse = page.waitForResponse(
			(response) =>
				response.request().resourceType() === 'document' &&
				new URL(response.url()).pathname === IMPORT_PATH,
		);
		await navigateToFeature(page, IMPORT_PATH);
		await dismissOnboarding(page);
		const response = await documentResponse;
		expect(response.status()).toBe(200);
		expectStrictOcrPolicy(response);

		await page.getByRole('button', { name: /Screenshot/i }).click();
		await expect(page.locator('#import-screenshot')).toBeVisible();
		return response;
	}

	async function uploadSyntheticReceipt(page: Page): Promise<void> {
		const base64 = await page.evaluate(() => {
			const canvas = document.createElement('canvas');
			canvas.width = 1000;
			canvas.height = 600;
			const context = canvas.getContext('2d');
			if (!context) throw new Error('Canvas 2D context unavailable');
			context.fillStyle = '#fff';
			context.fillRect(0, 0, canvas.width, canvas.height);
			context.fillStyle = '#000';
			context.font = '38px Arial';
			['TEST RECEIPT', '27.09.2026', 'Milch 2,50 EUR', 'Brot 3,20 EUR', 'TOTAL 5,70 EUR'].forEach(
				(line, index) => context.fillText(line, 60, 85 + index * 85),
			);
			return canvas.toDataURL('image/png').split(',')[1] ?? '';
		});
		if (!base64) throw new Error('Synthetic receipt PNG was not generated');
		await page.locator('#import-screenshot').setInputFiles({
			name: 'synthetic-receipt.png',
			mimeType: 'image/png',
			buffer: Buffer.from(base64, 'base64'),
		});
	}

	function expectTesseractAssets(cdnResponses: Map<string, number>): void {
		const urls = [...cdnResponses.keys()];
		const paths = urls.map((url) => new URL(url).pathname);
		const workerPath = '/npm/tesseract.js@v5.1.1/dist/worker.min.js';
		const corePath = /^\/npm\/tesseract\.js-core@v5\.1\.1\/tesseract-core(?:-[^/]+)?\.wasm\.js$/;
		const deuPath = new URL(OCR_LANGUAGE_DATA_URLS[0]).pathname;
		const engPath = new URL(OCR_LANGUAGE_DATA_URLS[1]).pathname;

		expect(paths).toContain(workerPath);
		expect(paths.some((path) => corePath.test(path))).toBe(true);
		expect(paths).toContain(deuPath);
		expect(paths).toContain(engPath);
		for (const path of [workerPath, deuPath, engPath]) {
			const url = `https://cdn.jsdelivr.net${path}`;
			expect(cdnResponses.get(url), `${url} returns HTTP 200`).toBe(200);
		}
		const coreUrl = urls.find((url) => corePath.test(new URL(url).pathname));
		expect(coreUrl).toBeTruthy();
		expect(cdnResponses.get(coreUrl ?? '')).toBe(200);
	}

	test('real Tesseract recognizes a local receipt under the strict CSP', async ({
		page,
		browserName,
	}) => {
		test.setTimeout(90_000);
		const evidence = observeNetwork(page);
		await openOcrImport(page);
		await uploadSyntheticReceipt(page);

		const recognizedData = page.locator('#import-ocr');
		await expect.poll(() => recognizedData.inputValue(), { timeout: 55_000 }).toContain('TOTAL');
		const recognizedText = await recognizedData.inputValue();
		expect(recognizedText).toMatch(/Milch/i);
		expect(recognizedText).toContain('5,70');
		await expect(
			page.getByText('Bild wird ausgewertet. Das kann 30 Sekunden dauern.', { exact: true }),
		).toHaveCount(0);

		expectTesseractAssets(evidence.cdnResponses);
		expectOnlyExpectedCspViolations(evidence.cspViolations, browserName);
		expect(evidence.pageErrors).toEqual([]);
		expect(evidence.apiWrites).toEqual([]);
	});

	test('blocked Tesseract language downloads show bounded recovery guidance', async ({
		page,
		browserName,
	}) => {
		test.setTimeout(75_000);
		const blockedModelRequests: string[] = [];
		for (const url of OCR_LANGUAGE_DATA_URLS) {
			await page.context().route(url, (route) => {
				blockedModelRequests.push(route.request().url());
				return route.abort();
			});
		}
		const evidence = observeNetwork(page);
		await openOcrImport(page);
		await uploadSyntheticReceipt(page);

		const recovery = page.getByText(/Texterkennung konnte nicht (geladen|initialisiert) werden/);
		await expect(recovery).toBeVisible({ timeout: 45_000 });
		const recoveryText = (await recovery.textContent()) ?? '';
		expect(recoveryText).toMatch(/Internetverbindung/);
		expect(recoveryText).toMatch(/lade die Seite neu|versuche es erneut/i);
		await expect(page.locator('#import-screenshot')).toBeEnabled();
		await expect(
			page.getByText('Bild wird ausgewertet. Das kann 30 Sekunden dauern.', { exact: true }),
		).toHaveCount(0);

		expect(blockedModelRequests.length).toBeGreaterThan(0);
		expectOnlyExpectedCspViolations(evidence.cspViolations, browserName);
		expect(evidence.apiWrites).toEqual([]);
	});
});
