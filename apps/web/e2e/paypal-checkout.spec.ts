import { type Page, expect, test } from '@playwright/test';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

const OTHER_MEMBER_ID = '11111111-1111-4111-8111-111111111111';

async function setupDebtPage(
	page: Page,
	options: {
		debtorId: string;
		creditorId: string;
		creditorMerchantId: string | null;
		onReadExpenses?: (count: number) => void;
		isSettled?: () => boolean;
	},
): Promise<void> {
	const { shareCode, memberId } = FIXTURE_WG;
	await setupMember(page);
	await page.route(`**/api/wg/${shareCode}/members`, (route) =>
		route.fulfill({
			json: {
				members: [
					{
						id: memberId,
						name: 'Abu',
						color: null,
						active: true,
						paypalMerchantId: options.creditorId === memberId ? options.creditorMerchantId : null,
					},
					{
						id: OTHER_MEMBER_ID,
						name: 'Mina',
						color: null,
						active: true,
						paypalMerchantId:
							options.creditorId === OTHER_MEMBER_ID ? options.creditorMerchantId : null,
					},
				],
				viewerIsAdmin: false,
			},
		}),
	);
	let expenseReads = 0;
	await page.route(`**/api/wg/${shareCode}/expenses`, (route) => {
		expenseReads += 1;
		options.onReadExpenses?.(expenseReads);
		const settled = options.isSettled?.() ?? false;
		return route.fulfill({
			json: {
				expenses: [
					{
						id: 'expense-rent',
						paidByMemberId: options.creditorId,
						amountCents: 1000,
						currency: 'EUR',
						description: 'Miete',
						occurredAt: '2026-09-01T10:00:00.000Z',
						splits: [
							{
								id: 'split-rent',
								expenseId: 'expense-rent',
								debtorMemberId: options.debtorId,
								amountCents: 1000,
								settledAt: settled ? '2026-09-27T10:00:00.000Z' : null,
							},
						],
					},
				],
				payments: [],
			},
		});
	});
	await page.route(`**/api/wg/${shareCode}/recurring-expenses`, (route) =>
		route.fulfill({ json: { recurringExpenses: [] } }),
	);
	await page.route(`**/api/wg/${shareCode}/dashboard`, (route) =>
		route.fulfill({ json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] } }),
	);
	await page.route(`**/api/wg/${shareCode}/chat/unread-count`, (route) =>
		route.fulfill({ json: { count: 0, overflow: false } }),
	);
	await navigateToFeature(page, `/wg/${shareCode}/ausgaben`);
	await dismissOnboarding(page);
}

