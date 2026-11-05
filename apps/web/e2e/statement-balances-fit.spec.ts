// Statement balances table at the narrowest phone width.
// Why: The Saldo column must stay inside the table and both tables must be reachable by keyboard.

import { expect, type Page, test } from '@playwright/test';
import { FIXTURE_WG, navigateToFeature, setupMember, skipUnlessFixtures } from './support/helpers';
import { setEnglishLocale } from './support/i18n';

const OTHER_MEMBER_ID = '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55';
const BASE = `/wg/${FIXTURE_WG.shareCode}`;
const LONG_NAME = 'Spuelmaschinenbeauftragte Alexandra';

const septemberExpense = {
	id: 'expense-fit-1',
	paidByMemberId: FIXTURE_WG.memberId,
	amountCents: 3000,
	currency: 'EUR',
	description: 'Groceries',
	category: 'groceries',
	occurredAt: '2026-09-14T10:00:00.000Z',
	splits: [
		{ debtorMemberId: FIXTURE_WG.memberId, amountCents: 1500, settledAt: null },
		{ debtorMemberId: OTHER_MEMBER_ID, amountCents: 1500, settledAt: null },
	],
};

async function openStatement(
	page: Page,
	otherName?: string,
	extraExpenses: unknown[] = [],
): Promise<void> {
	await page.setViewportSize({ width: 320, height: 700 });
	await setupMember(page);
	if (otherName) {
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/members`, (route) =>
			route.fulfill({
				json: {
					members: [
						{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName, color: null, active: true },
						{ id: OTHER_MEMBER_ID, name: otherName, color: null, active: true },
					],
					viewerIsAdmin: false,
				},
			}),
		);
	}
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/expenses*`, (route) =>
		route.fulfill({ json: { expenses: [septemberExpense, ...extraExpenses], payments: [] } }),
	);
	await navigateToFeature(page, `${BASE}/statement?month=2026-09`);
}

async function expectBalancesFit(page: Page, balanceHeader: string): Promise<void> {
	const header = page.getByRole('columnheader', { name: balanceHeader, exact: true });
	await expect(header).toBeVisible();
	const fit = await header.evaluate((th) => {
		const wrapper = th.closest('div');
		return {
			scroll: wrapper?.scrollWidth ?? 0,
			client: wrapper?.clientWidth ?? 0,
			right: th.getBoundingClientRect().right,
		};
	});
	expect(fit.scroll, 'the balances table does not scroll sideways').toBeLessThanOrEqual(fit.client);
	expect(fit.right, 'the balance column ends inside the viewport').toBeLessThanOrEqual(320);
}

async function expectScrollRegionsFocusable(page: Page, lang: 'de' | 'en' = 'de'): Promise<void> {
	// One named region per table: a section with the same name around it would be announced twice.
	const names = lang === 'en' ? ['Balances', 'All expenses'] : ['Salden', 'Alle Ausgaben'];
	for (const name of names) {
		const region = page.getByRole('region', { name, exact: true });
		await expect(region).toHaveCount(1);
		await expect(region).toHaveAttribute('tabindex', '0');
		await expect(region.locator('table')).toHaveCount(1);
	}
}

async function firstTermFontSize(page: Page): Promise<number> {
	return page
		.locator('dt')
		.first()
		.evaluate((dt) => Number.parseFloat(getComputedStyle(dt).fontSize));
}

