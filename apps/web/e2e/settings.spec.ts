// Settings tabs: access and admin, data summary, legal links, notifications and the offline queue
// stay reachable and readable at 320px and 200% text.

import { type Page, expect, test } from '@playwright/test';
import { FIXTURE_WG, inMinimalMatrix, navigateToFeature, setupMember } from './_helpers';

test.describe('settings access responsive', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	async function mockMemberRole(page: Page, viewerIsAdmin: () => boolean): Promise<void> {
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/members`, async (route) => {
			if (route.request().method() !== 'GET') return route.continue();
			return route.fulfill({
				json: {
					members: [
						{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName, active: true },
						{ id: 'fixture-other-member', name: 'Mira', active: true },
					],
					viewerIsAdmin: viewerIsAdmin(),
				},
			});
		});
	}

	test('WG-code renewal actions remain visible and usable at phone widths and 200% text', async ({
		page,
	}) => {
		test.setTimeout(120_000);
		await setupMember(page);
		await mockMemberRole(page, () => true);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#zugang`);

		const trigger = page.getByRole('button', { name: 'Erneuern: WG-Code', exact: true });
		const cancel = page.getByRole('button', { name: 'Abbrechen: WG-Code-Erneuerung' });
		const confirm = page.getByRole('button', { name: 'Bestätigen: WG-Code-Erneuerung' });
		await expect(trigger).toBeVisible({ timeout: 30_000 });
		let rotations = 0;
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}`, async (route) => {
			if (route.request().method() !== 'PATCH') return route.continue();
			rotations += 1;
			return route.fulfill({
				json: { wg: { shareCode: FIXTURE_WG.shareCode, joiningEnabled: true } },
			});
		});
		let expectedRotations = 0;

		for (const width of [320, 360, 390]) {
			for (const fontSize of [16, 32]) {
				for (const dark of [false, true]) {
					await page.setViewportSize({ width, height: 900 });
					await page.evaluate(
						({ fontSize: size, dark: useDark }) => {
							document.documentElement.style.fontSize = `${size}px`;
							document.documentElement.classList.toggle('dark', useDark);
						},
						{ fontSize, dark },
					);
					expect(
						await page.locator('html').evaluate((element) => getComputedStyle(element).fontSize),
					).toBe(`${fontSize}px`);

					await expect(trigger).toBeVisible();
					await trigger.click();
					await expect(cancel).toBeVisible();
					await expect(confirm).toBeVisible();

					const actions = [cancel, confirm];
					const actionBounds = await Promise.all(
						actions.map((action) =>
							action.evaluate((button) => {
								const buttonBounds = button.getBoundingClientRect();
								const sectionBounds = button
									.closest('section[aria-label="Zugang"]')
									?.getBoundingClientRect();
								if (!sectionBounds) throw new Error('Zugang section not found');
								return {
									left: buttonBounds.left,
									right: buttonBounds.right,
									sectionLeft: sectionBounds.left,
									sectionRight: sectionBounds.right,
								};
							}),
						),
					);
					for (const bounds of actionBounds) {
						expect(bounds.left).toBeGreaterThanOrEqual(bounds.sectionLeft);
						expect(bounds.right).toBeLessThanOrEqual(bounds.sectionRight);
					}

					await cancel.click();
					await expect(trigger).toBeVisible();
					await trigger.click();
					if (width === 320 && fontSize === 32 && dark) {
						await cancel.focus();
						await page.keyboard.press('Tab');
						await expect(confirm).toBeFocused();
						await page.keyboard.press('Enter');
					} else {
						await confirm.click();
					}
					expectedRotations += 1;
					await expect.poll(() => rotations).toBe(expectedRotations);
					await expect(trigger).toBeVisible();
				}
			}
		}
	});

	test('WG access controls match admin permissions and explain deactivation accurately', async ({
		page,
	}) => {
		await setupMember(page);
		let viewerIsAdmin = false;
		await mockMemberRole(page, () => viewerIsAdmin);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#zugang`);

		const joiningToggle = page.getByRole('switch');
		const renewCode = page.getByRole('button', { name: 'Erneuern: WG-Code', exact: true });
		const deleteWg = page.getByRole('button', { name: 'Komplette WG für alle löschen' });
		const leaveWg = page.getByRole('button', { name: 'WG verlassen', exact: true });
		await expect(joiningToggle).toBeDisabled();
		await expect(renewCode).toBeDisabled();
		await expect(deleteWg).toBeDisabled();
		await expect(leaveWg).toBeEnabled();
		await expect(page.getByText('Nur Admins können den WG-Code verwalten.')).toBeVisible();

		viewerIsAdmin = true;
		await page.reload();
		await expect(joiningToggle).toBeEnabled();
		await expect(renewCode).toBeEnabled();
		await expect(deleteWg).toBeEnabled();
		await expect(leaveWg).toHaveCount(0);
		await expect(page.getByText('Übergib zuerst die Admin-Rolle', { exact: false })).toBeVisible();

		await page.getByRole('button', { name: 'Ausziehen: Mira' }).click();
		await expect(
			page.getByText(
				'Mira verliert den Zugriff auf diese WG. Historie und offene Salden bleiben erhalten. Ein aktives Admin-Mitglied kann den Zugang später wieder aktivieren.',
			),
		).toBeVisible();
		await expect(page.getByText(/behält aber Zugriff auf dieses Gerät/)).toHaveCount(0);
	});

	test('admin_required explains why an admin cannot leave the WG', async ({ page }) => {
		await setupMember(page);
		await mockMemberRole(page, () => false);
		let patchRequests = 0;
		await page.route(
			`**/api/wg/${FIXTURE_WG.shareCode}/members/${FIXTURE_WG.memberId}`,
			async (route) => {
				if (route.request().method() === 'GET')
					return route.fulfill({ json: { openBalances: [] } });
				if (route.request().method() === 'PATCH') {
					patchRequests += 1;
					return route.fulfill({
						status: 403,
						json: { code: 'admin_required', error: 'admin_required' },
					});
				}
				return route.continue();
			},
		);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#zugang`);

		await page.getByRole('button', { name: 'WG verlassen', exact: true }).click();
		const confirmLeave = page.getByRole('button', {
			name: 'Verlassen: WG verlassen',
		});
		await expect(confirmLeave).toBeEnabled();
		await confirmLeave.click();
		await expect.poll(() => patchRequests).toBe(1);
		await expect(
			page.getByText(
				'Übergib zuerst die Admin-Rolle an ein aktives Mitglied, dann kannst du die WG verlassen. Wenn du nur dieses Gerät abmelden möchtest, nutze oben „Konto abmelden“.',
			),
		).toBeVisible();
		await expect(page.getByText(/Bitte erneut versuchen/)).toHaveCount(0);
	});

	test('admin can hand over the admin role after a confirmation', async ({ page }) => {
		await setupMember(page);
		await mockMemberRole(page, () => true);
		let transfers = 0;
		await page.route(
			`**/api/wg/${FIXTURE_WG.shareCode}/members/fixture-other-member/admin`,
			async (route) => {
				transfers += 1;
				return route.fulfill({ json: { member: { id: 'fixture-other-member', name: 'Mira' } } });
			},
		);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#zugang`);

		await page.getByRole('button', { name: 'Admin übergeben: Mira' }).click();
		await expect(page.getByText('Mira wird Admin dieser WG.')).toBeVisible();
		await page.getByRole('button', { name: 'Übergeben', exact: true }).click();
		await expect.poll(() => transfers).toBe(1);
		await expect(page.getByText(/Mira ist jetzt Admin/)).toBeVisible();
	});
});

