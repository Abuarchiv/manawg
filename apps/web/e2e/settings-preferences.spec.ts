// Settings notifications, offline queue, theme, share card and invite code.
// Why: Every tab must stay reachable and readable at 320px / 200% text.

import { expect, test } from '@playwright/test';
import {
	FIXTURE_WG,
	inMinimalMatrix,
	mockNoWgs,
	navigateToFeature,
	setupMember,
} from './support/helpers';

test.describe('settings notifications responsive', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	test('quiet-time controls stay within the settings card at mobile widths and 200% text', async ({
		page,
	}) => {
		test.setTimeout(120_000);
		const notificationStatus = {
			pushOptIn: false,
			notifyAnnouncements: true,
			notifyChores: true,
			notifyExpenses: true,
			notifyReminders: true,
			notifyShopping: true,
			notifyInventory: true,
			notifyChat: true,
			notifyEvents: true,
			notifyStatementEmail: true,
			quietStartHour: 22,
			quietEndHour: 7,
			pushConfigured: false,
		};
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/notifications`, async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(
					route.request().method() === 'GET' ? notificationStatus : { ok: true },
				),
			});
		});
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#benachrichtigungen`);
		await expect(page.getByRole('tablist')).toBeVisible({ timeout: 60_000 });

		const card = page.locator('#benachrichtigungen > .overflow-hidden');
		const startHour = page.getByRole('combobox', { name: 'Ruhezeit von' });
		const endHour = page.getByRole('combobox', { name: 'Ruhezeit bis' });
		const disableButton = page
			.locator('#benachrichtigungen')
			.getByRole('button', { name: 'Ausschalten', exact: true });
		await expect(startHour).toBeVisible({ timeout: 30_000 });
		await expect(endHour).toBeVisible();
		await expect(disableButton).toBeVisible();

		const overflows: string[] = [];
		for (const width of [320, 360, 390]) {
			await page.setViewportSize({ width, height: 720 });
			for (const fontSize of ['16px', '32px']) {
				for (const dark of [false, true]) {
					await page.evaluate(
						({ fontSize: nextFontSize, dark: darkMode }) => {
							document.documentElement.style.fontSize = nextFontSize;
							document.documentElement.classList.toggle('dark', darkMode);
						},
						{ fontSize, dark },
					);
					expect(
						await page.locator('html').evaluate((element) => getComputedStyle(element).fontSize),
					).toBe(fontSize);
					const cardBox = await card.boundingBox();
					const startBox = await startHour.boundingBox();
					const selectBox = await endHour.boundingBox();
					const buttonBox = await disableButton.boundingBox();
					if (!cardBox || !startBox || !selectBox || !buttonBox) {
						throw new Error('Expected the quiet-time controls to have layout boxes');
					}
					const cardRight = cardBox.x + cardBox.width;
					for (const [name, box] of [
						['Von', startBox],
						['Bis', selectBox],
						['Ausschalten', buttonBox],
					] as const) {
						if (box.x < cardBox.x - 1 || box.x + box.width > cardRight + 1) {
							overflows.push(
								`${width}px / ${fontSize} / ${dark ? 'dark' : 'light'}: ${name} ${box.x.toFixed(1)}..${(box.x + box.width).toFixed(1)} outside ${cardBox.x.toFixed(1)}..${cardRight.toFixed(1)}`,
							);
						}
					}
					const pageOverflows = await page.evaluate(
						() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
					);
					if (pageOverflows) {
						overflows.push(
							`${width}px / ${fontSize} / ${dark ? 'dark' : 'light'}: page scrolls horizontally`,
						);
					}
					for (const hour of [startHour, endHour]) {
						const selectHeight = await hour.evaluate(
							(element) => element.getBoundingClientRect().height,
						);
						if (fontSize === '16px') expect(selectHeight).toBe(44);
						else expect(selectHeight).toBeGreaterThanOrEqual(44);
					}
				}
			}
		}
		expect(overflows).toEqual([]);

		await page.setViewportSize({ width: 320, height: 720 });
		await page.evaluate(() => {
			document.documentElement.style.fontSize = '32px';
			document.documentElement.classList.remove('dark');
		});
		await expect(endHour).toBeEnabled();
		await endHour.focus();
		await expect(endHour).toBeFocused();
		await endHour.selectOption('8');
		await expect(endHour).toHaveValue('8');
	});
});

