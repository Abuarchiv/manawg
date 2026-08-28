import { expect, test } from '@playwright/test';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

test.describe('Chat happy path', () => {
	test.setTimeout(180_000);

	test('renders mobile chat without horizontal overflow and keeps send/reaction controls usable', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await setupMember(page);

		const initialMessages = [
			{
				id: '1c2c9254-5945-4774-9f03-d12e772d3a6f',
				wgId: FIXTURE_WG.id,
				senderMemberId: '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55',
				kind: 'user',
				body: 'Das ist eine ziemlich lange Chat-Nachricht mit einem_saehr_langen_ununterbrochenen_Wort_das_trotzdem_nicht_die_mobile_Ansicht_sprengen_darf.',
				imageUrl: null,
				replyToMessageId: null,
				systemKind: null,
				systemPayload: null,
				createdAt: new Date(Date.now() - 60_000).toISOString(),
				editedAt: null,
				deletedAt: null,
			},
		];
		const sentMessage = {
			id: 'de66cf62-aed4-4d86-92de-1360cc91a67d',
			wgId: FIXTURE_WG.id,
			senderMemberId: FIXTURE_WG.memberId,
			kind: 'user',
			body: 'Hallo zusammen',
			imageUrl: null,
			replyToMessageId: null,
			systemKind: null,
			systemPayload: null,
			createdAt: new Date().toISOString(),
			editedAt: null,
			deletedAt: null,
		};

		await page.route('**/api/wg/*/chat/messages?limit=50', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ messages: [...initialMessages, sentMessage], reactions: [] }),
			});
		});
		await page.route('**/api/wg/*/chat/messages', async (route) => {
			await route.fulfill({
				status: 201,
				contentType: 'application/json',
				body: JSON.stringify({ message: sentMessage }),
			});
		});
		await page.route('**/api/wg/*/chat/messages/*/reactions', async (route) => {
			await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
		});
		await page.route('**/api/wg/*/chat/read', async (route) => {
			await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/chat`);
		await dismissOnboarding(page);
		await expect(page.getByText(/ununterbrochenen_Wort/).first()).toBeVisible({
			timeout: 30_000,
		});
		await expect
			.poll(() =>
				page.evaluate(
					() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
				),
			)
			.toBeLessThanOrEqual(2);

		const composer = page.getByLabel('Chat-Nachricht');
		await expect(composer).toBeVisible({ timeout: 30_000 });
		await composer.fill('Hallo zusammen');
		await page.getByRole('button', { name: 'Nachricht senden' }).click();

		await expect(page.getByText('Hallo zusammen')).toBeVisible({ timeout: 10_000 });

		// React with thumbs-up; UI shows count 1.
		// The trigger carries the sender and time so screen readers can tell the
		// per-message buttons apart, so the name is a pattern rather than the bare
		// "Reaktion hinzufügen" default of the picker.
		await page
			.getByRole('button', { name: /^Reaktion zu Nachricht von .+ hinzufügen$/ })
			.first()
			.click();
		await page.getByRole('button', { name: 'Reaktion 👍', exact: true }).click();
		// The chip spells out emoji, count and what a click would do, so its
		// accessible name is that sentence rather than the "👍 1" it displays.
		await expect(
			page.getByRole('button', { name: /^Reaktion 👍 \(1\) entfernen/ }),
		).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
	});
});
