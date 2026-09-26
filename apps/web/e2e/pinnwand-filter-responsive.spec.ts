import { expect, test } from '@playwright/test';
import { dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

const SHARE_CODE = 'MTE8PZAT';
const MEMBER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

const announcement = {
	id: 'filter-responsive-post',
	authorMemberId: MEMBER_ID,
	content: 'Filter-Beitrag',
	imageUrl: null,
	kind: 'info',
	status: 'open',
	source: 'manual',
	sourcePath: null,
	pinnedAt: null,
	resolvedAt: null,
	resolvedByMemberId: null,
	createdAt: '2026-09-20T08:00:00.000Z',
	reactionCounts: {},
	myReactions: [],
	takers: [],
	comments: [],
};

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

for (const colorScheme of ['light', 'dark'] as const) {
	for (const rootFontSize of ['16px', '32px'] as const) {
		const textScale = rootFontSize === '32px' ? '200%' : 'normal';
		for (const width of [320, 360, 390]) {
			test(`Pinnwand filter targets hold at ${width}px, ${colorScheme} mode, and ${textScale} text`, async ({
				page,
			}) => {
				await page.setViewportSize({ width, height: 800 });
				await page.emulateMedia({ colorScheme });
				await setupMember(page);
				let initialReadPending = true;
				const initialRead = createRequestGate();
				await page.route(`**/api/wg/${SHARE_CODE}/announcements*`, async (route) => {
					if (route.request().method() === 'GET') {
						if (initialReadPending) {
							initialReadPending = false;
							initialRead.markStarted();
							await initialRead.gate;
						}
						return route.fulfill({ json: { announcements: [announcement] } });
					}
					return route.continue();
				});

				await navigateToFeature(page, `/wg/${SHARE_CODE}/pinnwand`);
				await dismissOnboarding(page);
				await initialRead.started;
				initialRead.release();
				await expect(page.getByRole('button', { name: 'Geklärt', exact: true })).toBeVisible();
				await page.evaluate((fontSize) => {
					document.documentElement.style.setProperty('font-size', fontSize, 'important');
				}, rootFontSize);

				const themeIsDark = await page
					.locator('html')
					.evaluate((element) => element.classList.contains('dark'));
				expect(themeIsDark).toBe(colorScheme === 'dark');
				expect(
					await page.locator('html').evaluate((element) => getComputedStyle(element).fontSize),
				).toBe(rootFontSize);

				const filterButton = page.getByRole('button', { name: 'Filter', exact: true });
				const resolvedButton = page.getByRole('button', { name: 'Geklärt', exact: true });
				const resolvedBox = await resolvedButton.boundingBox();
				if (!resolvedBox) throw new Error('Geklärt filter button has no visible bounds');
				const clickPoint = {
					x: resolvedBox.x + resolvedBox.width / 2,
					y: resolvedBox.y + resolvedBox.height / 2,
				};
				const hitButton = await page.evaluate(({ x, y }) => {
					const button = document.elementFromPoint(x, y)?.closest('button');
					return button?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
				}, clickPoint);

				// Use a physical pointer click at the button center to catch overlapping hit regions.
				await page.mouse.click(clickPoint.x, clickPoint.y);
				expect({
					hitButton,
					filterExpanded: await filterButton.getAttribute('aria-expanded'),
				}).toEqual({
					hitButton: 'Geklärt',
					filterExpanded: 'false',
				});
				await expect(resolvedButton).toHaveAttribute('aria-pressed', 'true');
				await expect(filterButton).toHaveAttribute('aria-expanded', 'false');

				const openButton = page.getByRole('button', { name: 'Offen', exact: true });
				await openButton.focus();
				await page.keyboard.press('Enter');
				await expect(openButton).toHaveAttribute('aria-pressed', 'true');
				await expect(resolvedButton).toHaveAttribute('aria-pressed', 'false');
				await expect(filterButton).toHaveAttribute('aria-expanded', 'false');

				const geometry = await page.evaluate(() => {
					const statusGroup = document.querySelector<HTMLElement>(
						'[data-slot="toggle-group"][aria-label="Status filtern"]',
					);
					const filter = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
						(button) => button.textContent?.trim().startsWith('Filter'),
					);
					return {
						viewportWidth: document.documentElement.clientWidth,
						scrollWidth: document.documentElement.scrollWidth,
						statusRight: statusGroup?.getBoundingClientRect().right ?? Number.POSITIVE_INFINITY,
						filterRight: filter?.getBoundingClientRect().right ?? Number.POSITIVE_INFINITY,
					};
				});
				expect(geometry.viewportWidth).toBe(width);
				expect(geometry.scrollWidth).toBeLessThanOrEqual(width);
				expect(geometry.statusRight).toBeLessThanOrEqual(width + 0.5);
				expect(geometry.filterRight).toBeLessThanOrEqual(width + 0.5);
			});
		}
	}
}