test.describe('settings offline queue responsive', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	const queuedAction = {
		id: `shopping:${FIXTURE_WG.shareCode}:responsive-test`,
		idempotencyKey: '11111111-1111-4111-8111-111111111111',
		type: 'shopping.create',
		wgId: FIXTURE_WG.id,
		shareCode: FIXTURE_WG.shareCode,
		memberId: FIXTURE_WG.memberId,
		createdAt: new Date().toISOString(),
		payload: { name: 'Milch', quantity: '1L' },
	};

	test('manual review explains the uncertain result and opens the WG list', async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 844 });
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#daten`);
		const section = page.getByRole('region', { name: 'Offline-Warteschlange' });
		await expect(section).toBeVisible();
		const warning =
			'Server prüfen: Die erste Version kann bereits gespeichert sein. Die Bearbeitung wurde nicht gesendet. Vergleiche den WG-Eintrag und verwirf diese Aktion erst danach; lege benötigte Änderungen neu an.';
		await page.evaluate(
			({ action, warningText }) => {
				localStorage.setItem(
					'manawg:offline-actions',
					JSON.stringify([
						{
							...action,
							id: `announcement:${action.shareCode}:manual-review`,
							type: 'announcement.create',
							lastError: warningText,
							payload: { content: 'Geänderter Beitrag', kind: 'info', imageUrl: null },
						},
					]),
				);
				window.dispatchEvent(new Event('manawg:offline-queue'));
			},
			{ action: queuedAction, warningText: warning },
		);
		const alert = section.getByRole('alert').filter({ hasText: warning });
		await expect(alert).toBeVisible();
		await expect(alert).toContainText(warning);
		const size = await alert.evaluate((element) => ({
			client: element.clientHeight,
			scroll: element.scrollHeight,
		}));
		expect(size.scroll).toBeLessThanOrEqual(size.client + 1);
		await expect(
			section.getByRole('button', { name: 'Offline-Warteschlange erneut synchronisieren' }),
		).toHaveCount(0);
		await expect(section.getByRole('button', { name: /Server prüfen:/ })).toHaveCount(0);
		await expect(section.getByRole('button', { name: /Offline-Aktion bearbeiten:/ })).toHaveCount(
			0,
		);
		await expect(section.getByRole('button', { name: /Offline-Aktion verwerfen:/ })).toBeVisible();
		await section.getByRole('link', { name: /WG-Eintrag prüfen:/ }).click();
		await expect(page).toHaveURL(new RegExp(`/wg/${FIXTURE_WG.shareCode}/pinnwand$`));
	});

	const width = 320;
	for (const colorScheme of ['light', 'dark'] as const) {
		for (const textScale of ['normal', '32px'] as const) {
			if (!inMinimalMatrix({ width, dark: colorScheme === 'dark', large: textScale !== 'normal' }))
				continue;
			test(`offline retry fits ${width}px ${colorScheme} ${textScale}`, async ({ page }) => {
				await page.setViewportSize({ width, height: 844 });
				await page.emulateMedia({ colorScheme });
				await setupMember(page);
				await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#daten`);
				await expect(page.getByRole('heading', { name: 'Offline-Warteschlange' })).toBeVisible({
					timeout: 30_000,
				});
				const html = page.locator('html');
				if (colorScheme === 'dark') await expect(html).toHaveClass(/dark/);
				else await expect(html).not.toHaveClass(/dark/);
				await page.evaluate((action) => {
					localStorage.setItem('manawg:offline-actions', JSON.stringify([action]));
					window.dispatchEvent(new Event('manawg:offline-queue'));
				}, queuedAction);

				if (textScale === '32px') {
					await page.evaluate(() => {
						document.documentElement.style.fontSize = '200%';
					});
					expect(await html.evaluate((element) => getComputedStyle(element).fontSize)).toBe('32px');
				}

				const section = page.getByRole('region', { name: 'Offline-Warteschlange' });
				const retry = section.getByRole('button', {
					name: 'Offline-Warteschlange erneut synchronisieren',
				});
				await expect(retry).toBeEnabled();
				const bounds = await retry.locator('xpath=..').evaluate((row) => {
					const status = row.querySelector('p');
					const button = row.querySelector('button');
					if (!status || !button) throw new Error('Retry row is missing status or button');
					return {
						statusLeft: status.getBoundingClientRect().left,
						statusRight: status.getBoundingClientRect().right,
						buttonLeft: button.getBoundingClientRect().left,
						buttonRight: button.getBoundingClientRect().right,
					};
				});

				expect(bounds.statusLeft).toBeGreaterThanOrEqual(-1);
				expect(bounds.statusRight).toBeLessThanOrEqual(width + 1);
				expect(bounds.buttonLeft).toBeGreaterThanOrEqual(-1);
				expect(bounds.buttonRight).toBeLessThanOrEqual(width + 1);
				if (colorScheme === 'dark' && textScale === '32px') {
					await retry.scrollIntoViewIfNeeded();
					await page.screenshot({
						path: test.info().outputPath('offline-retry-320-dark-32.png'),
					});
				}
			});
		}
	}
});

