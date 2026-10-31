import { rm } from 'node:fs/promises';
import { test as base, expect } from '@playwright/test';
import { FIXTURE_WG, navigateToFeature, setupMember, skipUnlessFixtures } from './support/helpers';

const test = base.extend({
	context: async (
		{ browserName, playwright, context, contextOptions, baseURL, locale, timezoneId },
		use,
		testInfo,
	) => {
		if (browserName !== 'webkit') {
			await use(context);
			return;
		}
		// Ephemeral WebKit stores reject Blob/File values; a fresh profile exercises native IndexedDB.
		const profile = testInfo.outputPath('webkit-profile');
		const persistent = await playwright.webkit.launchPersistentContext(profile, {
			...contextOptions,
			...(baseURL ? { baseURL } : {}),
			...(locale ? { locale } : {}),
			...(timezoneId ? { timezoneId } : {}),
			serviceWorkers: 'block',
		});
		try {
			await use(persistent);
		} finally {
			await persistent.close();
			await rm(profile, { recursive: true, force: true });
		}
	},
});

test.describe('image upload lifetime', () => {
	skipUnlessFixtures();

	test('closing the receipt uploader stops its pending SIGN without blocking a new upload', async ({
		page,
	}) => {
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/expenses`);
		await page.getByRole('button', { name: 'Ausgabe hinzufügen', exact: true }).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByRole('button', { name: 'Beleg hinzufügen', exact: true }).click();
		const image = Buffer.from(
			await page.evaluate(() => {
				const canvas = document.createElement('canvas');
				canvas.width = 4;
				canvas.height = 4;
				canvas.getContext('2d')?.fillRect(0, 0, 4, 4);
				return canvas.toDataURL('image/png').split(',')[1] ?? '';
			}),
			'base64',
		);
		const uploadUrl = new URL('/__test-image-upload', page.url()).href;
		const readUrl = new URL('/__test-image-read', page.url()).href;
		let release!: () => void;
		let started!: () => void;
		let finished!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const signing = new Promise<void>((resolve) => {
			started = resolve;
		});
		const completed = new Promise<void>((resolve) => {
			finished = resolve;
		});
		let signs = 0;
		let puts = 0;
		await page.route('**/api/upload/sign', async (route) => {
			signs += 1;
			if (signs === 1) {
				started();
				await gate;
			}
			await route
				.fulfill({ json: { presignedUrl: uploadUrl, publicUrl: readUrl } })
				.catch(() => undefined)
				.finally(() => {
					if (signs === 1) finished();
				});
		});
		await page.route(uploadUrl, (route) => {
			puts += 1;
			return route.fulfill({ status: 200, body: '' });
		});
		await page.route(readUrl, (route) => route.fulfill({ contentType: 'image/png', body: image }));
		try {
			await dialog.getByLabel('Bild auswählen', { exact: true }).setInputFiles({
				name: 'scope.png',
				mimeType: 'image/png',
				buffer: image,
			});
			await signing;
			await dialog.getByRole('button', { name: 'Beleg hinzufügen', exact: true }).click();
			await expect(dialog.getByLabel('Bild auswählen', { exact: true })).toHaveCount(0);
			release();
			await completed;
			await page.waitForLoadState('networkidle');
			expect(puts).toBe(0);
			await dialog.getByRole('button', { name: 'Beleg hinzufügen', exact: true }).click();
			await dialog.getByLabel('Bild auswählen', { exact: true }).setInputFiles({
				name: 'fresh.png',
				mimeType: 'image/png',
				buffer: image,
			});
			await expect(dialog.getByText('Angehängt', { exact: true })).toBeVisible();
			expect(signs).toBe(2);
			expect(puts).toBe(1);
		} finally {
			release();
		}
	});

	test('a pending image deleted during PUT stays removed in real IndexedDB', async ({
		page,
		context,
	}) => {
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/expenses`);
		await page.getByRole('button', { name: 'Ausgabe hinzufügen', exact: true }).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByRole('button', { name: 'Beleg hinzufügen', exact: true }).click();
		await page.waitForLoadState('networkidle');
		const image = Buffer.from(
			await page.evaluate(() => {
				const canvas = document.createElement('canvas');
				canvas.width = 4;
				canvas.height = 4;
				canvas.getContext('2d')?.fillRect(0, 0, 4, 4);
				return canvas.toDataURL('image/png').split(',')[1] ?? '';
			}),
			'base64',
		);
		const uploadUrl = new URL('/__test-pending-upload', page.url()).href;
		let release!: () => void;
		let started!: () => void;
		let finished!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const uploading = new Promise<void>((resolve) => {
			started = resolve;
		});
		const completed = new Promise<void>((resolve) => {
			finished = resolve;
		});
		await page.route('**/api/upload/sign', (route) =>
			route.fulfill({
				json: { presignedUrl: uploadUrl, publicUrl: '/__test-removed-image' },
			}),
		);
		await page.route(uploadUrl, async (route) => {
			started();
			await gate;
			await route
				.fulfill({ status: 200, body: '' })
				.catch(() => undefined)
				.finally(finished);
		});
		try {
			await context.setOffline(true);
			await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
			await expect(
				page.getByRole('link', { name: 'Offline-Übersicht prüfen', exact: true }),
			).toBeVisible();
			await expect(dialog.getByLabel('Bild auswählen', { exact: true })).toBeAttached();
			await expect(dialog.getByLabel('Bild auswählen', { exact: true })).toBeEnabled();
			await dialog.getByLabel('Bild auswählen', { exact: true }).setInputFiles({
				name: 'pending.png',
				mimeType: 'image/png',
				buffer: image,
			});
			await expect(dialog.getByText('Angehängt', { exact: true })).toBeVisible();
			await context.setOffline(false);
			await uploading;
			await page.evaluate(
				() =>
					new Promise<void>((resolve, reject) => {
						const request = indexedDB.open('manawg-offline-images', 1);
						request.onerror = () => reject(request.error);
						request.onsuccess = () => {
							const db = request.result;
							const transaction = db.transaction('images', 'readwrite');
							transaction.objectStore('images').clear();
							transaction.oncomplete = () => {
								db.close();
								resolve();
							};
							transaction.onerror = () => reject(transaction.error);
						};
					}),
			);
			release();
			await completed;
			await expect(dialog.getByLabel('Bild auswählen', { exact: true })).toBeVisible();
			await expect(dialog.getByText('Angehängt', { exact: true })).toHaveCount(0);
			const count = await page.evaluate(
				() =>
					new Promise<number>((resolve, reject) => {
						const request = indexedDB.open('manawg-offline-images', 1);
						request.onerror = () => reject(request.error);
						request.onsuccess = () => {
							const db = request.result;
							const transaction = db.transaction('images', 'readonly');
							const result = transaction.objectStore('images').count();
							result.onsuccess = () => resolve(result.result);
							result.onerror = () => reject(result.error);
							transaction.oncomplete = () => db.close();
						};
					}),
			);
			expect(count).toBe(0);
		} finally {
			release();
			await context.setOffline(false);
		}
	});

	test('a 503 without an error code keeps the receipt and retries later', async ({ page }) => {
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/expenses`);
		await page.getByRole('button', { name: 'Ausgabe hinzufügen', exact: true }).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByRole('button', { name: 'Beleg hinzufügen', exact: true }).click();
		await page.waitForLoadState('networkidle');
		await page.route('**/api/upload/sign', (route) =>
			route.fulfill({
				status: 503,
				contentType: 'text/html',
				body: '<html><body>503 Service Temporarily Unavailable</body></html>',
			}),
		);
		await dialog.getByLabel('Bild auswählen', { exact: true }).setInputFiles({
			name: 'proxy.png',
			mimeType: 'image/png',
			buffer: Buffer.from(
				'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGNgYGD4z4AGgCQAAEgAAj0t4HUAAAAASUVORK5CYII=',
				'base64',
			),
		});
		await expect(dialog.getByText('Angehängt', { exact: true })).toBeVisible();
		await expect(dialog.getByText(/Bild ist vorbereitet/)).toBeVisible();
		await expect(dialog.getByText('noch nicht konfiguriert')).toHaveCount(0);
	});

	test('a 503 with the feature-disabled code still disables the uploader', async ({ page }) => {
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/expenses`);
		await page.getByRole('button', { name: 'Ausgabe hinzufügen', exact: true }).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByRole('button', { name: 'Beleg hinzufügen', exact: true }).click();
		await page.waitForLoadState('networkidle');
		await page.route('**/api/upload/sign', (route) =>
			route.fulfill({
				status: 503,
				json: { error: 'feature_disabled', code: 'image_uploads_unavailable' },
			}),
		);
		await dialog.getByLabel('Bild auswählen', { exact: true }).setInputFiles({
			name: 'off.png',
			mimeType: 'image/png',
			buffer: Buffer.from(
				'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGNgYGD4z4AGgCQAAEgAAj0t4HUAAAAASUVORK5CYII=',
				'base64',
			),
		});
		await expect(dialog.getByText('noch nicht konfiguriert')).toBeVisible();
	});
});
