// CSV import wizard and replay safety: atomic commit, warning persistence, responsive wizard, error notices.
// Why: a retried import must not double-book expenses and warnings must survive a reload.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { type Locator, type Page, expect, test } from '@playwright/test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { idempotencyResponses } from '../src/core/db/schema';
import {
	loadClaimedResponse,
	loadIdempotencyStore,
	loadIdempotentWrite,
	loadParseBody,
} from '../tests/support/claimed-response.cjs';
import {
	FIXTURE_WG,
	dismissOnboarding,
	inMinimalMatrix,
	navigateToFeature,
	setupMember,
} from './support/helpers';

test.describe('import replay atomic', () => {
	type CommitResult = {
		importId: string;
		inserted: number;
		skipped: number;
		errors: Array<{ index: number; reason: string }>;
		warning: null | 'notification_delivery_failed' | 'notification_delivery_unknown';
	};

	const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));
	const importCommitPath = path.join(process.cwd(), 'src/features/expenses/import-commit.ts');
	const expenseImports = { id: 'expense-import-id' };
	const idempotencyResponses = {
		scope: 'scope',
		key: 'key',
		responseBody: 'response-body',
		expiresAt: 'expires-at',
	};

	function loadCommitImport(overrides: Record<string, unknown>) {
		const source = transpileModule(readFileSync(importCommitPath, 'utf8'), {
			compilerOptions: {
				module: ModuleKind.CommonJS,
				target: ScriptTarget.ES2022,
				esModuleInterop: true,
			},
		}).outputText;
		const module = {
			exports: {} as {
				commitImport: (
					replay: { scope: string; key: string },
					prepare: () => Promise<{ input: unknown }>,
				) => Promise<{ result: CommitResult }>;
			},
		};
		new Function('require', 'module', 'exports', source)(
			(name: string) => (name in overrides ? overrides[name] : requireFromWeb(name)),
			module,
			module.exports,
		);
		return async ({ replay, ...body }: ReturnType<typeof input>) =>
			(await module.exports.commitImport(replay, async () => ({ input: body }))).result;
	}

	function harness(initialSlot: unknown) {
		const state = {
			slot: initialSlot,
			claimExpiresAt: new Date(Date.now() + 15 * 60_000),
			imports: 0,
			notices: 0,
			audits: 0,
			dispatches: 0,
			capturing: false,
			failReplayWrite: false,
		};
		let prior = Promise.resolve();
		const withExpensePaymentLock = async (
			_wgId: string,
			operation: (tx: unknown) => Promise<unknown>,
		) => {
			const waitFor = prior;
			let release: () => void = () => undefined;
			prior = new Promise<void>((resolve) => {
				release = resolve;
			});
			await waitFor;
			let slotDraft = state.slot;
			let importsDraft = 0;
			const tx = {
				select: () => ({
					from: () => ({
						where: () => ({
							limit: () => ({
								for: async () =>
									slotDraft === undefined
										? []
										: [{ body: slotDraft, expiresAt: state.claimExpiresAt }],
							}),
						}),
					}),
				}),
				insert: (table: unknown) => ({
					values: () => ({
						returning: async () => {
							if (table !== expenseImports) throw new Error('unexpected insert');
							importsDraft += 1;
							return [{ id: 'import-1' }];
						},
					}),
				}),
				update: (table: unknown) => ({
					set: (value: { responseBody?: unknown }) => ({
						where: () => ({
							returning: async () => {
								if (table !== idempotencyResponses) throw new Error('unexpected replay update');
								if (state.failReplayWrite) throw new Error('cache_write_failed');
								slotDraft = value.responseBody;
								return [{ scope: 'import-commit:wg:member' }];
							},
						}),
					}),
				}),
			};
			try {
				const result = await operation(tx);
				state.slot = slotDraft;
				state.imports += importsDraft;
				return result;
			} finally {
				release();
			}
		};
		const mocks: Record<string, unknown> = {
			'@/core/activity-feed': { postSystemNotice: async () => state.notices++ },
			'@/core/audit': { recordAuditEvent: async () => state.audits++ },
			'@/core/db': {
				db: {},
				expenseImports,
				expenseSplits: {},
				expenses: {},
				idempotencyResponses,
				wgMembers: {},
			},
			'@/core/notifications/notification-dispatch': {
				dispatchNotificationSafely: async () => {
					state.dispatches += 1;
					return { warning: 'notification_delivery_failed' };
				},
			},
			'@/core/utils/money': { formatEuroCents: () => '0,00 €' },
			'@/features/expenses/expense-payments': {
				hasCapturingExpensePayment: async () => state.capturing,
				withExpensePaymentLock,
			},
			'@/features/expenses/split-math': { settledAtForOwnShare: () => null },
			'@/features/expenses/paid-by-guard': { checkPaidByGuard: () => ({ ok: true }) },
			'drizzle-orm': {
				and: (...parts: unknown[]) => parts,
				eq: (...parts: unknown[]) => parts,
				inArray: (...parts: unknown[]) => parts,
				isNull: (part: unknown) => part,
				sql: () => null,
			},
		};
		mocks['@/core/db/claimed-response'] = loadClaimedResponse(mocks);
		mocks['@/core/db/idempotent-write'] = loadIdempotentWrite(mocks);
		const commitImport = loadCommitImport(mocks);
		return { state, commitImport };
	}

	function input(count = 1, skip = true) {
		return {
			wg: { id: 'wg', name: 'WG', shareCode: 'MTE8PZAT' },
			source: 'splitwise_csv',
			importedByMemberId: 'member',
			importedByName: 'Member',
			expenses: Array.from({ length: count }, () => ({
				parsed: {
					date: '2026-09-01T00:00:00.000Z',
					description: 'Expense',
					amountCents: 100,
					currency: 'EUR',
					paidByName: 'Unknown',
					splits: [],
					warnings: [],
				},
				skip,
			})),
			mapping: {},
			skipDuplicates: false,
			rawPayloadHash: 'hash',
			replay: { scope: 'import-commit:wg:member', key: 'key' },
		};
	}

	test('import waits for PayPal capture without writing an expense', async () => {
		const { state, commitImport } = harness({ _claimed: true });
		state.capturing = true;
		await expect(commitImport(input())).rejects.toThrow('paypal_payment_pending');
		expect(state.imports).toBe(0);
		expect(state.slot).toEqual({ _claimed: true });
	});

	test('lost response and notification failure replay the one committed import', async () => {
		const { state, commitImport } = harness({ _claimed: true });
		const first = await commitImport(input());
		const replay = await commitImport(input());
		expect(first.warning).toBe('notification_delivery_failed');
		expect(replay).toEqual({ ...first, warning: null });
		expect(state.imports).toBe(1);
		expect([state.notices, state.audits, state.dispatches]).toEqual([1, 1, 1]);
	});

	test('a concurrent retry after claim lease reclaim inserts only once', async () => {
		const { state, commitImport } = harness({ _claimed: true });
		const results = await Promise.all([commitImport(input()), commitImport(input())]);
		expect(results[0]?.importId).toBe(results[1]?.importId);
		expect(state.imports).toBe(1);
		expect(state.dispatches).toBe(1);
	});

	test('failed replay write rolls back import and allows a safe retry', async () => {
		const { state, commitImport } = harness({ _claimed: true });
		state.failReplayWrite = true;
		await expect(commitImport(input())).rejects.toThrow('cache_write_failed');
		expect(state.imports).toBe(0);
		expect(state.slot).toEqual({ _claimed: true });
		state.failReplayWrite = false;
		await commitImport(input());
		expect(state.imports).toBe(1);
	});

	test('claim cleanup before the transaction fails closed', async () => {
		const { state, commitImport } = harness(undefined);
		await expect(commitImport(input())).rejects.toThrow('idempotency_claim_missing');
		expect(state.imports).toBe(0);
	});

	test('null, malformed, and unavailable claims fail closed before writing', async () => {
		for (const slot of [null, { _replayUnavailable: true }, {}, { _claimed: true, extra: 1 }]) {
			const { state, commitImport } = harness(slot);
			await expect(commitImport(input())).rejects.toThrow(/idempotency_claim_(missing|invalid)/);
			expect(state.imports).toBe(0);
		}
	});

	test('a large replay result remains available without a post-commit cache update', async () => {
		const { state, commitImport } = harness({ _claimed: true });
		const body = input(1_500, false);
		const first = await commitImport(body);
		expect(JSON.stringify(first).length).toBeGreaterThan(32 * 1024);
		expect(await commitImport(body)).toEqual({ ...first, warning: null });
		expect(state.imports).toBe(1);
	});
});