test('unlinked recipients can connect PayPal, while debtors keep manual settlement', async ({
	page,
}) => {
	await setupDebtPage(page, {
		debtorId: OTHER_MEMBER_ID,
		creditorId: FIXTURE_WG.memberId,
		creditorMerchantId: null,
	});

	await expect(page.getByRole('heading', { name: 'Deine offenen Zahlungen' })).toBeVisible();
	await expect(
		page.getByText('Verbinde PayPal, damit andere Mitglieder dir Geld senden können.'),
	).toBeVisible();
	const connectLink = page.getByRole('link', { name: 'PayPal verbinden', exact: true });
	await expect(connectLink).toHaveAttribute('href', `/wg/${FIXTURE_WG.shareCode}/einstellungen`);
	await expect(page.getByRole('button', { name: 'Ausgleichen', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Mit PayPal zahlen', exact: true })).toHaveCount(0);
});

test('debtors see when the recipient has not connected PayPal', async ({ page }) => {
	await setupDebtPage(page, {
		debtorId: FIXTURE_WG.memberId,
		creditorId: OTHER_MEMBER_ID,
		creditorMerchantId: null,
	});

	await expect(
		page.getByText('PayPal-Zahlungen sind erst möglich, wenn Mina PayPal verbunden hat.'),
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'Ausgleichen', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Mit PayPal zahlen', exact: true })).toHaveCount(0);
});

test('PayPal approval changes debt only after server-confirmed capture', async ({ page }) => {
	test.skip(
		!process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ||
			!process.env.NEXT_PUBLIC_PAYPAL_PARTNER_ATTRIBUTION_ID,
		'requires fixture PayPal client configuration',
	);

	const merchantId = 'fixture-merchant';
	await page.addInitScript({
		content: `
			window[${JSON.stringify(`p${merchantId}`)}] = {
				Buttons: (options) => ({
					render: async (container) => {
						const cancel = document.createElement('button');
						cancel.type = 'button';
						cancel.textContent = 'PayPal abbrechen';
						cancel.onclick = () => options.onCancel?.();
						container.appendChild(cancel);
						const approve = document.createElement('button');
						approve.type = 'button';
						approve.textContent = 'PayPal bestätigen';
						approve.onclick = async () => {
							try {
								const orderID = await options.createOrder();
								await options.onApprove({ orderID });
							} catch (error) {
								options.onError(error);
							}
						};
						container.appendChild(approve);
					},
					close: async () => {},
				}),
			};
		`,
	});

	let captureCanComplete = false;
	let settled = false;
	let expenseReads = 0;
	const captureBodies: Array<{ orderId?: string }> = [];
	const settlementPosts: unknown[] = [];
	const orderBodies: unknown[] = [];
	const paypalUrl = `**/api/wg/${FIXTURE_WG.shareCode}/paypal`;
	await setupDebtPage(page, {
		debtorId: FIXTURE_WG.memberId,
		creditorId: OTHER_MEMBER_ID,
		creditorMerchantId: merchantId,
		isSettled: () => settled,
		onReadExpenses: (count) => {
			expenseReads = count;
		},
	});
	await page.route(`${paypalUrl}/order`, async (route) => {
		orderBodies.push(route.request().postDataJSON());
		return route.fulfill({ json: { orderId: `ORDER-${orderBodies.length}` } });
	});
	await page.route(`${paypalUrl}/capture`, async (route) => {
		captureBodies.push(route.request().postDataJSON() as { orderId?: string });
		if (!captureCanComplete) {
			return route.fulfill({ status: 400, json: { error: 'paypal_capture_failed' } });
		}
		settled = true;
		return route.fulfill({ json: { status: 'COMPLETED' } });
	});
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/expenses/settle-batch`, async (route) => {
		if (route.request().method() === 'POST') settlementPosts.push(route.request().postDataJSON());
		return route.fulfill({ json: { settled: 0, settledCents: 0, splits: [] } });
	});

	await expect(page.getByText(/Du schuldest Mina/)).toBeVisible();
	await page.getByRole('button', { name: 'Mit PayPal zahlen', exact: true }).click();
	const cancelButton = page.getByRole('button', { name: 'PayPal abbrechen', exact: true });
	const approveButton = page.getByRole('button', { name: 'PayPal bestätigen', exact: true });
	await expect(cancelButton).toBeVisible();
	await cancelButton.click();
	await expect(page.getByText(/Du schuldest Mina/)).toBeVisible();
	expect(orderBodies).toHaveLength(0);
	expect(captureBodies).toHaveLength(0);

	await approveButton.click();
	await expect(page.getByText(/PayPal konnte die Zahlung nicht bestätigen/)).toBeVisible();
	await expect(page.getByText(/Du schuldest Mina/)).toBeVisible();
	const readsBeforeComplete = expenseReads;
	expect(settlementPosts).toEqual([]);

	captureCanComplete = true;
	await approveButton.click();
	await expect.poll(() => expenseReads).toBeGreaterThan(readsBeforeComplete);
	await expect(page.getByText(/Du schuldest Mina/)).toHaveCount(0);
	expect(captureBodies).toHaveLength(2);
	expect(settlementPosts).toEqual([]);
});
