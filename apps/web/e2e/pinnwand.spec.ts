// Pinnwand (announcements): archive, comment edit focus/layout and refresh.
// Why: refreshes must not clobber a comment being edited.

import { expect, test } from '@playwright/test';
import type { Announcement } from '../src/features/pinnwand/components/announcement-types';
import {
	FIXTURE_WG,
	dismissOnboarding,
	inMinimalMatrix,
	navigateToFeature,
	setupMember,
} from './support/helpers';

test.describe('pinnwand archive', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	const SHARE_CODE = 'MTE8PZAT';
	const MEMBER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

	function announcement(
		id: string,
		content: string,
		extra: Partial<Announcement> = {},
	): Announcement {
		return {
			id,
			authorMemberId: MEMBER_ID,
			content,
			imageUrl: null,
			kind: 'question',
			status: 'open',
			source: 'manual',
			sourcePath: null,
			pinnedAt: null,
			resolvedAt: null,
			resolvedByMemberId: null,
			createdAt: new Date().toISOString(),
			reactionCounts: {},
			myReactions: [],
			takers: [],
			comments: [],
			...extra,
		};
	}

	const openPost = announcement('archive-open', 'Offene Frage');
	const resolvedPost = announcement('archive-resolved', 'Geklärte Frage', {
		status: 'resolved',
		resolvedAt: '2026-09-20T09:00:00.000Z',
		resolvedByMemberId: MEMBER_ID,
		createdAt: '2026-09-20T08:00:00.000Z',
	});
	const staleInfo = announcement('archive-stale-info', 'Alte Info', {
		kind: 'info',
		createdAt: '2026-08-01T08:00:00.000Z',
	});

	for (const colorScheme of ['light', 'dark'] as const) {
		for (const rootFontSize of ['16px', '32px'] as const) {
			const textScale = rootFontSize === '32px' ? '200%' : 'normal';
			for (const width of [320, 390]) {
				if (!inMinimalMatrix({ width, dark: colorScheme === 'dark', large: textScale === '200%' }))
					continue;
				test(`Pinnwand archive toggle fits at ${width}px, ${colorScheme} mode, and ${textScale} text`, async ({
					page,
				}) => {
					await page.setViewportSize({ width, height: 800 });
					await page.emulateMedia({ colorScheme });
					await setupMember(page);
					await page.route(`**/api/wg/${SHARE_CODE}/announcements*`, (route) =>
						route.request().method() === 'GET'
							? route.fulfill({ json: { announcements: [openPost, resolvedPost, staleInfo] } })
							: route.continue(),
					);

					await navigateToFeature(page, `/wg/${SHARE_CODE}/pinnwand`);
					await dismissOnboarding(page);
					await page.evaluate((fontSize) => {
						document.documentElement.style.setProperty('font-size', fontSize, 'important');
					}, rootFontSize);

					const board = page.getByRole('list', { name: 'Pinnwand-Beiträge' });
					await expect(board.getByText('Offene Frage')).toBeVisible();
					await expect(board.getByText('Geklärte Frage')).toHaveCount(0);
					await expect(board.getByText('Alte Info')).toHaveCount(0);

					const toggle = page.getByRole('button', { name: 'Geklärt & älter (2)' });
					await expect(toggle).toHaveAttribute('aria-expanded', 'false');
					await expect(page.getByText('Geklärte Frage')).toBeHidden();
					await toggle.click();
					await expect(toggle).toHaveAttribute('aria-expanded', 'true');
					const archive = page.getByRole('list', { name: 'Geklärte und ältere Beiträge' });
					await expect(archive.getByText('Geklärte Frage')).toBeVisible();
					await expect(archive.getByText('Alte Info')).toBeVisible();

					const box = await toggle.boundingBox();
					expect(box?.height).toBeGreaterThanOrEqual(44);
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
					).toBe(true);
				});
			}
		}
	}

	test('a hash link to an archived post opens the archive and highlights it', async ({ page }) => {
		await setupMember(page);
		await page.route(`**/api/wg/${SHARE_CODE}/announcements*`, (route) =>
			route.request().method() === 'GET'
				? route.fulfill({ json: { announcements: [openPost, resolvedPost] } })
				: route.continue(),
		);

		await navigateToFeature(page, `/wg/${SHARE_CODE}/pinnwand#announcement-archive-resolved`);
		await dismissOnboarding(page);

		await expect(page.getByRole('button', { name: 'Geklärt & älter (1)' })).toHaveAttribute(
			'aria-expanded',
			'true',
		);
		await expect(page.locator('li#announcement-archive-resolved')).toBeInViewport();
	});

	test('Geklärt moves an open question into the archive', async ({ page }) => {
		await setupMember(page);
		let current = openPost;
		const patches: unknown[] = [];
		await page.route(`**/api/wg/${SHARE_CODE}/announcements**`, async (route) => {
			const request = route.request();
			if (request.method() === 'GET') {
				return route.fulfill({ json: { announcements: [current] } });
			}
			if (request.method() === 'PATCH') {
				patches.push(request.postDataJSON());
				current = {
					...openPost,
					status: 'resolved',
					resolvedAt: new Date().toISOString(),
					resolvedByMemberId: MEMBER_ID,
				};
				return route.fulfill({ json: { announcement: current, warning: null } });
			}
			return route.continue();
		});

		await navigateToFeature(page, `/wg/${SHARE_CODE}/pinnwand`);
		await dismissOnboarding(page);
		const board = page.getByRole('list', { name: 'Pinnwand-Beiträge' });
		await expect(board.getByText('Offene Frage')).toBeVisible();

		await page.getByRole('button', { name: 'Als geklärt markieren: Offene Frage' }).click();

		await expect.poll(() => patches).toEqual([{ status: 'resolved' }]);
		await expect(page.getByText('Nichts Offenes')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Geklärt & älter (1)' })).toHaveAttribute(
			'aria-expanded',
			'false',
		);
	});
});