test.describe('import warning persistence', () => {
	const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));

	function loadTs<T>(file: string, overrides: Record<string, unknown>): T {
		const source = transpileModule(readFileSync(file, 'utf8'), {
			compilerOptions: {
				module: ModuleKind.CommonJS,
				target: ScriptTarget.ES2022,
				esModuleInterop: true,
			},
		}).outputText;
		const module = { exports: {} as T };
		new Function('require', 'module', 'exports', source)(
			(name: string) => (name in overrides ? overrides[name] : requireFromWeb(name)),
			module,
			module.exports,
		);
		return module.exports;
	}

	type Warning = 'notification_delivery_failed' | 'notification_delivery_unknown';
	const warning: Warning = 'notification_delivery_failed';

	test('warning update targets the committed import row with a scoped JSONB update', async () => {
		const dialect = new PgDialect();
		let setSql = '';
		let where: { sql: string; params: unknown[] } = { sql: '', params: [] };
		const db = {
			update: () => ({
				set: (values: { responseBody: SQL }) => ({
					where: (condition: SQL) => ({
						returning: async () => {
							setSql = dialect.sqlToQuery(values.responseBody).sql;
							where = dialect.sqlToQuery(condition);
							return [{ scope: 'import-commit:wg:member' }];
						},
					}),
				}),
			}),
		};
		const store = loadIdempotencyStore({ '@/core/db': { db, idempotencyResponses } });
		const persisted = await store.setReplayWarning(
			'import-commit:wg:member',
			'key',
			{
				match: [{ path: ['importId'], equals: 'import-1' }],
				warningPath: ['warning'],
				replaces: [null, warning],
			},
			warning,
		);
		expect(persisted).toBe(true);
		expect(setSql).toContain('jsonb_set');
		expect(where.sql).toContain('expires_at');
		expect(where.sql).toContain('importId');
		expect(where.params).toContain('import-1');
	});

	function importRoute(persist: () => Promise<boolean>, commit?: () => Promise<unknown>) {
		let logs = 0;
		const result = {
			importId: 'import-1',
			inserted: 1,
			skipped: 0,
			errors: [],
			warning,
		};
		const mocks: Record<string, unknown> = {
			'@/core/http/api-errors': {
				badRequest: () => new Response(null, { status: 400 }),
				conflict: () => new Response(null, { status: 409 }),
				serverError: () => new Response(null, { status: 500 }),
				tooMany: () => new Response(null, { status: 429 }),
			},
			'@/core/guards/admin': { isWgAdmin: async () => false },
			'@/core/guards/require-wg-member': {
				requireWgMember: async () => ({
					ok: true,
					wg: { id: 'wg', name: 'WG', shareCode: 'MTE8PZAT' },
					member: { memberId: 'member', name: 'Member' },
				}),
			},
			'@/core/guards/route-preamble': {
				readShareCode: async () => ({ ok: true, code: 'MTE8PZAT' }),
			},
			'@/core/idempotency-store': {
				readIdempotencyKey: () => 'key',
				setReplayWarning: persist,
			},
			'@/core/infra/observability': { logApiError: () => logs++ },
			'@/core/rate-limit': {
				checkRateLimit: async () => ({ success: true }),
				importCommitLimiter: {},
			},
			'@/features/expenses/import-body': {
				MAX_CSV_BYTES: 5 * 1024 * 1024,
				MAX_OCR_BYTES: 1024 * 1024,
				readImportJsonBody: async (req: Request) => ({ ok: true, value: await req.json() }),
			},
			'@/features/expenses/import-commit': {
				commitImport: async (
					_replay: unknown,
					prepare: () => Promise<{ stop: Response } | { input: unknown }>,
				) => {
					const prepared = await prepare();
					if ('stop' in prepared) return { kind: 'stopped', response: prepared.stop };
					return { kind: 'committed', result: commit ? await commit() : result };
				},
			},
			'@/features/expenses/import-hash': { hashPayload: () => 'hash' },
			'@/features/expenses/import-parsers': {
				UnsupportedCurrencyError: class extends Error {},
				findMappingConflicts: () => [],
				parseSplidCsv: () => [{ paidByName: 'Member', splits: [] }],
				parseSplitwiseCsv: () => [{ paidByName: 'Member', splits: [] }],
			},
			'@/features/expenses/ocr': { parseOcrText: () => ({ expenses: [] }) },
			'next/server': { NextResponse: { json: (body: unknown) => Response.json(body) } },
		};
		mocks['@/core/http/parse-body'] = loadParseBody(mocks);
		mocks['@/core/db/idempotent-write'] = loadIdempotentWrite(mocks);
		const route = loadTs<{ POST: (req: Request, ctx: unknown) => Promise<Response> }>(
			path.join(process.cwd(), 'src/app/api/wg/[code]/imports/commit/route.ts'),
			mocks,
		);
		return {
			logs: () => logs,
			post: () =>
				route.POST(
					new Request('https://example.invalid', {
						method: 'POST',
						body: JSON.stringify({ source: 'splitwise_csv', payload: 'data', memberMapping: {} }),
					}),
					{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
				),
		};
	}

	test('immediate response preserves a known warning when persistence fails', async () => {
		const saved = importRoute(async () => true);
		await expect((await saved.post()).json()).resolves.toMatchObject({ warning });
		expect(saved.logs()).toBe(0);

		const missing = importRoute(async () => false);
		await expect((await missing.post()).json()).resolves.toMatchObject({ warning });
		expect(missing.logs()).toBe(1);

		const failed = importRoute(async () => {
			throw new Error('db_unavailable');
		});
		await expect((await failed.post()).json()).resolves.toMatchObject({ warning });
		expect(failed.logs()).toBe(1);
	});

	// Releasing the claim after a failed commit is the primitive's job (tests/idempotent-write).
	test('a failed commit answers with the real error on every same-key retry', async () => {
		const failing = importRoute(
			async () => true,
			async () => {
				throw new Error('member_not_in_wg');
			},
		);
		expect((await failing.post()).status).toBe(400);
		expect((await failing.post()).status).toBe(400);

		const succeeding = importRoute(async () => true);
		expect((await succeeding.post()).status).toBe(200);
	});
});