test.describe('settings theme responsive', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');
	test.use({ viewport: { width: 320, height: 720 }, bypassCSP: true });

	test('all theme choices stay reachable at 320px with 200% text', async ({ page }) => {
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen`);
		await expect(page.getByRole('button', { name: 'System', exact: true })).toBeVisible();
		await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
		expect(
			await page.locator('html').evaluate((element) => getComputedStyle(element).fontSize),
		).toBe('32px');
		for (const tab of await page.getByRole('tab').all()) {
			const box = await tab.boundingBox();
			expect(box?.x).toBeGreaterThanOrEqual(0);
			expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
		}

		for (const name of ['Hell', 'Dunkel', 'System']) {
			const choice = page.getByRole('button', { name, exact: true });
			await expect(choice).toBeVisible();
			const box = await choice.boundingBox();
			if (!box) throw new Error(`${name} has no layout box`);
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(320);
		}
		for (const name of ['Hell', 'Dunkel', 'System']) {
			const choice = page.getByRole('button', { name, exact: true });
			await choice.click();
			await expect(choice).toHaveAttribute('aria-pressed', 'true');
			if (name === 'Dunkel') await expect(page.locator('html')).toHaveClass(/dark/);
			if (name === 'Hell') await expect(page.locator('html')).not.toHaveClass(/dark/);
		}
	});

	test('admin can rename the WG from the profile tab and sees API failures', async ({ page }) => {
		await setupMember(page);
		await page.route('**/api/wg/*/members', (route) =>
			route.fulfill({
				json: {
					members: [
						{
							id: FIXTURE_WG.memberId,
							name: FIXTURE_WG.memberName,
							color: '#6d5efc',
							active: true,
						},
					],
					viewerIsAdmin: true,
				},
			}),
		);
		let status = 500;
		let sentName: string | undefined;
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}`, (route) => {
			if (route.request().method() !== 'PATCH') return route.fallback();
			sentName = route.request().postDataJSON().name;
			return route.fulfill({ status, json: { wg: { name: sentName } } });
		});
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen`);
		const name = page.getByLabel('Name eurer WG');
		const save = page.getByLabel('WG-Name').getByRole('button', { name: 'Speichern', exact: true });
		await expect(save).toBeDisabled();
		await name.fill('  Neue WG ');
		await save.click();
		await expect(page.getByText(/nicht umbenannt werden/)).toBeVisible();
		await expect(name).toHaveValue('  Neue WG ');
		status = 200;
		await name.press('Enter');
		await expect(page.getByText('WG-Name gespeichert.')).toBeVisible();
		expect(sentName).toBe('Neue WG');
	});
});

test.describe('share card', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	test('native share success does not mark the invite link as copied', async ({ page }) => {
		// Stub the Web Share API so `nativeShare()` takes its success branch instead
		// of falling back to clipboard copy.
		await page.addInitScript(() => {
			Object.defineProperty(window.navigator, 'share', {
				configurable: true,
				value: () => Promise.resolve(),
			});
		});
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#zugang`);

		const linkButton = page.getByRole('button', { name: 'Einladungslink kopieren' });
		await expect(linkButton).toBeVisible();
		const shareButton = page.getByRole('button', { name: 'WG-Einladung teilen' });
		await shareButton.click();

		// A real share (not a clipboard copy) must not relabel the link row or
		// swap its icon to a checkmark — nothing was copied.
		await expect(page.getByRole('button', { name: 'Link kopiert' })).toHaveCount(0);
		await expect(linkButton).toBeVisible();

		// The generic "ready" note is still fine to show after a successful share.
		await expect(page.getByText('Einladungslink bereit.')).toBeVisible();
	});

	test('deactivating another member shows their open balances and succeeds', async ({ page }) => {
		const otherMember = { id: '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55', name: 'Mina' };
		await setupMember(page);

		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/members`, async (route) => {
			if (route.request().method() !== 'GET') return route.fallback();
			return route.fulfill({
				json: {
					members: [
						{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName, color: null, active: true },
						{ id: otherMember.id, name: otherMember.name, color: null, active: true },
					],
					viewerIsAdmin: true,
				},
			});
		});
		await page.route(
			`**/api/wg/${FIXTURE_WG.shareCode}/members/${otherMember.id}`,
			async (route) => {
				const method = route.request().method();
				if (method === 'GET') {
					return route.fulfill({
						json: {
							member: { id: otherMember.id, name: otherMember.name, active: true },
							openBalances: [
								{
									member_id: FIXTURE_WG.memberId,
									name: FIXTURE_WG.memberName,
									amount_cents: 1250,
									currency: 'EUR',
									direction: 'owed',
								},
							],
						},
					});
				}
				if (method === 'PATCH') {
					return route.fulfill({
						json: { member: { id: otherMember.id, name: otherMember.name, active: false } },
					});
				}
				return route.fallback();
			},
		);

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#zugang`);
		await page.getByRole('button', { name: `Ausziehen: ${otherMember.name}` }).click();

		await expect(
			page.getByRole('heading', { name: `${otherMember.name} ausziehen?` }),
		).toBeVisible();
		// direction "owed" from Mina's perspective: the viewer (dsaf) owes her.
		await expect(page.getByText(`${FIXTURE_WG.memberName} schuldet`)).toBeVisible();

		const confirmButton = page.getByRole('button', { name: 'Ausziehen', exact: true });
		await expect(confirmButton).toBeEnabled();
		await confirmButton.click();

		await expect(
			page.getByText(`${otherMember.name} ist jetzt als ausgezogen markiert.`),
		).toBeVisible();
	});

	test('reactivating a former member keeps their name at the start of the accessible label', async ({
		page,
	}) => {
		const otherMember = { id: '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55', name: 'Mina' };
		await setupMember(page);

		let reactivated = false;
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/members`, async (route) => {
			if (route.request().method() !== 'GET') return route.fallback();
			return route.fulfill({
				json: {
					members: [
						{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName, color: null, active: true },
						{ id: otherMember.id, name: otherMember.name, color: null, active: reactivated },
					],
					viewerIsAdmin: true,
				},
			});
		});
		await page.route(
			`**/api/wg/${FIXTURE_WG.shareCode}/members/${otherMember.id}`,
			async (route) => {
				if (route.request().method() !== 'PATCH') return route.fallback();
				reactivated = true;
				return route.fulfill({
					json: { member: { id: otherMember.id, name: otherMember.name, active: true } },
				});
			},
		);

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#zugang`);
		await expect(page.getByText('Ausgezogen, Verlauf bleibt erhalten')).toBeVisible();
		// WCAG 2.5.3 — the visible "Aktivieren" label must stay at the start of the
		// accessible name, disambiguated by the affected member's name.
		await page
			.getByRole('button', { name: `Aktivieren: ${otherMember.name}`, exact: true })
			.click();

		await expect(page.getByText(`${otherMember.name} ist wieder aktiv.`)).toBeVisible();
	});

	test('cancelling "WG verlassen" returns focus to its button', async ({ page }) => {
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/members`, async (route) => {
			if (route.request().method() !== 'GET') return route.fallback();
			return route.fulfill({
				json: {
					members: [
						{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName, color: null, active: true },
						{ id: '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55', name: 'Mina', color: null, active: true },
					],
					viewerIsAdmin: false,
				},
			});
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#zugang`);
		const leave = page.getByRole('button', { name: 'WG verlassen', exact: true });
		await leave.click();

		// WCAG 2.5.3 — the visible "Abbrechen"/"Verlassen" labels must stay at the
		// start of the accessible name, disambiguated by the self-leave action.
		const cancel = page.getByRole('button', { name: 'Abbrechen: WG verlassen', exact: true });
		await expect(cancel).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Verlassen: WG verlassen', exact: true }),
		).toBeVisible();
		await cancel.click();

		await expect(leave).toBeFocused();
	});
});