test.describe('settings data summary responsive', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	const width = 320;
	for (const colorScheme of ['light', 'dark'] as const) {
		for (const textScale of ['normal', '32px'] as const) {
			if (!inMinimalMatrix({ width, dark: colorScheme === 'dark', large: textScale !== 'normal' }))
				continue;
			test(`export summary fits ${width}px ${colorScheme} ${textScale}`, async ({ page }) => {
				await page.setViewportSize({ width, height: 844 });
				await page.emulateMedia({ colorScheme });
				await setupMember(page);
				await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#daten`);
				await expect(page.getByRole('heading', { name: 'Datenexport' })).toBeVisible({
					timeout: 30_000,
				});

				if (textScale === '32px') {
					await page.evaluate(() => {
						document.documentElement.style.fontSize = '200%';
					});
				}

				const summary = page
					.getByRole('region', { name: 'Datenexport' })
					.locator('div.border-b')
					.first();
				const labels = await summary.locator('span').evaluateAll((spans) =>
					spans
						.filter((span) =>
							['Ausgaben', 'Abwesenheiten'].includes(span.textContent?.trim() ?? ''),
						)
						.map((span) => {
							const { left, right } = span.getBoundingClientRect();
							return { text: span.textContent?.trim(), left, right };
						}),
				);

				expect(labels).toHaveLength(2);
				for (const label of labels) {
					expect(label.left).toBeGreaterThanOrEqual(-1);
					expect(label.right).toBeLessThanOrEqual(width + 1);
				}
				const overflow = await summary.evaluate(
					(element) => element.scrollWidth - element.clientWidth,
				);
				expect(overflow).toBeLessThanOrEqual(1);
				if (colorScheme === 'dark' && textScale === '32px') {
					await page.screenshot({
						path: test.info().outputPath('export-summary-320-dark-32.png'),
					});
				}
			});
		}
	}
});