test.describe('import wizard responsive', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	async function setLargeText(page: Page): Promise<void> {
		await page.evaluate(() => {
			const nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce;
			if (!nonce) throw new Error('CSP nonce not found');
			const style = document.createElement('style');
			style.nonce = nonce;
			style.textContent = 'html { font-size: 200% !important; }';
			document.head.append(style);
		});
	}

	async function expectPageFits(page: Page, width: number): Promise<void> {
		const dimensions = await page.evaluate(() => ({
			documentWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
			bodyWidth: document.body.scrollWidth,
		}));
		expect(dimensions.documentWidth).toBeLessThanOrEqual(width);
		expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.clientWidth);
		expect(dimensions.bodyWidth).toBeLessThanOrEqual(width);
	}

	async function expectElementReachable(
		page: Page,
		element: Locator,
		viewportWidth: number,
	): Promise<void> {
		await expect(element).toBeVisible();
		// Center the element: Playwright treats an element behind the fixed navigation as already visible.
		await element.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
		const bounds = await element.boundingBox();
		if (!bounds) throw new Error('Action has no visible bounds');
		const viewport = page.viewportSize();
		if (!viewport) throw new Error('Viewport size is unavailable');
		const navBounds = await page
			.getByRole('navigation', { name: 'WG Hauptnavigation' })
			.boundingBox();
		if (!navBounds) throw new Error('WG navigation has no visible bounds');
		expect(bounds.x).toBeGreaterThanOrEqual(0);
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewportWidth);
		expect(bounds.y).toBeGreaterThanOrEqual(0);
		expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
		expect(bounds.y + bounds.height).toBeLessThanOrEqual(navBounds.y);
	}

	async function expectActionBounds(
		page: Page,
		labels: string[],
		viewportWidth: number,
	): Promise<void> {
		for (const label of labels) {
			const action = page.getByRole('button', { name: label, exact: true });
			await expectElementReachable(page, action, viewportWidth);
		}
		await expectPageFits(page, viewportWidth);
	}

	const parsedExpense = {
		date: '2026-09-25T00:00:00.000Z',
		description: 'Wocheneinkauf',
		amountCents: 1200,
		currency: 'EUR',
		paidByName: FIXTURE_WG.memberName,
		splits: [{ memberName: FIXTURE_WG.memberName, amountCents: 1200 }],
		warnings: [],
	};

	for (const width of [320, 360] as const) {
		for (const largeText of [false, true] as const) {
			const textScale = largeText ? '32px' : 'normal';
			for (const colorScheme of ['light', 'dark'] as const) {
				if (!inMinimalMatrix({ width, dark: colorScheme === 'dark', large: largeText })) continue;
				test(`Splitwise import actions fit at ${width}px with ${textScale} root text (${colorScheme})`, async ({
					page,
				}) => {
					await page.setViewportSize({ width, height: 844 });
					await page.emulateMedia({ colorScheme });
					await setupMember(page);
					await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/imports/preview`, (route) =>
						route.fulfill({
							json: {
								parsed: [parsedExpense],
								payloadHash: 'responsive-import-payload',
								memberMapping: { [FIXTURE_WG.memberName]: FIXTURE_WG.memberId },
								conflicts: [],
								members: [{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName }],
							},
						}),
					);
					await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/imports/commit`, (route) =>
						route.fulfill({
							json: {
								importId: 'responsive-import',
								inserted: 1,
								skipped: 0,
								errors: [],
								warning: null,
							},
						}),
					);

					await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/import`);
					await dismissOnboarding(page);
					if (largeText) await setLargeText(page);
					await expect(page.getByRole('button', { name: /Splitwise CSV/ })).toBeVisible();
					await expect
						.poll(() =>
							page.locator('html').evaluate((element) => element.classList.contains('dark')),
						)
						.toBe(colorScheme === 'dark');

					const isDark = await page
						.locator('html')
						.evaluate((element) => element.classList.contains('dark'));
					expect(isDark).toBe(colorScheme === 'dark');
					const rootFontSize = await page.evaluate(() =>
						Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
					);
					if (largeText) expect(rootFontSize).toBe(32);
					else expect(rootFontSize).toBeGreaterThanOrEqual(14);

					await page.getByRole('button', { name: /Splitwise CSV/ }).click();
					await expect(page.getByRole('heading', { name: 'Export-Datei auswählen' })).toBeVisible();
					await expectActionBounds(page, ['Vorschau erstellen', 'Zurück'], width);

					if (width === 320 && largeText && colorScheme === 'light') {
						const back = page.getByRole('button', { name: 'Zurück', exact: true });
						await page.getByRole('heading', { name: 'Export-Datei auswählen' }).focus();
						for (
							let attempt = 0;
							attempt < 8 && !(await back.evaluate((el) => el === document.activeElement));
							attempt += 1
						) {
							await page.keyboard.press('Tab');
						}
						expect(await back.evaluate((el) => el === document.activeElement)).toBe(true);
						await page.keyboard.press('Enter');
						await expect(page.getByRole('heading', { name: 'Importquelle wählen' })).toBeVisible();
						await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/import`);
						await setLargeText(page);
						const restartedFontSize = await page.evaluate(() =>
							Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
						);
						expect(restartedFontSize).toBe(32);
						await page.getByRole('button', { name: /Splitwise CSV/ }).click();
					}

					await page.getByText('Oder Inhalt einfügen', { exact: true }).click();
					await page.getByRole('textbox', { name: 'Inhalt des Exports' }).fill('fixture export');
					await page.getByRole('button', { name: 'Vorschau erstellen', exact: true }).click();
					await expect(
						page.getByRole('heading', { name: 'Namen WG-Mitgliedern zuordnen' }),
					).toBeVisible();
					await expectActionBounds(page, ['Weiter zur Vorschau', 'Zurück'], width);

					await page.getByRole('button', { name: 'Weiter zur Vorschau', exact: true }).click();
					await expect(page.getByRole('heading', { name: 'Vorschau', exact: true })).toBeVisible();
					await expectActionBounds(page, ['Importieren (1)', 'Zurück'], width);

					await page.getByRole('button', { name: 'Importieren (1)', exact: true }).click();
					await expect(page.getByRole('heading', { name: 'Import abgeschlossen' })).toBeVisible();
					const expensesLink = page.getByRole('link', { name: 'Zu den Ausgaben', exact: true });
					await expectElementReachable(page, expensesLink, width);
					await expectPageFits(page, width);
				});
			}
		}
	}
});

