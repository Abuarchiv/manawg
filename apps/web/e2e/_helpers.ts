// Shared helpers for ManaWG Playwright happy-path E2E specs.
//
// All specs in this directory rely on the `MTE8PZAT` share-code WG, which is
// surfaced as a stable fixture in `apps/web/src/core/infra/e2e-db-down.ts` so that
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
 * Pre-seeds the chosen identity in localStorage so `WgContextProvider` skips
 * the IdentityPicker overlay and renders the requested feature page directly.
 */
export async function setupMember(page: Page): Promise<void> {
	await page.addInitScript(
		({ wgId, memberId, memberName }) => {
			localStorage.setItem(
				`manawg_identity:${wgId}`,
				JSON.stringify({ memberId, name: memberName }),
			);
			// Wipe any stale offline queue from previous specs.
			localStorage.removeItem('manawg:offline-actions');
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
			const body = await page.locator('body').innerText();
			if (body.includes('Internal Server Error')) {
				throw new Error('Next dev server returned Internal Server Error');
			}
			if (body.includes('Seite nicht gefunden')) {
				throw new Error('not-found-during-warmup');
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
 * The IdentityPicker is suppressed by `setupMember`, but if it ever surfaces
 * (e.g. a localStorage write race in a future build) we still want a clear
 * failure rather than a timeout deep inside the feature assertions.
 */
export async function dismissOnboarding(page: Page): Promise<void> {
	const picker = page.getByRole('heading', { name: /Wer bist du/i });
	await expect(picker)
		.toBeHidden({ timeout: 2_000 })
		.catch(() => {
			throw new Error('IdentityPicker visible — setupMember() must run before navigateToFeature()');
		});
}
