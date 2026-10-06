// Shopping list: quick input parsing, mutation/replay safety, duplicate conflicts, hitarea and swipe.
// Why: two roommates edit the same list concurrently; duplicates and retries must resolve deterministically.

import { randomUUID } from 'node:crypto';
import { type Page, expect, test } from '@playwright/test';
import { DrizzleQueryError } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { idempotencyResponses, shoppingItems } from '../src/core/db';
import type { ShoppingItem } from '../src/core/db/schema';
import * as schema from '../src/core/db/schema';
import type { DbTransaction } from '../src/core/db/transaction';
import { type ReplaySlotDependencies, claimReplaySlot } from '../src/core/guards/replay-slot';
import { parseShoppingInput } from '../src/features/shopping/parse-shopping-input';
import { isOpenShoppingItemDuplicate } from '../src/features/shopping/shopping-duplicate';
import {
	SHOPPING_CREATE_DUPLICATE_RESPONSE,
	type ShoppingCreateInput,
	type ShoppingCreateReplayResponse,
	ShoppingCreateTransactionRollback,
	finalizeShoppingCreateDuplicateReplay,
	handleShoppingCreateTransactionFailure,
	insertShoppingItemWithReplay,
	normalizeShoppingCreateReplayOrReject,
	normalizeShoppingCreateReplayResponse,
	persistShoppingCreateReplayResponse,
	resolveShoppingCreateReplay,
	shoppingCreateHttpResponse,
	withShoppingCreatePostCommitFallback,
} from '../src/features/shopping/shopping-mutation';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

test.describe('shopping input', () => {
	test('splits a leading amount from the item name', () => {
		expect(parseShoppingInput('2 Hafermilch')).toEqual({ name: 'Hafermilch', quantity: '2' });
		expect(parseShoppingInput(' 1,5 L  Milch ')).toEqual({ name: 'Milch', quantity: '1,5 L' });
		expect(parseShoppingInput('3x Brot')).toEqual({ name: 'Brot', quantity: '3x' });
		expect(parseShoppingInput('1 Packung Kaffee')).toEqual({
			name: 'Kaffee',
			quantity: '1 Packung',
		});
		expect(parseShoppingInput('7Up')).toEqual({ name: '7Up', quantity: null });
		expect(parseShoppingInput('Milch')).toEqual({ name: 'Milch', quantity: null });
		expect(parseShoppingInput('2')).toEqual({ name: '2', quantity: null });
	});
});

test.describe('shopping retry', () => {
	test.setTimeout(240_000);

	test('requires a WG member for shopping API data', async ({ request }) => {
		const response = await request.get('/api/wg/MTE8PZAT/shopping', {
			timeout: 120_000,
		});

		expect(response.status()).toBe(401);
		await expect(response.json()).resolves.toMatchObject({ error: 'auth_required' });
	});

	test('retries an uncertain shopping create with the same idempotency key', async ({ page }) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);
		const keys: string[] = [];
		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			if (route.request().method() !== 'POST') {
				await route.continue();
				return;
			}
			keys.push(route.request().headers()['idempotency-key'] ?? '');
			await route.fulfill({
				status: keys.length === 1 ? 503 : 200,
				contentType: 'application/json',
				body: JSON.stringify(
					keys.length === 1
						? { error: 'idempotency_response_pending' }
						: {
								item: {
									id: 'replayed-shopping-item',
									name: 'Rettich',
									quantity: null,
									addedByMemberId: 'fixture-member',
									boughtAt: null,
									boughtByMemberId: null,
									createdAt: new Date().toISOString(),
								},
								warning: null,
							},
				),
			});
		});
		await setupMember(page);
		await navigateToFeature(page, '/wg/MTE8PZAT/einkauf');
		await dismissOnboarding(page);
		await page.getByLabel('Artikel-Name').fill('Rettich');
		await page.getByRole('button', { name: 'Artikel hinzufügen', exact: true }).click();
		await expect(
			page.getByText('Speicherstatus unklar. Prüfe die Liste und versuche es bei Bedarf erneut.'),
		).toBeVisible();
		await page.getByRole('button', { name: 'Artikel hinzufügen', exact: true }).click();
		await expect.poll(() => keys.length).toBe(2);
		expect(keys[0]).toBeTruthy();
		expect(keys[1]).toBe(keys[0]);
	});

	test('queues a second Enter while the first add is saving and ignores a repeated Enter on the same text', async ({
		page,
	}) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);
		const posted: string[] = [];
		let releaseFirst: () => void = () => {};
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			if (route.request().method() !== 'POST') {
				await route.fallback();
				return;
			}
			const { name } = route.request().postDataJSON() as { name: string };
			posted.push(name);
			if (posted.length === 1) await firstGate;
			await route.fulfill({
				json: {
					item: {
						id: `item-${posted.length}`,
						name,
						quantity: null,
						addedByMemberId: FIXTURE_WG.memberId,
						boughtAt: null,
						boughtByMemberId: null,
						createdAt: new Date().toISOString(),
					},
					warning: null,
				},
			});
		});
		await setupMember(page);
		await navigateToFeature(page, '/wg/MTE8PZAT/einkauf');
		await dismissOnboarding(page);
		const input = page.getByLabel('Artikel-Name');
		await input.fill('Milch');
		await input.press('Enter');
		// Der zweite Enter darf nicht am gesperrten Absende-Knopf scheitern.
		await input.press('Enter');
		await input.fill('Brot');
		await input.press('Enter');
		// Auch das wartende „Brot“ wird nicht doppelt nachgereiht.
		await input.press('Enter');
		releaseFirst();
		await expect.poll(() => posted).toEqual(['Milch', 'Brot']);
		await expect(input).toHaveValue('');
		expect(posted).toEqual(['Milch', 'Brot']);
	});

	test('uses a fresh idempotency key after an offline-queued shopping create', async ({ page }) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);
		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			if (route.request().method() !== 'POST') {
				await route.continue();
				return;
			}
			await route.abort('internetdisconnected');
		});
		await setupMember(page);
		await navigateToFeature(page, '/wg/MTE8PZAT/einkauf');
		await dismissOnboarding(page);
		const readQueuedKeys = () =>
			page.evaluate(() => {
				const raw = window.localStorage.getItem('manawg:offline-actions');
				const actions = raw
					? (JSON.parse(raw) as Array<{ type: string; idempotencyKey?: string }>)
					: [];
				return actions
					.filter((action) => action.type === 'shopping.create')
					.map((action) => action.idempotencyKey);
			});
		for (let attempt = 0; attempt < 2; attempt += 1) {
			await page.getByLabel('Artikel-Name').fill('Rettich');
			await page.getByRole('button', { name: 'Artikel hinzufügen', exact: true }).click();
			await expect.poll(async () => (await readQueuedKeys()).length).toBe(attempt + 1);
		}
		const keys = await readQueuedKeys();
		expect(keys[0]).toBeTruthy();
		expect(keys[1]).toBeTruthy();
		expect(keys[1]).not.toBe(keys[0]);
	});
});