test.describe('pinnwand comment edit focus', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	const ANNOUNCEMENT_ID = 'comment-edit-focus';

	function announcement() {
		return {
			id: ANNOUNCEMENT_ID,
			authorMemberId: FIXTURE_WG.memberId,
			content: 'Kommentar für den Fokus-Test',
			imageUrl: null,
			kind: 'info',
			status: 'open',
			source: 'manual',
			sourcePath: null,
			pinnedAt: null,
			resolvedAt: null,
			resolvedByMemberId: null,
			createdAt: new Date().toISOString(),
			reactionCounts: {},
			myReactions: [],
			takers: [],
			comments: [
				{
					id: 'comment-focus',
					announcementId: ANNOUNCEMENT_ID,
					memberId: FIXTURE_WG.memberId,
					content: 'Diese Antwort lässt sich bearbeiten.',
					createdAt: new Date().toISOString(),
					authorName: FIXTURE_WG.memberName,
					authorColor: null,
				},
			],
		};
	}

	for (const colorScheme of ['light', 'dark'] as const) {
		test(`moves focus into comment editor at 320px (${colorScheme})`, async ({ page }) => {
			await page.setViewportSize({ width: 320, height: 844 });
			await page.emulateMedia({ colorScheme });
			await setupMember(page);
			await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/announcements*`, (route) => {
				if (route.request().method() !== 'GET') return route.continue();
				return route.fulfill({ json: { announcements: [announcement()] } });
			});

			await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/pinnwand`);
			await dismissOnboarding(page);
			await expect
				.poll(async () =>
					page.locator('html').evaluate((element) => element.classList.contains('dark')),
				)
				.toBe(colorScheme === 'dark');

			const openReplies = page.getByRole('button', { name: /^Antworten anzeigen:/ });
			await openReplies.focus();
			await page.keyboard.press('Enter');
			const panel = page.locator(`#announcement-comments-${ANNOUNCEMENT_ID}`);
			const row = panel.locator('li').filter({ hasText: 'Diese Antwort lässt sich bearbeiten.' });
			const editButton = row.getByRole('button', { name: /^Antwort bearbeiten:/ });
			await expect(editButton).toBeVisible();
			await editButton.focus();
			await page.keyboard.press('Enter');

			const editor = row.getByRole('textbox', { name: 'Antwort bearbeiten' });
			await expect(editor).toBeVisible();
			await expect(editor).toBeFocused();
		});
	}

	test('restores saved comment and reply drafts without stealing focus', async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 844 });
		await page.emulateMedia({ colorScheme: 'light' });
		await setupMember(page);
		const draftKey = `manawg:draft:${FIXTURE_WG.shareCode}:${FIXTURE_WG.memberId}:announcement:${ANNOUNCEMENT_ID}`;
		await page.addInitScript(
			({ replyKey, editKey }) => {
				localStorage.setItem(replyKey, JSON.stringify({ content: 'Antwort-Entwurf' }));
				localStorage.setItem(editKey, JSON.stringify({ content: 'Bearbeitungs-Entwurf' }));
			},
			{ replyKey: `${draftKey}:reply`, editKey: `${draftKey}:edit:comment-focus` },
		);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/announcements*`, (route) => {
			if (route.request().method() !== 'GET') return route.continue();
			return route.fulfill({ json: { announcements: [announcement()] } });
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/pinnwand`);
		await dismissOnboarding(page);
		expect(await page.evaluate((key) => localStorage.getItem(key), `${draftKey}:reply`)).toBe(
			JSON.stringify({ content: 'Antwort-Entwurf' }),
		);
		const panel = page.locator(`#announcement-comments-${ANNOUNCEMENT_ID}`);
		await expect(panel).toBeVisible();
		const row = panel.locator('li').first();
		const editor = row.getByRole('textbox', { name: 'Antwort bearbeiten' });
		await expect(editor).toHaveValue('Bearbeitungs-Entwurf');
		await expect(panel.getByRole('textbox', { name: /^Antwort verfassen:/ })).toHaveValue(
			'Antwort-Entwurf',
		);
		await expect(editor).not.toBeFocused();
	});
});

