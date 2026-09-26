import { expect, test } from '@playwright/test';
import { FIXTURE_WG, navigateToFeature, setupMember } from './_helpers';

test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

// Regression: the PayPal Merchant-ID field wasn't wired to its own save error
// (no aria-invalid/aria-describedby — WCAG 3.3.1) and the "Speichern" button
// was a plain onClick handler outside any <form>, so pressing Enter in the
// field did nothing.
test('PayPal save error is associated with the input and Enter submits from the field', async ({
	page,
}) => {
	await setupMember(page);

	await page.route(
		`**/api/wg/${FIXTURE_WG.shareCode}/members/${FIXTURE_WG.memberId}`,
		async (route) => {
			const request = route.request();
			if (request.method() === 'GET') {
				await route.fulfill({ status: 200, json: { member: { paypalMerchantId: '' } } });
				return;
			}
			if (request.method() === 'PATCH') {
				await route.fulfill({
					status: 400,
					json: { error: 'paypal_merchant_id_invalid' },
				});
				return;
			}
			await route.continue();
		},
	);

	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen`);
	const merchantId = page.getByRole('textbox', { name: 'PayPal Merchant-ID' });
	await expect(merchantId).toBeEnabled();

	await merchantId.fill('not-valid');
	await merchantId.press('Enter');

	const errorAlert = page
		.getByRole('alert')
		.filter({ hasText: 'Bitte gib eine gültige PayPal Merchant-ID ein.' });
	await expect(errorAlert).toBeVisible();

	await expect(merchantId).toHaveAttribute('aria-invalid', 'true');
	const describedBy = await merchantId.getAttribute('aria-describedby');
	expect(describedBy).toBe('paypal-save-error');
	await expect(page.locator(`#${describedBy}`)).toHaveText(
		'Bitte gib eine gültige PayPal Merchant-ID ein.',
	);
});