test.describe('shopping mutation regression', () => {
	type CachedShoppingResponse = ShoppingCreateReplayResponse;

	type State = {
		item: ShoppingItem | null;
		insertCount: number;
		response: CachedShoppingResponse | null;
		claimHeld: boolean;
	};

	function createReservation() {
		let resolveWaiter!: (response: ShoppingCreateReplayResponse) => void;
		let rejectWaiter!: (reason: unknown) => void;
		const promise = new Promise<ShoppingCreateReplayResponse>((resolve, reject) => {
			resolveWaiter = resolve;
			rejectWaiter = reject;
		});
		promise.catch(() => undefined);
		return {
			reservation: {
				owned: true as const,
				resolve: resolveWaiter,
				reject: rejectWaiter,
			},
			waiter: promise,
		};
	}

	const item: ShoppingItem = {
		id: 'shopping-1',
		wgId: '11111111-1111-4111-8111-111111111111',
		addedByMemberId: '22222222-2222-4222-8222-222222222222',
		name: 'Kaffee',
		normalizedName: 'kaffee',
		quantity: null,
		boughtAt: null,
		boughtByMemberId: null,
		createdAt: new Date('2026-09-23T10:00:00.000Z'),
		updatedAt: new Date('2026-09-23T10:00:00.000Z'),
	};

	const input: ShoppingCreateInput = {
		wgId: item.wgId,
		addedByMemberId: item.addedByMemberId,
		name: item.name,
		quantity: null,
		bought: false,
		replay: {
			scope: 'shopping-create:wg:member',
			key: 'same-key',
			leaseExpiresAt: new Date(Date.now() + 15 * 60_000),
		},
	};

	function createTransaction(state: State, returnItem = true): DbTransaction {
		const insert = (table: unknown) => {
			if (table === shoppingItems) {
				return {
					values: () => ({
						returning: async () => {
							state.insertCount += 1;
							if (!returnItem) return [];
							state.item = item;
							return [item];
						},
					}),
				};
			}
			throw new Error('unexpected table');
		};
		const update = (table: unknown) => {
			let values: { responseBody: CachedShoppingResponse } | null = null;
			const query = {
				set(nextValues: { responseBody: CachedShoppingResponse }) {
					values = nextValues;
					return query;
				},
				where() {
					return query;
				},
				returning: async () => {
					if (table !== idempotencyResponses || !state.claimHeld || !values) return [];
					state.response = values.responseBody;
					return [{ key: input.replay?.key ?? 'same-key' }];
				},
			};
			return query;
		};
		return { insert, update } as unknown as DbTransaction;
	}

	function replayDependencies(state: State): ReplaySlotDependencies<ShoppingCreateReplayResponse> {
		return {
			claim: async () => {
				if (state.claimHeld) return false;
				state.claimHeld = true;
				return true;
			},
			read: async () => state.response,
			sleep: async () => undefined,
		};
	}

	test('shopping create persists a replayable item response in the same transaction', async () => {
		const state: State = { item: null, insertCount: 0, response: null, claimHeld: true };
		const tx = createTransaction(state);

		await expect(insertShoppingItemWithReplay(tx, input)).resolves.toEqual(item);
		expect(state.response).toMatchObject({
			status: 200,
			body: { item: { id: 'shopping-1' }, warning: 'notification_delivery_unknown' },
		});
		expect(state.insertCount).toBe(1);
	});

	test('shopping create does not cache a response when no item is returned', async () => {
		const state: State = { item: null, insertCount: 0, response: null, claimHeld: false };
		await expect(
			insertShoppingItemWithReplay(createTransaction(state, false), input),
		).resolves.toBe(undefined);
		expect(state.response).toBeNull();
	});

	test('replays legacy successful shopping cache rows during the response-envelope rollout', () => {
		const legacyItem = JSON.parse(JSON.stringify(item));
		expect(
			normalizeShoppingCreateReplayResponse({
				item: legacyItem,
				warning: null,
			}),
		).toEqual({
			status: 200,
			body: { item: legacyItem, warning: null },
		});
		expect(normalizeShoppingCreateReplayResponse({ status: 201, body: {} })).toBeNull();
	});

	test('rejects malformed cached shopping success instead of replaying it as a saved item', () => {
		const serializedItem = JSON.parse(JSON.stringify(item));
		for (const malformedItem of [
			null,
			'shopping-1',
			{ id: 'shopping-1' },
			{ ...serializedItem, createdAt: null },
		]) {
			expect(
				normalizeShoppingCreateReplayResponse({
					status: 200,
					body: { item: malformedItem, warning: null },
				}),
			).toBeNull();
			expect(
				normalizeShoppingCreateReplayResponse({ item: malformedItem, warning: null }),
			).toBeNull();
		}
	});

	test('invalid persisted replay releases local waiters instead of leaving them pending', async () => {
		const local = createReservation();

		expect(
			normalizeShoppingCreateReplayOrReject({ status: 201, body: {} }, local.reservation),
		).toBeNull();
		await expect(local.waiter).rejects.toMatchObject({ message: 'idempotency_response_pending' });
	});

	test('same-key duplicate responses reach local waiters and cross-process replays as 409', async () => {
		const local = createReservation();
		resolveShoppingCreateReplay(local.reservation, SHOPPING_CREATE_DUPLICATE_RESPONSE);
		await expect(local.waiter).resolves.toEqual(SHOPPING_CREATE_DUPLICATE_RESPONSE);
		const localHttpResponse = shoppingCreateHttpResponse(SHOPPING_CREATE_DUPLICATE_RESPONSE);
		expect(localHttpResponse.status).toBe(409);
		await expect(localHttpResponse.json()).resolves.toEqual({ error: 'shopping_item_duplicate' });

		const state: State = { item: null, insertCount: 0, response: null, claimHeld: true };
		await expect(
			persistShoppingCreateReplayResponse(
				createTransaction(state),
				'shopping-create:wg:member',
				'same-key',
				SHOPPING_CREATE_DUPLICATE_RESPONSE,
				new Date(Date.now() + 15 * 60_000),
			),
		).resolves.toBe(true);
		const crossProcessRetry = await claimReplaySlot(
			'shopping-create:wg:member',
			'same-key',
			replayDependencies(state),
		);
		expect(crossProcessRetry).toEqual({
			won: false,
			cached: SHOPPING_CREATE_DUPLICATE_RESPONSE,
		});
		if (!crossProcessRetry.won) {
			const crossProcessHttpResponse = shoppingCreateHttpResponse(crossProcessRetry.cached);
			expect(crossProcessHttpResponse.status).toBe(409);
		}
	});

	test('known rollback releases the claim; unknown commit outcome keeps it fail-closed', async () => {
		const rollbackState: State = { item: null, insertCount: 0, response: null, claimHeld: false };
		const rollbackDependencies = replayDependencies(rollbackState);
		await expect(
			claimReplaySlot('shopping-create:wg:member', 'same-key', rollbackDependencies),
		).resolves.toEqual({ won: true });
		const rollbackReservation = createReservation().reservation;
		let rollbackReleaseCount = 0;
		const rolledBack = await handleShoppingCreateTransactionFailure(
			rollbackReservation,
			new ShoppingCreateTransactionRollback(new Error('query failed before commit')),
			async () => {
				rollbackReleaseCount += 1;
				rollbackState.claimHeld = false;
				return true;
			},
		);
		expect(rolledBack).toBe('rolled_back');
		expect(rollbackReleaseCount).toBe(1);
		await expect(
			claimReplaySlot('shopping-create:wg:member', 'same-key', rollbackDependencies),
		).resolves.toEqual({ won: true });

		const unknownState: State = { item: null, insertCount: 0, response: null, claimHeld: false };
		const unknownDependencies = replayDependencies(unknownState);
		await expect(
			claimReplaySlot('shopping-create:wg:member', 'same-key', unknownDependencies),
		).resolves.toEqual({ won: true });
		const unknownReservation = createReservation().reservation;
		let unknownReleaseCount = 0;
		const unknown = await handleShoppingCreateTransactionFailure(
			unknownReservation,
			new Error('connection dropped during commit'),
			async () => {
				unknownReleaseCount += 1;
				unknownState.claimHeld = false;
				return true;
			},
		);
		expect(unknown).toBe('unknown_commit');
		expect(unknownReleaseCount).toBe(0);
		await expect(
			claimReplaySlot('shopping-create:wg:member', 'same-key', unknownDependencies),
		).rejects.toMatchObject({ message: 'idempotency_response_pending' });
	});

	test('post-commit side-effect failure returns the durable response to owner and waiter', async () => {
		const local = createReservation();
		const provisional: ShoppingCreateReplayResponse = {
			status: 200,
			body: { item, warning: 'notification_delivery_unknown' },
		};
		resolveShoppingCreateReplay(local.reservation, provisional);
		let sanitizedFailureLogs = 0;
		const owner = await withShoppingCreatePostCommitFallback(
			provisional,
			async () => {
				throw new Error('private notification payload must not be logged');
			},
			() => {
				sanitizedFailureLogs += 1;
			},
		);
		const waiter = await local.waiter;
		const ownerResponse = shoppingCreateHttpResponse(owner);
		const waiterResponse = shoppingCreateHttpResponse(waiter);
		const [ownerBody, waiterBody] = await Promise.all([
			ownerResponse.json(),
			waiterResponse.json(),
		]);
		expect(ownerResponse.status).toBe(200);
		expect(waiterResponse.status).toBe(200);
		expect(waiterBody).toEqual(ownerBody);
		expect(owner).toEqual(provisional);
		expect(sanitizedFailureLogs).toBe(1);
	});

	test('duplicate stays retryable unless its replay is persisted or claim cleanup succeeds', async () => {
		const cleanupSuccess = createReservation();
		let cleanupCalls = 0;
		const duplicate = await finalizeShoppingCreateDuplicateReplay(cleanupSuccess.reservation, {
			persist: async () => false,
			read: async () => null,
			release: async () => {
				cleanupCalls += 1;
				return true;
			},
		});
		await expect(cleanupSuccess.waiter).resolves.toEqual(SHOPPING_CREATE_DUPLICATE_RESPONSE);
		expect(duplicate).toEqual(SHOPPING_CREATE_DUPLICATE_RESPONSE);
		expect(cleanupCalls).toBe(1);

		const cleanupFailure = createReservation();
		const failed = await finalizeShoppingCreateDuplicateReplay(cleanupFailure.reservation, {
			persist: async () => {
				throw new Error('cache write unavailable');
			},
			read: async () => null,
			release: async () => false,
		});
		expect(failed).toBeNull();
		await expect(cleanupFailure.waiter).rejects.toMatchObject({
			message: 'idempotency_response_pending',
		});
	});
});