test.describe('import error notice', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');
	test.use({ hasTouch: true, isMobile: true });

	test('browser back moves one wizard step back and asks before leaving with input', async ({
		page,
	}) => {
		const preview = {
			parsed: [
				{
					date: '2026-01-01',
					description: 'Testeintrag',
					amountCents: 1000,
					currency: 'EUR',
					paidByName: FIXTURE_WG.memberName,
					splits: [{ memberName: FIXTURE_WG.memberName, amountCents: 1000 }],
					warnings: [],
				},
			],
			payloadHash: 'hash-back',
			memberMapping: { [FIXTURE_WG.memberName]: FIXTURE_WG.memberId },
			conflicts: [],
			members: [{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName }],
		};
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/imports/preview`, (route) =>
			route.fulfill({ json: preview }),
		);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/import`);
		await dismissOnboarding(page);

		const source = page.getByRole('button', { name: 'Splitwise CSV' });
		await source.click();
		await page.getByText('Oder Inhalt einfügen').click();
		await page.getByLabel('Inhalt des Exports').fill('irrelevant, response is mocked');
		await page.getByRole('button', { name: 'Vorschau erstellen' }).click();
		await expect(
			page.getByRole('heading', { name: 'Namen WG-Mitgliedern zuordnen' }),
		).toBeVisible();

		await page.goBack();
		await expect(page.getByLabel('Inhalt des Exports')).toHaveValue(
			'irrelevant, response is mocked',
		);
		await page.goBack();
		await expect(page.getByRole('heading', { name: 'Importquelle wählen' })).toBeVisible();
		// Die gewählte Quelle erneut antippen geht weiter, die Eingabe bleibt erhalten.
		await expect(source).toHaveAttribute('aria-pressed', 'true');
		await source.click();
		await expect(page.getByLabel('Inhalt des Exports')).toHaveValue(
			'irrelevant, response is mocked',
		);

		await page.goBack();
		await page.goBack();
		await expect(page.getByRole('alertdialog')).toContainText('Import-Eingaben verwerfen?');
		await page.getByRole('button', { name: 'Verwerfen' }).click();
		await expect(page).toHaveURL(new RegExp(`/wg/${FIXTURE_WG.shareCode}/ausgaben`));
	});

	test('going back from the preview step clears a stale commit error', async ({ page }) => {
		const preview = {
			parsed: [
				{
					date: '2026-01-01',
					description: 'Testeintrag',
					amountCents: 1000,
					currency: 'EUR',
					paidByName: FIXTURE_WG.memberName,
					splits: [{ memberName: FIXTURE_WG.memberName, amountCents: 1000 }],
					warnings: [],
				},
			],
			payloadHash: 'hash-1',
			memberMapping: { [FIXTURE_WG.memberName]: FIXTURE_WG.memberId },
			conflicts: [],
			members: [{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName }],
		};

		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/imports/preview`, (route) =>
			route.fulfill({ json: preview }),
		);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/imports/commit`, (route) =>
			route.fulfill({ status: 500, json: { error: 'server_error' } }),
		);

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/import`);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: 'Splitwise CSV' }).click();
		await page.getByText('Oder Inhalt einfügen').click();
		await page.getByLabel('Inhalt des Exports').fill('irrelevant, response is mocked');
		await page.getByRole('button', { name: 'Vorschau erstellen' }).click();

		await page.getByRole('button', { name: 'Weiter zur Vorschau' }).click();

		await page.getByRole('button', { name: /^Importieren/ }).click();
		await expect(page.getByText('Import fehlgeschlagen', { exact: false })).toBeVisible();

		await page.getByRole('button', { name: 'Zurück' }).click();
		await expect(
			page.getByRole('heading', { name: 'Namen WG-Mitgliedern zuordnen' }),
		).toBeVisible();
		await expect(page.getByText('Import fehlgeschlagen', { exact: false })).toHaveCount(0);
	});
});