test.describe('pinnwand comment layout', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	const ANNOUNCEMENT_ID = 'comment-layout';
	const AUTHOR_NAME = 'MaximilianMustermannLangname';
	const REPLY_TEXT = 'Ich kümmere mich darum.';
	const LONG_COMMENT =
		'Dieser lange Kommentar bleibt vollständig lesbar und läuft auch bei vergrößertem Text nicht aus der Pinnwand. '.repeat(
			3,
		) + 'UnunterbrochenesKommentarwort'.repeat(6);

	function announcement() {
		return {
			id: ANNOUNCEMENT_ID,
			authorMemberId: FIXTURE_WG.memberId,
			content: 'Langer Kommentar Layout-Test',
			imageUrl: null,
			kind: 'info',
			status: 'open',
			source: 'manual',
			sourcePath: null,
			pinnedAt: null,
			resolvedAt: null,
			resolvedByMemberId: null,
			createdAt: new Date().toISOString(),
			reactionCounts: {},
			myReactions: [],
			takers: [],
			comments: [
				{
					id: 'comment-long-name',
					announcementId: ANNOUNCEMENT_ID,
					memberId: FIXTURE_WG.memberId,
					content: LONG_COMMENT,
					createdAt: new Date().toISOString(),
					authorName: AUTHOR_NAME,
					authorColor: null,
				},
			],
		};
	}

	for (const width of [320, 360, 390] as const) {
		for (const largeText of [false, true] as const) {
			for (const colorScheme of ['light', 'dark'] as const) {
				if (!inMinimalMatrix({ width, dark: colorScheme === 'dark', large: largeText })) continue;
				test(`keeps Pinnwand comments usable at ${width}px, ${largeText ? '32px' : 'normal'} text, ${colorScheme}`, async ({
					page,
				}) => {
					await page.setViewportSize({ width, height: 844 });
					await page.emulateMedia({ colorScheme });
					await setupMember(page);
					await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/announcements*`, (route) => {
						if (route.request().method() !== 'GET') return route.continue();
						return route.fulfill({ json: { announcements: [announcement()] } });
					});

					await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/pinnwand`);
					await dismissOnboarding(page);
					if (largeText) {
						await page.evaluate(() => {
							document.documentElement.style.setProperty('font-size', '32px', 'important');
						});
					}
					await expect
						.poll(async () =>
							page.locator('html').evaluate((element) => element.classList.contains('dark')),
						)
						.toBe(colorScheme === 'dark');

					const openReplies = page.getByRole('button', { name: /^Antworten anzeigen:/ });
					await openReplies.focus();
					await page.keyboard.press('Enter');
					const panel = page.locator(`#announcement-comments-${ANNOUNCEMENT_ID}`);
					await expect(panel).toBeVisible();
					const row = panel.locator('li').filter({ hasText: AUTHOR_NAME });
					await expect(row).toBeVisible();

					const geometry = await row.evaluate((element, authorName) => {
						const author = [...element.querySelectorAll('span')].find(
							(span) => span.textContent === authorName,
						);
						if (!author) throw new Error('Comment author name not found');
						const { x, right } = author.getBoundingClientRect();
						return {
							x,
							right,
							scrollWidth: author.scrollWidth,
							clientWidth: author.clientWidth,
							viewportWidth: document.documentElement.clientWidth,
						};
					}, AUTHOR_NAME);
					expect(geometry.viewportWidth).toBe(width);
					expect(geometry.x).toBeGreaterThanOrEqual(0);
					expect(geometry.right).toBeLessThanOrEqual(width + 1);
					expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
					const commentMetrics = await row.locator('p').evaluate((element) => ({
						right: element.getBoundingClientRect().right,
						clientWidth: element.clientWidth,
						scrollWidth: element.scrollWidth,
					}));
					expect(commentMetrics.right).toBeLessThanOrEqual(width + 1);
					expect(commentMetrics.scrollWidth).toBeLessThanOrEqual(commentMetrics.clientWidth + 1);

					const editButton = row.getByRole('button', { name: /^Antwort bearbeiten:/ });
					const removeButton = row.getByRole('button', { name: /^Antwort entfernen:/ });
					for (const action of [editButton, removeButton]) {
						await expect(action).toBeVisible();
						const bounds = await action.boundingBox();
						expect(bounds).not.toBeNull();
						if (bounds) {
							expect(bounds.x).toBeGreaterThanOrEqual(0);
							expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
						}
					}
					await editButton.focus();
					await page.keyboard.press('Enter');
					await expect(row.getByRole('textbox', { name: 'Antwort bearbeiten' })).toBeVisible();
					await row.getByRole('button', { name: 'Abbrechen', exact: true }).click();

					const replyInput = panel.getByRole('textbox', { name: /^Antwort verfassen:/ });
					await expect(replyInput).toBeVisible();
					await replyInput.fill(REPLY_TEXT);
					const sendReply = panel.getByRole('button', { name: /^Antworten:/ });
					await expect(sendReply).toBeEnabled();
					const replyBounds = await sendReply.boundingBox();
					expect(replyBounds).not.toBeNull();
					if (replyBounds) expect(replyBounds.x + replyBounds.width).toBeLessThanOrEqual(width + 1);
				});
			}
		}
	}
});