test.describe('haushalt shopping checkbox hitarea', () => {
	// Regression for a <44px touch target: ShoppingItemRow's checkbox grows its hit
	// area with an invisible `after:-inset-2.5` pseudo-element, but the swipe-to-toggle
	// row wraps everything in an <li> with `overflow-hidden`. Since the checkbox sits
	// flush against the row's left edge (Item used px-0), any leftward hit-area
	// extension used to get clipped by that overflow-hidden, leaving an effective
	// ~34px target. Fix: `overflow-hidden` only applies while a swipe is in progress.
	test('shopping item checkbox keeps its full hit area when not swiping', async ({ page }) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);
		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			if (route.request().method() !== 'GET') {
				await route.continue();
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					items: [
						{
							id: 'hitarea-item',
							name: 'Milch',
							quantity: null,
							addedByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
							boughtAt: null,
							boughtByMemberId: null,
							createdAt: new Date().toISOString(),
						},
					],
				}),
			});
		});
		await setupMember(page);
		await navigateToFeature(page, '/wg/MTE8PZAT/einkauf');
		await dismissOnboarding(page);

		const checkbox = page.getByRole('checkbox', { name: 'Milch erledigen' });
		await expect(checkbox).toBeVisible();

		const li = page.locator('li:has(> :has([aria-label="Milch erledigen"]))').first();
		const overflow = await li.evaluate((el) => getComputedStyle(el).overflow);
		expect(overflow).not.toBe('hidden');

		// A point 5px to the left of the checkbox's own box sits inside the invisible
		// after:-inset-2.5 hit area (10px). It must still resolve to the checkbox, not
		// get clipped by an ancestor.
		const box = await checkbox.boundingBox();
		if (!box) throw new Error('checkbox has no bounding box');
		const hitTarget = await page.evaluate(
			({ x, y }) => {
				const el = document.elementFromPoint(x, y);
				return el?.closest('[data-slot="checkbox"]') !== null;
			},
			{ x: Math.max(0, box.x - 5), y: box.y + box.height / 2 },
		);
		expect(hitTarget).toBe(true);
	});
});