test.describe('settings legal links responsive', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	test('legal links fit at 320px with normal and 200% text sizes', async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 760 });
		await page.emulateMedia({ colorScheme: 'light' });
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen`);
		await page.getByRole('tab', { name: 'Daten', exact: true }).click();

		const privacyLink = page.getByRole('link', {
			name: 'Datenschutz (öffnet in neuem Tab)',
			exact: true,
		});
		await expect(privacyLink).toBeVisible();
		const label = privacyLink.locator(':scope > span');
		const chevron = privacyLink.locator(':scope > svg');

		const width = 320;
		for (const fontSize of [16, 32]) {
			for (const colorScheme of ['light', 'dark'] as const) {
				await page.setViewportSize({ width, height: 760 });
				await page.emulateMedia({ colorScheme });
				await page.locator('html').evaluate((html, size) => {
					html.style.setProperty('font-size', `${size}px`, 'important');
				}, fontSize);

				await expect(page.locator('html')).toHaveCSS('font-size', `${fontSize}px`);
				if (colorScheme === 'dark') {
					await expect(page.locator('html')).toHaveClass(/dark/);
				} else {
					await expect(page.locator('html')).not.toHaveClass(/dark/);
				}

				const geometry = await privacyLink.evaluate((link) => {
					const anchor = link.getBoundingClientRect();
					return {
						anchor: {
							x: anchor.x,
							right: anchor.right,
							height: anchor.height,
							clientWidth: link.clientWidth,
							scrollWidth: link.scrollWidth,
						},
					};
				});
				const labelBox = await label.boundingBox();
				const chevronBox = await chevron.boundingBox();
				if (!labelBox || !chevronBox)
					throw new Error('Legal link label or chevron has no layout box');
				expect(geometry.anchor.x).toBeGreaterThanOrEqual(0);
				expect(geometry.anchor.right).toBeLessThanOrEqual(width);
				expect(geometry.anchor.height).toBeGreaterThanOrEqual(44);
				expect(geometry.anchor.scrollWidth).toBeLessThanOrEqual(geometry.anchor.clientWidth);
				expect(labelBox.x).toBeGreaterThanOrEqual(geometry.anchor.x);
				expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(geometry.anchor.right);
				expect(chevronBox.x).toBeGreaterThanOrEqual(geometry.anchor.x);
				expect(chevronBox.x + chevronBox.width).toBeLessThanOrEqual(geometry.anchor.right);

				if (fontSize === 32 && colorScheme === 'dark') {
					await page.evaluate(() => {
						if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
					});
					let reachedByKeyboard = false;
					for (let tab = 0; tab < 40; tab += 1) {
						await page.keyboard.press('Tab');
						if (await privacyLink.evaluate((link) => document.activeElement === link)) {
							reachedByKeyboard = true;
							break;
						}
					}
					expect(reachedByKeyboard).toBe(true);
					await expect(privacyLink).toBeFocused();
					const focusStyle = await privacyLink.evaluate((link) => ({
						isVisibleFocus: link.matches(':focus-visible'),
						boxShadow: getComputedStyle(link).boxShadow,
					}));
					expect(focusStyle.isVisibleFocus).toBe(true);
					expect(focusStyle.boxShadow).not.toBe('none');
				}
			}
		}
	});
});

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
			.getByRole('button', { name: 'Aus', exact: true });
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
						['Aus', buttonBox],
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
