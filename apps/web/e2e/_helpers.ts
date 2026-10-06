// Shared helpers for ManaWG Playwright happy-path E2E specs.
//
// All specs in this directory rely on the `MTE8PZAT` share-code WG, which is
// surfaced as a stable fixture in `apps/web/src/fixtures/data.ts` so that
// the WG layout renders without a real Postgres instance. Individual feature
// API endpoints are mocked per-test via `page.route()`.

import { type Page, expect } from '@playwright/test';

export const FIXTURE_WG = {
	id: '989ac820-58b7-431f-9c65-28721264f333',
	shareCode: 'MTE8PZAT',
	memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
	memberName: 'dsaf',
} as const;

/**
 * Pre-seeds the CI-only fixture identity so `WgContextProvider` can render the
 * requested feature page without a Supabase session.
 *
 * Flags blocked storage on `window` so `navigateToFeature` fails with a clear
 * cause instead of an opaque "identity not accepted" assertion later.
 */
export async function setupMember(page: Page): Promise<void> {
	await page.addInitScript(
		({ wgId, memberId, memberName }) => {
			try {
				localStorage.setItem(
					`manawg_identity:${wgId}`,
					JSON.stringify({ memberId, name: memberName, memberToken: 'fixture-member-token' }),
				);
				// Wipe any stale offline queue from previous specs.
				localStorage.removeItem('manawg:offline-actions');
			} catch {
				window.__manawgStorageBlocked = true;
				document.documentElement?.setAttribute('data-manawg-storage-blocked', 'true');
			}
		},
		{
			wgId: FIXTURE_WG.id,
			memberId: FIXTURE_WG.memberId,
			memberName: FIXTURE_WG.memberName,
		},
	);
}

/**
 * Navigates to a feature path with retry-on-cold-start so the first request
 * after Next dev boot does not flake the suite.
 */
export async function navigateToFeature(page: Page, path: string): Promise<void> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 120_000 });
			const storageBlocked = await page.evaluate(() => Boolean(window.__manawgStorageBlocked));
			if (storageBlocked) {
				throw new Error(
					'localStorage is blocked in this browser context (private mode?) — fixture identity was not written',
				);
			}
			const body = await page.locator('body').innerText();
			if (body.includes('Internal Server Error')) {
				throw new Error('Next dev server returned Internal Server Error');
			}
			if (body.includes('Seite nicht gefunden')) {
				throw new Error('not-found-during-warmup');
			}
			if (new URL(page.url()).pathname.startsWith('/neu')) {
				throw new Error(
					`redirected to login (${page.url()}) — fixture identity missing? run the fixtures lane, not the live lane`,
				);
			}
			return;
		} catch (err) {
			lastError = err;
			await page.waitForTimeout(1500);
		}
	}
	throw lastError;
}

/**
 * Fixture setup must not fall through to the production access-denied state.
 */
export async function dismissOnboarding(page: Page): Promise<void> {
	const accessDenied = page.getByRole('alert', {
		name: 'Du bist in dieser WG nicht (mehr) Mitglied, z. B. weil du ausgezogen bist oder entfernt wurdest.',
	});
	await expect(accessDenied)
		.toBeHidden({ timeout: 2_000 })
		.catch(() => {
			throw new Error('Fixture identity was not accepted — setupMember() must run first');
		});
}

/**
 * Mocks the chat unread badge request that every WG page fires. `base` is the
 * WG API prefix, e.g. `/api/wg/MTE8PZAT`; the default count keeps the badge hidden.
 */
export async function mockUnreadCount(page: Page, base: string, count = 0): Promise<void> {
	await page.route(`**${base}/chat/unread-count`, (route) =>
		route.fulfill({ status: 200, json: { count, overflow: false } }),
	);
}

/** Mocks the signed-in user's WG list as empty (entry/onboarding pages). */
export async function mockNoWgs(page: Page): Promise<void> {
	await page.route('**/api/wg/mine', (route) => route.fulfill({ status: 200, json: { wgs: [] } }));
}

/**
 * Minimal responsive matrix: 320px light at 100% text plus 320px dark at 200% text.
 * Wider widths and the other colour/scale combinations exercise the same CSS paths.
 */
export function inMinimalMatrix(c: { width: number; dark: boolean; large: boolean }): boolean {
	return c.width === 320 && c.dark === c.large;
}