test.describe('haushalt shopping swipe pointer capture', () => {
	// Regression: ShoppingItemRow drives its swipe-to-toggle gesture with raw
	// pointer events but used to never capture the pointer. Unlike touch events,
	// pointer events retarget to whatever element sits under the finger at each
	// point, so a fast/diagonal swipe that drifted off the row before lift-off
	// meant onPointerUp (which resets swipeX and completes the toggle) never
	// fired on that row, leaving it visually stuck mid-swipe. Fixed by calling
	// setPointerCapture on pointerdown so move/up stay targeted at the row for
	// the whole gesture, matching touch-event semantics.
	test('shopping row captures the pointer when a touch swipe starts', async ({ page }) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);
		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			if (route.request().method() !== 'GET') {
				await route.continue();
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					items: [
						{
							id: 'capture-item',
							name: 'Milch',
							quantity: null,
							addedByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
							boughtAt: null,
							boughtByMemberId: null,
							createdAt: new Date().toISOString(),
						},
					],
				}),
			});
		});
		await setupMember(page);
		await navigateToFeature(page, '/wg/MTE8PZAT/einkauf');
		await dismissOnboarding(page);

		const row = page.locator('[data-shopping-row]').first();
		await expect(row).toBeVisible();

		const capturedPointerId = await row.evaluate((el) => {
			let seen: number | null = null;
			const original = el.setPointerCapture.bind(el);
			el.setPointerCapture = (pointerId: number) => {
				seen = pointerId;
				return original(pointerId);
			};
			const box = el.getBoundingClientRect();
			el.dispatchEvent(
				new PointerEvent('pointerdown', {
					bubbles: true,
					pointerId: 7,
					pointerType: 'touch',
					clientX: box.x + 10,
					clientY: box.y + box.height / 2,
				}),
			);
			return seen;
		});

		expect(capturedPointerId).toBe(7);
	});
});