test.describe('Statement balances at 320px', () => {
	skipUnlessFixtures();

	test('statement text follows a 200% root font size without sideways page scroll', async ({
		page,
	}) => {
		await openStatement(page);
		await expect(page.getByRole('columnheader', { name: 'Offen', exact: true })).toBeVisible();
		const normal = await firstTermFontSize(page);
		const rootSize = await page.evaluate(() =>
			Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
		);
		expect(normal, 'the label size is 0.75rem').toBeCloseTo(rootSize * 0.75, 2);

		await page.evaluate(() => {
			document.documentElement.style.fontSize = '200%';
		});

		expect(await firstTermFontSize(page)).toBeGreaterThanOrEqual(normal * 1.9);
		const root = await page.evaluate(() => ({
			scroll: document.documentElement.scrollWidth,
			client: document.documentElement.clientWidth,
		}));
		expect(root.scroll, 'the page does not scroll sideways at 200% text').toBeLessThanOrEqual(
			root.client,
		);
		await expectScrollRegionsFocusable(page);
	});

	for (const { width, size } of [
		{ width: 390, size: '150%' },
		{ width: 320, size: '125%' },
	]) {
		test(`member names keep room in the balances table at ${width}px and ${size} text`, async ({
			page,
		}) => {
			await openStatement(page, LONG_NAME, [
				{ ...septemberExpense, id: 'expense-fit-3', amountCents: 123456789 },
			]);
			await page.setViewportSize({ width, height: 700 });
			await page.evaluate((fontSize) => {
				document.documentElement.style.fontSize = fontSize;
			}, size);
			const rowHeader = page.getByRole('rowheader', { name: new RegExp(LONG_NAME) });
			await expect(rowHeader).toBeVisible();
			const name = await rowHeader.locator('span.truncate').evaluate((span) => ({
				width: span.getBoundingClientRect().width,
				rem: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
			}));
			expect(name.width, 'the member name keeps at least 2rem of room').toBeGreaterThanOrEqual(
				name.rem * 2,
			);
			const root = await page.evaluate(() => ({
				scroll: document.documentElement.scrollWidth,
				client: document.documentElement.clientWidth,
			}));
			expect(root.scroll, 'the page does not scroll sideways').toBeLessThanOrEqual(root.client);
		});
	}

	test('the page shows the open status, signed balances and the transfer from debtor to creditor', async ({
		page,
	}) => {
		await openStatement(page);
		const status = page.getByText('Status', { exact: true }).locator('xpath=following-sibling::dd');
		await expect(status).toHaveText('Offen');
		await expect(status).toHaveClass(/text-destructive/);

		const balanceOf = (name: string) =>
			page
				.getByRole('row')
				.filter({ has: page.getByRole('rowheader', { name: new RegExp(name) }) })
				.getByRole('listitem');
		const debtor = balanceOf('Mina');
		await expect(debtor).toHaveText(/^−15,00\s€$/);
		await expect(debtor).toHaveClass(/text-destructive/);
		const creditor = balanceOf(FIXTURE_WG.memberName);
		await expect(creditor).toHaveText(/^\+15,00\s€$/);
		await expect(creditor).toHaveClass(/text-settled/);

		const transfers = page.locator('section[aria-labelledby="statement-transfers"] li');
		await expect(transfers).toHaveCount(1);
		await expect(transfers.first()).toHaveText(/^Mina\s+an\s+Jonas\s*15,00\s€$/);
	});

	test('open amounts in two currencies show one line each and fit', async ({ page }) => {
		const dollars = {
			...septemberExpense,
			id: 'expense-fit-2',
			currency: 'USD',
			occurredAt: '2026-08-20T10:00:00.000Z',
		};
		await openStatement(page, undefined, [dollars]);
		const row = page.getByRole('row').filter({ hasText: '$' }).first();
		await expect(row.getByRole('listitem')).toHaveCount(2);
		await expectBalancesFit(page, 'Offen');
	});

	for (const lang of ['de', 'en'] as const) {
		const balance = lang === 'en' ? 'Open' : 'Offen';

		test(`balances fit without sideways scroll in ${lang}`, async ({ context, page, baseURL }) => {
			if (lang === 'en') await setEnglishLocale(context, baseURL ?? 'http://localhost:3112');
			await openStatement(page);
			await expectBalancesFit(page, balance);
			await expectScrollRegionsFocusable(page, lang);
		});

		test(`balances fit with a long member name in ${lang}`, async ({ context, page, baseURL }) => {
			if (lang === 'en') await setEnglishLocale(context, baseURL ?? 'http://localhost:3112');
			await openStatement(page, LONG_NAME);
			await expect(page.getByRole('rowheader', { name: new RegExp(LONG_NAME) })).toBeVisible();
			await expectBalancesFit(page, balance);
			await expectScrollRegionsFocusable(page, lang);
		});
	}
});
