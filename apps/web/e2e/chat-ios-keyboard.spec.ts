import { expect, test } from '@playwright/test';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

test('chat composer sits on the iOS keyboard after Safari pans the page', async ({ page }) => {
	await page.setViewportSize({ width: 393, height: 659 });
	// iOS Safari keeps the layout viewport, shrinks the visual viewport and pans it.
	await page.addInitScript(() => {
		const state = { height: window.innerHeight, offsetTop: 0 };
		const viewport = new EventTarget();
		Object.defineProperties(viewport, {
			height: { get: () => state.height },
			width: { get: () => window.innerWidth },
			offsetTop: { get: () => state.offsetTop },
			offsetLeft: { get: () => 0 },
			scale: { get: () => 1 },
		});
		Object.defineProperty(window, 'visualViewport', { get: () => viewport });
		Object.assign(window, { __iosKeyboard: { state, viewport } });
	});
	await setupMember(page);
	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/chat`);
	await dismissOnboarding(page);
	const composer = page.getByRole('textbox', { name: 'Chat-Nachricht' });
	await expect(composer).toBeVisible();

	const result = await page.evaluate(async () => {
		const { state, viewport } = (
			window as unknown as {
				__iosKeyboard: { state: { height: number; offsetTop: number }; viewport: EventTarget };
			}
		).__iosKeyboard;
		const field = document.querySelector<HTMLTextAreaElement>(
			'textarea[aria-label="Chat-Nachricht"]',
		);
		if (!field) throw new Error('composer missing');
		field.focus();
		state.height = window.innerHeight - 336;
		state.offsetTop = field.getBoundingClientRect().bottom + 8 - state.height;
		viewport.dispatchEvent(new Event('resize'));
		viewport.dispatchEvent(new Event('scroll'));
		await new Promise((resolve) => requestAnimationFrame(resolve));
		return {
			keyboardTop: state.offsetTop + state.height,
			composerBottom: field.closest('.border-t')?.getBoundingClientRect().bottom ?? 0,
		};
	});
	expect(Math.abs(result.keyboardTop - result.composerBottom)).toBeLessThan(1);
});

test('chat document does not overshoot the viewport at rest', async ({ page }) => {
	// The WG shell reserves padding-bottom for the fixed bottom nav so normal
	// scrolling pages clear it. Chat already ends above the nav via its own
	// height calc, so that reserve must be cancelled — otherwise the whole
	// page (not just the message list) rubber-bands on iOS.
	await page.setViewportSize({ width: 390, height: 844 });
	await setupMember(page);
	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/chat`);
	await dismissOnboarding(page);
	await expect(page.getByRole('textbox', { name: 'Chat-Nachricht' })).toBeVisible();
	const overshoot = await page.evaluate(
		() => document.documentElement.scrollHeight - window.innerHeight,
	);
	expect(overshoot).toBeLessThanOrEqual(0);
});