test.describe('shopping conflict handling', () => {
	const testDatabaseUrl = process.env.PILOT_SHOPPING_DATABASE_URL?.trim() ?? '';

	type FixtureShoppingItem = {
		id: string;
		addedByMemberId: string;
		name: string;
		quantity: string | null;
		boughtAt: string | null;
		boughtByMemberId: string | null;
		createdAt: string;
		updatedAt: string;
	};

	function localTestDatabaseUrl(): string {
		if (!testDatabaseUrl) {
			test.skip(true, 'Set PILOT_SHOPPING_DATABASE_URL to an isolated local PostgreSQL database.');
		}
		const hostname = new URL(testDatabaseUrl).hostname.toLowerCase();
		expect(['localhost', '127.0.0.1', '::1']).toContain(hostname);
		return testDatabaseUrl;
	}

	test('recognizes a duplicate open shopping item through DrizzleQueryError.cause', () => {
		const postgresError = Object.assign(
			new Error('duplicate key value violates unique constraint'),
			{
				code: '23505',
				constraint: 'shopping_items_unique_open_name',
			},
		);
		const wrapped = new DrizzleQueryError('insert into shopping_items ...', [], postgresError);

		expect(isOpenShoppingItemDuplicate(wrapped)).toBe(true);
	});

	async function mockShoppingPage(
		page: Page,
		viewerIsAdmin: boolean,
		deleteStatus = 200,
		items: FixtureShoppingItem[] = [
			{
				id: 'shopping-done',
				addedByMemberId: FIXTURE_WG.memberId,
				name: 'Kaffee',
				quantity: null,
				boughtAt: '2026-09-22T12:00:00.000Z',
				boughtByMemberId: FIXTURE_WG.memberId,
				createdAt: '2026-09-22T10:00:00.000Z',
				updatedAt: '2026-09-22T12:00:00.000Z',
			},
		],
		conflictOnPatch = false,
	) {
		const { shareCode, memberId, memberName } = FIXTURE_WG;
		let getCalls = 0;
		await page.route(`**/api/wg/${shareCode}/members*`, (route) =>
			route.fulfill({
				json: {
					members: [{ id: memberId, name: memberName, active: true }],
					viewerIsAdmin,
				},
			}),
		);
		await page.route(
			new RegExp(`/api/wg/${shareCode}/shopping(?:/[^/?]+)?(?:\\?.*)?$`),
			(route) => {
				const method = route.request().method();
				if (method === 'DELETE') {
					return route.fulfill({
						status: deleteStatus,
						json: deleteStatus === 200 ? { deleted: 1 } : { error: 'not_admin' },
					});
				}
				if (method === 'PATCH' && conflictOnPatch) {
					return route.fulfill({ status: 409, json: { error: 'shopping_item_duplicate' } });
				}
				if (method === 'GET') getCalls += 1;
				return route.fulfill({ json: { items } });
			},
		);
		await page.route(`**/api/wg/${shareCode}/inventory*`, (route) =>
			route.fulfill({ json: { items: [] } }),
		);
		return { getCalls: () => getCalls };
	}

	test('hides clearing bought items from non-admins', async ({ page }) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);
		await mockShoppingPage(page, false);
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einkauf`);
		await dismissOnboarding(page);
		await page.getByText('Erledigt (1)', { exact: true }).click();
		await expect(page.getByRole('button', { name: 'Erledigte Artikel entfernen (1)' })).toHaveCount(
			0,
		);
	});

	test('keeps an item removal pending until the server answers, then clears it on failure and success', async ({
		page,
	}) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);
		const { shareCode, memberId } = FIXTURE_WG;
		const item: FixtureShoppingItem = {
			id: 'shopping-milk',
			addedByMemberId: memberId,
			name: 'Milch',
			quantity: null,
			boughtAt: null,
			boughtByMemberId: null,
			createdAt: '2026-09-22T10:00:00.000Z',
			updatedAt: '2026-09-22T10:00:00.000Z',
		};
		// Dasselbe Array speist das Mock-GET: nach dem erfolgreichen DELETE liefert der
		// „Server“ den Artikel nicht mehr, wie in echt beim Neuladen nach dem Entfernen.
		const serverItems = [item];
		await mockShoppingPage(page, false, 200, serverItems);
		let deletes = 0;
		let releaseDelete: () => void = () => {};
		const deleteGate = new Promise<void>((resolve) => {
			releaseDelete = resolve;
		});
		await page.route(
			new RegExp(`/api/wg/${shareCode}/shopping/${item.id}(?:\\?.*)?$`),
			async (route) => {
				if (route.request().method() !== 'DELETE') return route.fallback();
				deletes += 1;
				if (deletes === 1) {
					await deleteGate;
					return route.fulfill({ status: 500, json: { error: 'server_error' } });
				}
				serverItems.length = 0;
				return route.fulfill({ json: { deleted: 1 } });
			},
		);
		await setupMember(page);
		await navigateToFeature(page, `/wg/${shareCode}/einkauf`);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: 'Artikelaktionen: Milch' }).click();
		const remove = page.getByRole('button', { name: /entfernen: Milch$/ });
		const confirmRemove = page.getByRole('button', { name: 'Endgültig entfernen: Milch' });
		// Erster Tipp schärft, zweiter bestätigt; erst klicken, wenn der Bestätigungszustand steht.
		await remove.click();
		await confirmRemove.click();
		await expect(remove).toBeDisabled();
		releaseDelete();

		await expect(remove).toBeEnabled();
		expect(deletes).toBe(1);
		await remove.click();
		await confirmRemove.click();
		// Der Request-Zähler läuft im Route-Handler, also asynchron zum Klick.
		await expect.poll(() => deletes).toBe(2);
		await expect(page.getByRole('button', { name: 'Artikelaktionen: Milch' })).toHaveCount(0);
	});

	test('explains the admin requirement when clear-bought returns 403', async ({ page }) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);
		await mockShoppingPage(page, true, 403);
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einkauf`);
		await dismissOnboarding(page);
		await page.getByText('Erledigt (1)', { exact: true }).click();
		await page.getByRole('button', { name: 'Erledigte Artikel entfernen (1)' }).click();
		await page.getByRole('button', { name: 'Entfernen', exact: true }).click();
		await expect(
			page.getByText('Nur Admins dürfen erledigte Artikel für die ganze WG entfernen.'),
		).toBeVisible();
	});

	test('refreshes the list after a duplicate add and keeps the draft values', async ({ page }) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);
		const shareCode = 'MTE8PZAT';
		let getCalls = 0;
		let postCalls = 0;
		await page.route(`**/api/wg/${shareCode}/shopping*`, async (route) => {
			if (route.request().method() === 'GET') {
				getCalls += 1;
				return route.fulfill({
					json: {
						items:
							getCalls > 1
								? [
										{
											id: 'shopping-existing',
											addedByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
											name: 'Milch',
											quantity: '1 L',
											boughtAt: null,
											boughtByMemberId: null,
											createdAt: '2026-09-21T08:00:00.000Z',
											updatedAt: '2026-09-21T08:00:00.000Z',
										},
									]
								: [],
					},
				});
			}
			if (route.request().method() === 'POST') {
				postCalls += 1;
				return route.fulfill({ status: 409, json: { error: 'shopping_item_duplicate' } });
			}
			return route.continue();
		});

		await setupMember(page);
		await navigateToFeature(page, `/wg/${shareCode}/einkauf`);
		await dismissOnboarding(page);
		await page.getByLabel('Artikel-Name').fill('2 L Milch');
		await page.getByRole('button', { name: 'Artikel hinzufügen' }).click();

		await expect(
			page.getByText(
				'Dieser Artikel steht bereits offen auf der Einkaufsliste. Prüfe den vorhandenen Eintrag; seine Menge bleibt unverändert.',
			),
		).toBeVisible();
		await expect(page.locator('[data-shopping-row]')).toHaveCount(1);
		await expect(page.locator('[data-shopping-row]')).toContainText('Milch');
		await expect(page.getByLabel('Artikel-Name')).toHaveValue('2 L Milch');
		expect(postCalls).toBe(1);
		expect(getCalls).toBeGreaterThanOrEqual(2);
	});

	test('adds and checks items instantly, then rolls a failed add back with a footer error', async ({
		page,
	}) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);
		const shareCode = 'MTE8PZAT';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let releaseCreate: (() => void) | undefined;
		const createGate = new Promise<void>((resolve) => {
			releaseCreate = resolve;
		});
		let failNext = false;
		let created = false;
		const realItem = {
			id: 'shopping-real',
			addedByMemberId: memberId,
			name: 'Hafermilch',
			quantity: null,
			boughtAt: null,
			boughtByMemberId: null,
			createdAt: '2026-09-21T08:00:00.000Z',
			updatedAt: '2026-09-21T08:00:00.000Z',
		};
		await page.route(`**/api/wg/${shareCode}/shopping`, async (route) => {
			if (route.request().method() === 'GET') {
				return route.fulfill({ json: { items: created ? [realItem] : [] } });
			}
			if (route.request().method() !== 'POST') return route.continue();
			if (failNext) return route.fulfill({ status: 500, json: { error: 'internal' } });
			await createGate;
			created = true;
			return route.fulfill({ json: { item: realItem } });
		});

		await setupMember(page);
		await navigateToFeature(page, `/wg/${shareCode}/einkauf`);
		await dismissOnboarding(page);
		await page.getByLabel('Artikel-Name').fill('Hafermilch');
		await page.getByRole('button', { name: 'Artikel hinzufügen' }).click();

		// Die Zeile steht da, bevor der Server geantwortet hat; der Haken ist noch gesperrt.
		await expect(page.locator('[data-shopping-row]')).toHaveCount(1);
		await expect(page.locator('[data-shopping-row]')).toContainText('Hafermilch');
		releaseCreate?.();
		await expect(page.locator('[data-shopping-row]#shopping-shopping-real')).toHaveCount(1);
		await expect(page.locator('[data-shopping-row]')).toHaveCount(1);

		failNext = true;
		await page.getByLabel('Artikel-Name').fill('Brot');
		await page.getByRole('button', { name: 'Artikel hinzufügen' }).click();
		await expect(page.locator('#shopping-add-error')).toBeVisible();
		await expect(page.locator('[data-shopping-row]')).toHaveCount(1);
		await expect(page.getByLabel('Artikel-Name')).toHaveValue('Brot');
	});

	test('reopening a bought duplicate restores both items and explains the conflict at 320px', async ({
		page,
	}) => {
		test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');
		const { memberId } = FIXTURE_WG;
		const items: FixtureShoppingItem[] = [
			{
				id: '11111111-1111-4111-8111-111111111111',
				addedByMemberId: memberId,
				name: 'Milch',
				quantity: '1 L',
				boughtAt: '2026-09-22T12:00:00.000Z',
				boughtByMemberId: memberId,
				createdAt: '2026-09-22T10:00:00.000Z',
				updatedAt: '2026-09-22T12:00:00.000Z',
			},
			{
				id: '22222222-2222-4222-8222-222222222222',
				addedByMemberId: memberId,
				name: 'Milch',
				quantity: '2 L',
				boughtAt: null,
				boughtByMemberId: null,
				createdAt: '2026-09-23T10:00:00.000Z',
				updatedAt: '2026-09-23T10:00:00.000Z',
			},
		];
		const { getCalls } = await mockShoppingPage(page, true, 200, items, true);
		const conflictMessage =
			'Dieser Artikel steht bereits offen auf der Einkaufsliste. Prüfe den vorhandenen Eintrag; seine Menge bleibt unverändert.';

		await page.setViewportSize({ width: 320, height: 800 });
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einkauf`);
		await dismissOnboarding(page);
		await page.getByText('Erledigt (1)', { exact: true }).click();
		const getCallsBeforeReopen = getCalls();
		await page.getByRole('checkbox', { name: 'Milch wieder öffnen', exact: true }).click();

		await expect(page.getByText(conflictMessage, { exact: true })).toBeVisible();
		await expect(page.locator('[data-shopping-row]')).toHaveCount(2);
		await expect(
			page.getByRole('checkbox', { name: 'Milch wieder öffnen', exact: true }),
		).toBeChecked();
		await expect(
			page.getByRole('checkbox', { name: 'Milch erledigen', exact: true }),
		).not.toBeChecked();
		expect(getCalls()).toBeGreaterThan(getCallsBeforeReopen);
		await page.emulateMedia({ colorScheme: 'dark' });
		await expect(page.getByText(conflictMessage, { exact: true })).toBeVisible();
	});

	test('real PostgreSQL partial unique index rejects open duplicates and allows repurchase', async () => {
		const pool = new Pool({ connectionString: localTestDatabaseUrl(), max: 1 });
		const database = drizzle(pool, { schema });
		const suffix = randomUUID().replaceAll('-', '');
		let wgId = '';
		let secondWgId = '';
		const name = `Pilot shopping ${suffix}`;
		const normalizedVariant = `  ${name.toUpperCase()}  `;

		try {
			const wg = await pool.query<{ id: string }>(
				'INSERT INTO public.wgs (share_code, name) VALUES ($1, $2) RETURNING id',
				[`P${suffix.slice(0, 7)}`, `Pilot shopping ${suffix}`],
			);
			wgId = wg.rows[0]?.id ?? '';
			expect(wgId).toBeTruthy();
			const secondWg = await pool.query<{ id: string }>(
				'INSERT INTO public.wgs (share_code, name) VALUES ($1, $2) RETURNING id',
				[`Q${suffix.slice(0, 7)}`, `Pilot shopping second ${suffix}`],
			);
			secondWgId = secondWg.rows[0]?.id ?? '';
			expect(secondWgId).toBeTruthy();

			const member = await pool.query<{ id: string }>(
				'INSERT INTO public.wg_members (wg_id, name) VALUES ($1, $2) RETURNING id',
				[wgId, `Pilot member ${suffix}`],
			);
			const memberId = member.rows[0]?.id ?? '';
			expect(memberId).toBeTruthy();
			const secondMember = await pool.query<{ id: string }>(
				'INSERT INTO public.wg_members (wg_id, name) VALUES ($1, $2) RETURNING id',
				[secondWgId, `Pilot second member ${suffix}`],
			);
			const secondMemberId = secondMember.rows[0]?.id ?? '';
			expect(secondMemberId).toBeTruthy();

			const first = await database
				.insert(schema.shoppingItems)
				.values({ wgId, addedByMemberId: memberId, name, quantity: '1x' })
				.returning({ id: schema.shoppingItems.id });
			expect(first).toHaveLength(1);

			let duplicateError: unknown;
			try {
				await database
					.insert(schema.shoppingItems)
					.values({ wgId, addedByMemberId: memberId, name: normalizedVariant, quantity: '2x' })
					.returning({ id: schema.shoppingItems.id });
			} catch (error) {
				duplicateError = error;
			}
			expect(duplicateError).toBeInstanceOf(DrizzleQueryError);
			expect(duplicateError).toMatchObject({
				cause: { code: '23505', constraint: 'shopping_items_unique_open_name' },
			});
			expect(isOpenShoppingItemDuplicate(duplicateError)).toBe(true);

			await pool.query(
				'UPDATE public.shopping_items SET bought_at = now(), bought_by_member_id = $2 WHERE id = $1',
				[first[0]?.id, memberId],
			);
			const repurchase = await database
				.insert(schema.shoppingItems)
				.values({ wgId, addedByMemberId: memberId, name: normalizedVariant, quantity: '2x' })
				.returning({ id: schema.shoppingItems.id });
			expect(repurchase).toHaveLength(1);

			const otherWgItem = await database
				.insert(schema.shoppingItems)
				.values({
					wgId: secondWgId,
					addedByMemberId: secondMemberId,
					name: normalizedVariant,
					quantity: '1x',
				})
				.returning({ id: schema.shoppingItems.id });
			expect(otherWgItem).toHaveLength(1);

			const rows = await pool.query<{ count: number }>(
				' SELECT count(*)::int AS count FROM public.shopping_items WHERE wg_id = $1 AND normalized_name = lower(btrim($2))',
				[wgId, name],
			);
			expect(rows.rows[0]?.count).toBe(2);
		} finally {
			if (wgId) await pool.query('DELETE FROM public.wgs WHERE id = $1', [wgId]);
			if (secondWgId) await pool.query('DELETE FROM public.wgs WHERE id = $1', [secondWgId]);
			await pool.end();
		}
	});

	test('wraps quick shopping suggestions at phone widths and large text', async ({ page }) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);

		const { shareCode, memberId, memberName } = FIXTURE_WG;
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/members*`, (route) =>
			route.fulfill({
				json: {
					members: [{ id: memberId, name: memberName, active: true }],
					viewerIsAdmin: false,
				},
			}),
		);
		let shoppingPostCount = 0;
		await page.route(`**/api/wg/${shareCode}/shopping*`, (route) => {
			if (route.request().method() === 'POST') shoppingPostCount += 1;
			return route.fulfill({ json: { items: [] } });
		});
		await page.route(`**/api/wg/${shareCode}/inventory*`, (route) =>
			route.fulfill({ json: { items: [] } }),
		);
		await navigateToFeature(page, `/wg/${shareCode}/einkauf`);
		await dismissOnboarding(page);

		const suggestions = page.locator('ul[aria-label="Vorschläge"]');
		await expect(suggestions).toBeVisible();
		expect(await suggestions.locator('button').count()).toBeGreaterThan(1);
		const assertSuggestionsFit = async (
			width: number,
			colorScheme: 'light' | 'dark',
			fontSize: number,
		) => {
			await page.setViewportSize({ width, height: 812 });
			await page.emulateMedia({ colorScheme });
			await expect
				.poll(() => page.locator('html').evaluate((html) => html.classList.contains('dark')))
				.toBe(colorScheme === 'dark');
			const state = await page.evaluate(() => ({
				viewport: document.documentElement.clientWidth,
				scroll: document.documentElement.scrollWidth,
				fontSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
			}));
			expect(state.scroll).toBeLessThanOrEqual(state.viewport);
			expect(state.fontSize).toBe(fontSize);
			const geometry = await suggestions.evaluate((list) => {
				const bounds = list.getBoundingClientRect();
				return {
					clientWidth: list.clientWidth,
					scrollWidth: list.scrollWidth,
					left: bounds.left,
					right: bounds.right,
					items: Array.from(list.children).map((item) => {
						const rect = item.getBoundingClientRect();
						return { left: rect.left, right: rect.right };
					}),
				};
			});
			expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
			expect(
				geometry.items.every(
					(item) => item.left >= geometry.left - 1 && item.right <= geometry.right + 1,
				),
			).toBe(true);
		};
		for (const width of [320, 360]) {
			await page.setViewportSize({ width, height: 812 });
			const baseFontSize = await page.evaluate(() =>
				Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
			);
			for (const colorScheme of ['light', 'dark'] as const) {
				await assertSuggestionsFit(width, colorScheme, baseFontSize);
			}
		}

		await page.route('**/__e2e-font-scale-200.css', (route) =>
			route.fulfill({ contentType: 'text/css', body: ':root { font-size: 32px !important; }' }),
		);
		await page.addStyleTag({
			url: new URL('/__e2e-font-scale-200.css', page.url()).toString(),
		});
		await page.setViewportSize({ width: 320, height: 812 });
		await page.emulateMedia({ colorScheme: 'light' });
		const suggestionButtons = suggestions.locator('button');
		const pointerTarget = suggestionButtons.nth(1);
		// Arrange the same partial overlap from the rendered geometry.
		const overlapViewportHeight = await pointerTarget.evaluate((button) => {
			const action = document.querySelector('[data-page-primary-action]');
			if (!action) throw new Error('Expected the fixed shopping action');
			const buttonRect = button.getBoundingClientRect();
			return Math.round(
				window.innerHeight +
					buttonRect.top +
					buttonRect.height / 2 -
					action.getBoundingClientRect().top,
			);
		});
		await page.setViewportSize({ width: 320, height: overlapViewportHeight });
		const pointerPoint = await pointerTarget.evaluate((button) => {
			const action = document.querySelector('[data-page-primary-action]');
			if (!action) throw new Error('Expected the fixed shopping action');
			const buttonRect = button.getBoundingClientRect();
			const actionRect = action.getBoundingClientRect();
			return {
				x: buttonRect.left + buttonRect.width / 2,
				y: Math.min(buttonRect.bottom, actionRect.top) - 2,
				buttonTop: buttonRect.top,
				buttonBottom: buttonRect.bottom,
				actionTop: actionRect.top,
			};
		});
		expect(pointerPoint.buttonBottom).toBeGreaterThan(pointerPoint.actionTop);
		const pointerHitsSuggestion = await pointerTarget.evaluate((button, point) => {
			const hit = document.elementFromPoint(point.x, point.y);
			return Boolean(hit && button.contains(hit));
		}, pointerPoint);
		expect(pointerHitsSuggestion).toBe(true);
		await page.mouse.click(pointerPoint.x, pointerPoint.y);
		await expect.poll(() => shoppingPostCount).toBe(1);
		await expect
			.poll(() => pointerTarget.evaluate((button) => button.getBoundingClientRect().top))
			.toBe(pointerPoint.buttonTop);

		await suggestionButtons.first().focus();
		for (let index = 0; index < (await suggestionButtons.count()); index += 1) {
			if (index > 0) await page.keyboard.press('Tab');
			const button = suggestionButtons.nth(index);
			await expect(button).toBeFocused();
			await expect
				.poll(
					() =>
						button.evaluate((element) => {
							const action = document.querySelector('[data-page-primary-action]');
							if (!action) throw new Error('Expected the fixed shopping action');
							return element.getBoundingClientRect().bottom - action.getBoundingClientRect().top;
						}),
					{ timeout: 3_000 },
				)
				.toBeLessThan(0);
		}
		for (const width of [320, 360]) {
			for (const colorScheme of ['light', 'dark'] as const) {
				await assertSuggestionsFit(width, colorScheme, 32);
			}
		}
	});
});