test.describe('invite code copy', () => {
	test.describe('invite code copy feedback', () => {
		test.skip(
			process.env.E2E_FIXTURE_MODE !== 'true' || process.env.NEXT_PUBLIC_DB_DOWN !== 'true',
			'Requires the local database-down fixture server.',
		);

		test('announces a copied code without reporting that the invitation link was copied', async ({
			page,
		}) => {
			const code = 'MTE8PZAT';
			await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
			await page.addInitScript(() => window.localStorage.clear());
			await mockNoWgs(page);
			await page.route('**/api/wg', async (route) => {
				if (route.request().method() === 'POST') {
					await route.fulfill({
						json: {
							wg: { id: 'fixture', shareCode: code, name: 'Fixture WG' },
							creator: { id: 'fixture-user', name: 'Anna' },
						},
					});
					return;
				}
				await route.continue();
			});

			await page.goto('/neu');
			await page.getByRole('button', { name: 'Neue WG erstellen', exact: true }).click();
			await page.getByLabel('WG-Name').fill('Fixture WG');
			await page.getByLabel('Dein Anzeigename').fill('Anna');
			await page.getByRole('button', { name: 'WG erstellen', exact: true }).click();

			const copyCodeButton = page.getByRole('button', {
				name: `Code ${code} kopieren`,
				exact: true,
			});
			await expect(copyCodeButton).toBeVisible();
			await copyCodeButton.focus();
			await expect(copyCodeButton).toBeFocused();
			await page.keyboard.press('Enter');

			await expect(page.locator('#share-status-live')).toHaveText('WG-Code wurde kopiert.');
			await expect(
				page.getByRole('button', { name: 'Mitbewohner einladen', exact: true }),
			).toBeVisible();
			await expect(page.getByText('Code kopiert', { exact: true })).toBeVisible();
			await expect(page.getByText('Link kopiert', { exact: true })).toHaveCount(0);
			expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
		});
	});
});