test.describe('pinnwand refresh', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');
	test.use({ serviceWorkers: 'block' });

	const SHARE_CODE = 'MTE8PZAT';
	const MEMBER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

	function announcement(id: string, content: string, comments: Record<string, unknown>[] = []) {
		return {
			id,
			authorMemberId: MEMBER_ID,
			content,
			imageUrl: null,
			kind: 'info',
			status: 'open',
			source: 'manual',
			sourcePath: null,
			pinnedAt: null,
			resolvedAt: null,
			resolvedByMemberId: null,
			createdAt: new Date().toISOString(),
			reactionCounts: {},
			myReactions: [],
			takers: [],
			comments,
		};
	}

	function createRequestGate() {
		let markStarted: () => void = () => {};
		let release: () => void = () => {};
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		return { started, gate, markStarted, release };
	}

	test('keeps the Pinnwand loading skeleton within a 320px viewport at 200% text', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 320, height: 720 });
		await setupMember(page);

		let initialReadPending = true;
		const initialRead = createRequestGate();
		await page.route(`**/api/wg/${SHARE_CODE}/announcements*`, async (route) => {
			if (route.request().method() !== 'GET') return route.continue();
			if (initialReadPending) {
				initialReadPending = false;
				initialRead.markStarted();
				await initialRead.gate;
			}
			return route.fulfill({ json: { announcements: [] } });
		});

		await navigateToFeature(page, `/wg/${SHARE_CODE}/pinnwand`);
		await dismissOnboarding(page);
		await initialRead.started;

		const skeleton = page.getByLabel('Pinnwand wird geladen');
		await expect(skeleton).toBeVisible();
		await page.evaluate(() => {
			document.documentElement.style.setProperty('font-size', '200%', 'important');
		});
		const geometry = await skeleton.evaluate((root) => {
			const viewportWidth = document.documentElement.clientWidth;
			return {
				viewportWidth,
				rootFontSize: getComputedStyle(document.documentElement).fontSize,
				elements: [...root.querySelectorAll('*')]
					.filter((element) => element.getBoundingClientRect().right > viewportWidth + 0.5)
					.map((element) => ({
						className: element.className.toString(),
						left: element.getBoundingClientRect().left,
						right: element.getBoundingClientRect().right,
					})),
			};
		});
		initialRead.release();
		await expect(geometry.viewportWidth).toBe(320);
		await expect(geometry.rootFontSize).toBe('32px');
		await expect(geometry.elements).toEqual([]);
	});

	test('shows refresh error while cached Pinnwand posts stay visible', async ({ page }) => {
		await setupMember(page);
		let phase: 'startup' | 'controlled' = 'startup';
		let failReads = false;
		let failedReads = 0;
		let initialReadPending = true;
		const initialRead = createRequestGate();
		const cached = announcement('post-cached', 'Cache-Beitrag');
		await page.route(`**/api/wg/${SHARE_CODE}/announcements*`, async (route) => {
			if (route.request().method() !== 'GET') return route.continue();
			if (initialReadPending) {
				initialReadPending = false;
				initialRead.markStarted();
				await initialRead.gate;
			}
			if (phase === 'startup') {
				return route.fulfill({ json: { announcements: [cached] } });
			}
			if (failReads) {
				failedReads += 1;
				return route.fulfill({ status: 503, json: { error: 'service_unavailable' } });
			}
			return route.fulfill({ json: { announcements: [cached] } });
		});

		await navigateToFeature(page, `/wg/${SHARE_CODE}/pinnwand`);
		await dismissOnboarding(page);
		await initialRead.started;
		initialRead.release();
		await expect(page.getByText('Cache-Beitrag', { exact: true })).toBeVisible();
		await page.bringToFront();
		await page.waitForLoadState('networkidle');

		phase = 'controlled';
		failReads = true;
		await page.evaluate(() => window.dispatchEvent(new Event('focus')));
		await expect.poll(() => failedReads).toBeGreaterThanOrEqual(1);
		const retry = page.getByRole('button', { name: 'Pinnwand erneut laden' });
		await expect(retry).toBeVisible();
		await expect(page.getByText('Cache-Beitrag', { exact: true })).toBeVisible();
		failReads = false;
		await retry.click();
		await expect(retry).toBeHidden();
		await expect(page.getByText('Cache-Beitrag', { exact: true })).toBeVisible();
	});

	test('removes a cached Pinnwand post missing from the focus refresh', async ({ page }) => {
		await setupMember(page);
		let removeOnNextRead = false;
		let changedReads = 0;
		let initialReadPending = true;
		const initialRead = createRequestGate();
		const retained = announcement('post-retained', 'Bleibt sichtbar');
		const deleted = announcement('post-deleted', 'Serverseitig gelöscht');
		await page.route(`**/api/wg/${SHARE_CODE}/announcements*`, async (route) => {
			if (route.request().method() !== 'GET') return route.continue();
			if (initialReadPending) {
				initialReadPending = false;
				initialRead.markStarted();
				await initialRead.gate;
			}
			// Once the server deleted the post it stays deleted for every later read
			// (a focus can trigger more than one refresh).
			if (removeOnNextRead || changedReads > 0) {
				if (removeOnNextRead) changedReads += 1;
				removeOnNextRead = false;
				return route.fulfill({ json: { announcements: [retained] } });
			}
			return route.fulfill({
				json: { announcements: [retained, deleted] },
			});
		});

		await navigateToFeature(page, `/wg/${SHARE_CODE}/pinnwand`);
		await dismissOnboarding(page);
		await initialRead.started;
		initialRead.release();
		await expect(page.getByText('Bleibt sichtbar', { exact: true })).toBeVisible();
		await expect(page.getByText('Serverseitig gelöscht', { exact: true })).toBeVisible();

		removeOnNextRead = true;
		await page.evaluate(() => window.dispatchEvent(new Event('focus')));
		await expect.poll(() => changedReads).toBe(1);
		await expect(page.getByText('Serverseitig gelöscht', { exact: true })).toBeHidden();
		await expect(page.getByText('Bleibt sichtbar', { exact: true })).toBeVisible();
	});

	test('does not resurrect a deleted post after two pending refreshes', async ({ page }) => {
		await setupMember(page);
		let phase: 'startup' | 'controlled' = 'startup';
		let nextRefresh: ReturnType<typeof announcement>[] | null = null;
		let refreshReads = 0;
		let markSecondRefreshFulfilled: () => void = () => {};
		const secondRefreshFulfilled = new Promise<void>((resolve) => {
			markSecondRefreshFulfilled = resolve;
		});
		let initialReadPending = true;
		const initialRead = createRequestGate();
		const retained = announcement('post-retained-after-refresh', 'Beitrag A');
		const deleted = announcement('post-deleted-after-refresh', 'Beitrag B gelöscht');
		await page.route(`**/api/wg/${SHARE_CODE}/announcements*`, async (route) => {
			if (route.request().method() !== 'GET') return route.continue();
			if (initialReadPending) {
				initialReadPending = false;
				initialRead.markStarted();
				await initialRead.gate;
			}
			if (phase === 'startup') {
				return route.fulfill({ json: { announcements: [retained] } });
			}
			if (nextRefresh) {
				const response = nextRefresh;
				nextRefresh = null;
				refreshReads += 1;
				await route.fulfill({ json: { announcements: response } });
				if (refreshReads === 2) markSecondRefreshFulfilled();
				return;
			}
			return route.fulfill({ json: { announcements: [retained] } });
		});

		await navigateToFeature(page, `/wg/${SHARE_CODE}/pinnwand`);
		await dismissOnboarding(page);
		await initialRead.started;
		initialRead.release();
		await expect(page.getByText('Beitrag A', { exact: true })).toBeVisible();
		await page.bringToFront();
		await page.waitForLoadState('networkidle');

		phase = 'controlled';
		const pendingButton = page.getByRole('button', { name: /neue Beitr/ });
		nextRefresh = [retained, deleted];
		await page.evaluate(() => window.dispatchEvent(new Event('focus')));
		await expect.poll(() => refreshReads).toBe(1);
		await expect(pendingButton).toBeVisible();

		nextRefresh = [retained];
		await page.evaluate(() => window.dispatchEvent(new Event('focus')));
		await expect.poll(() => refreshReads).toBe(2);
		await secondRefreshFulfilled;
		await expect(pendingButton).toBeHidden();
		await expect(page.getByText('Beitrag A', { exact: true })).toBeVisible();
		await expect(page.getByText('Beitrag B gelöscht', { exact: true })).toBeHidden();
	});

	test('comment delete requires confirmation and only removes the comment once confirmed', async ({
		page,
	}) => {
		await setupMember(page);
		const post = announcement('post-with-comment', 'Beitrag mit Kommentar', [
			{
				id: 'comment-1',
				announcementId: 'post-with-comment',
				memberId: MEMBER_ID,
				content: 'Testkommentar',
				createdAt: new Date().toISOString(),
				authorName: 'dsaf',
				authorColor: null,
			},
		]);
		let deleteRequests = 0;
		await page.route(`**/api/wg/${SHARE_CODE}/announcements*`, async (route) => {
			if (route.request().method() !== 'GET') return route.continue();
			return route.fulfill({ json: { announcements: [post] } });
		});
		await page.route(
			`**/api/wg/${SHARE_CODE}/announcements/post-with-comment/comments/comment-1`,
			async (route) => {
				if (route.request().method() !== 'DELETE') return route.continue();
				deleteRequests += 1;
				post.comments = [];
				return route.fulfill({ json: {} });
			},
		);

		await navigateToFeature(page, `/wg/${SHARE_CODE}/pinnwand`);
		await dismissOnboarding(page);
		await expect(page.getByText('Beitrag mit Kommentar', { exact: true })).toBeVisible();

		await page.getByRole('button', { name: /Antworten anzeigen/ }).click();
		await expect(page.getByText('Testkommentar', { exact: true })).toBeVisible();

		const deleteTrigger = page.getByRole('button', { name: /Antwort entfernen: Testkommentar/ });
		await deleteTrigger.click();

		const dialog = page.getByRole('alertdialog', { name: 'Antwort entfernen?' });
		await expect(dialog).toBeVisible();
		await expect(page.getByText('Testkommentar', { exact: true })).toBeVisible();

		// Cancel keeps the comment and never calls the API.
		await dialog.getByRole('button', { name: 'Abbrechen' }).click();
		await expect(dialog).toBeHidden();
		await expect(page.getByText('Testkommentar', { exact: true })).toBeVisible();
		expect(deleteRequests).toBe(0);

		// Confirming removes the comment and calls the delete endpoint exactly once.
		await deleteTrigger.click();
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: /Antwort entfernen bestätigen/ }).click();
		await expect.poll(() => deleteRequests).toBe(1);
		await expect(page.getByText('Testkommentar', { exact: true })).toBeHidden();
	});

	test('returns focus to the create button after posting', async ({ page }) => {
		await setupMember(page);
		await page.route(`**/api/wg/${SHARE_CODE}/announcements*`, async (route) => {
			if (route.request().method() === 'POST') {
				return route.fulfill({
					status: 201,
					json: { announcement: announcement('new-post', 'Hallo') },
				});
			}
			return route.fulfill({ json: { announcements: [] } });
		});
		await navigateToFeature(page, `/wg/${SHARE_CODE}/pinnwand`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: 'Beitrag hinzufügen' }).click();
		await page.getByLabel('Beitragstext').fill('Hallo');
		await page.getByRole('button', { name: 'Posten', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Beitrag hinzufügen' })).toBeFocused();
	});
});