test.describe('household list UI', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	const shareCode = FIXTURE_WG.shareCode;
	const memberId = FIXTURE_WG.memberId;

	test('shopping remove button names the item and the armed confirm state', async ({ page }) => {
		const itemName = 'Milch';
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/shopping`, (route) =>
			route.fulfill({
				json: {
					items: [
						{
							id: 'sh-1',
							addedByMemberId: memberId,
							name: itemName,
							quantity: null,
							boughtAt: null,
							boughtByMemberId: null,
							createdAt: new Date().toISOString(),
						},
					],
					members: { [memberId]: { name: FIXTURE_WG.memberName, color: null } },
				},
			}),
		);

		await navigateToFeature(page, `/wg/${shareCode}/einkauf`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: `Artikelaktionen: ${itemName}` }).click();
		const drawer = page.getByRole('dialog');
		await drawer.getByRole('button', { name: `Artikel entfernen: ${itemName}` }).click();
		// WCAG 2.5.3 — the visible "Milch" label must stay in the accessible name,
		// and the armed (confirm) state must be named distinctly from the initial one.
		await expect(
			drawer.getByRole('button', { name: `Endgültig entfernen: ${itemName}` }),
		).toBeVisible();
	});

	test('inventory + button applies the PATCH response without waiting for a follow-up refetch', async ({
		page,
	}) => {
		const items = [
			{
				id: 'inv-1',
				wgId: FIXTURE_WG.id,
				name: 'Spülmittel',
				quantity: 5,
				unit: 'Stück',
				threshold: 1,
				category: 'putzmittel',
				decrementCount30d: 0,
				lastDecrementedAt: null,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			},
		];
		await setupMember(page);
		let getCount = 0;
		await page.route(`**/api/wg/${shareCode}/inventory`, async (route) => {
			getCount += 1;
			if (getCount > 1) {
				// The background re-sync fired after the mutation. Make it slow so a
				// regression that goes back to waiting on this GET (instead of the
				// PATCH response) would fail this test.
				await new Promise((resolve) => setTimeout(resolve, 1500));
			}
			return route.fulfill({ json: { items } });
		});
		await page.route(`**/api/wg/${shareCode}/inventory/inv-1`, (route) => {
			if (route.request().method() !== 'PATCH') return route.fallback();
			const updated = { ...items[0], quantity: 6 };
			return route.fulfill({ json: { item: updated } });
		});

		await navigateToFeature(page, `/wg/${shareCode}/vorraete`);
		await dismissOnboarding(page);
		const row = page.locator('[data-slot="item"]', { hasText: 'Spülmittel' });
		await row.getByRole('button', { name: 'Spülmittel um eins erhöhen' }).click();
		await expect(row).toContainText('6 Stück', { timeout: 600 });
	});
});
