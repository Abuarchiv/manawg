// Request budget of a WG tab that stays in use while nothing changes (#1051).
// Why: every poll is one function run on the host. A quiet list page sent up to 8 requests a
// minute and a quiet chat about 10; a list page may send at most 2, and the chat slows down
// once nobody writes.

import { expect, type Page, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

const MINUTE = 60_000;

/** Counts the API requests the page sends from now on. */
function countApiRequests(page: Page): { paths: string[] } {
	const counter = { paths: [] as string[] };
	page.on('request', (request) => {
		const url = new URL(request.url());
		if (url.pathname.startsWith('/api/')) counter.paths.push(url.pathname);
	});
	return counter;
}

/**
 * Runs the fake clock in steps shorter than any poll period, so every request settles before the
 * next tick (a running request would absorb it) and reaches the counter.
 */
async function runClock(page: Page, ms: number): Promise<void> {
	for (let left = ms; left > 0; left -= 4_000) {
		await page.clock.runFor(Math.min(4_000, left));
		await page.waitForTimeout(150);
	}
}

async function openSettled(page: Page, path: string): Promise<void> {
	await page.clock.install({ time: new Date('2026-11-20T10:00:00.000Z') });
	await setupMember(page);
	await navigateToFeature(page, path);
	await dismissOnboarding(page);
	await page.waitForLoadState('networkidle');
}

test.describe('poll budget of a tab in use', () => {
	for (const feature of ['', '/expenses', '/shopping']) {
		test(`a quiet list page (${feature || 'home'}) sends at most 2 requests a minute`, async ({
			page,
		}) => {
			skipUnlessFixtures();
			await openSettled(page, `/wg/${FIXTURE_WG.shareCode}${feature}`);

			const counter = countApiRequests(page);
			await runClock(page, 2 * MINUTE);
			expect(counter.paths.length, counter.paths.join('\n')).toBeLessThanOrEqual(4);
		});
	}

	test('a quiet chat backs off to one poll per 30 s and speeds up again on input', async ({
		page,
	}) => {
		skipUnlessFixtures();
		const messagesPath = `/api/wg/${FIXTURE_WG.shareCode}/chat/messages`;
		await openSettled(page, `/wg/${FIXTURE_WG.shareCode}/chat`);

		// Two quiet minutes at the fast rate, then the slow rate starts.
		await runClock(page, 2 * MINUTE + 10_000);
		const counter = countApiRequests(page);
		await runClock(page, 2 * MINUTE);
		const chatPolls = counter.paths.filter((path) => path === messagesPath).length;
		expect(chatPolls, counter.paths.join('\n')).toBeLessThanOrEqual(5);
		expect(counter.paths.length, counter.paths.join('\n')).toBeLessThanOrEqual(10);

		// Typing brings the 8 s rate back.
		counter.paths.length = 0;
		await page.keyboard.press('Shift');
		await runClock(page, 20_000);
		expect(
			counter.paths.filter((path) => path === messagesPath).length,
			counter.paths.join('\n'),
		).toBeGreaterThanOrEqual(2);
	});
});
