import { expect, test } from '@playwright/test';
import { activityItemKey } from '../src/core/reads/activity';
import { detectMention } from '../src/features/chat/chat-pure';

test('date inputs round-trip the same calendar day in UTC+14', async () => {
	const previousTimezone = process.env.TZ;
	process.env.TZ = 'Pacific/Kiritimati';
	try {
		const { inputDateToIso } = await import('../src/core/utils/local-date');
		const date = new Date(inputDateToIso('2026-09-19'));
		const parts = Object.fromEntries(
			new Intl.DateTimeFormat('en', {
				timeZone: 'Pacific/Kiritimati',
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
			})
				.formatToParts(date)
				.map(({ type, value }) => [type, value]),
		);
		expect(`${parts.year}-${parts.month}-${parts.day}`).toBe('2026-09-19');
	} finally {
		if (previousTimezone === undefined) process.env.TZ = undefined;
		else process.env.TZ = previousTimezone;
	}
});

test('activity keys stay unique when rows have identical display text', () => {
	const item = {
		kind: 'audit',
		timestamp: '2026-09-19T10:00:00.000Z',
		memberName: 'Abu',
		text: 'hat etwas geändert',
	};

	expect(activityItemKey(item, 0)).not.toBe(activityItemKey(item, 1));
	expect(activityItemKey({ ...item, id: 'audit-1' }, 0)).toBe('audit-1');
});

test('mention autocomplete does not open for an isolated at-sign', () => {
	expect(detectMention('@', 1)).toBeNull();
	expect(detectMention('@ ', 1)).toBeNull();
	expect(detectMention('Hallo @M', 8)).toEqual({ query: 'M', startIndex: 6 });
});

test('theme changes received from another tab update the document class', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('manawg-theme', 'light'));
	await page.goto('/');
	await expect
		.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark')))
		.toBe(false);
	await page.evaluate(() => {
		window.dispatchEvent(
			new StorageEvent('storage', {
				key: 'manawg-theme',
				newValue: 'dark',
				storageArea: window.localStorage,
			}),
		);
	});
	await expect
		.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark')))
		.toBe(true);
});
