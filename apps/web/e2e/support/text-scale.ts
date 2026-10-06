// Root text scaling for the 320px / 200% text matrix specs.
//
// The override is an adopted constructable stylesheet (`html { font-size: N% !important }`)
// instead of an inline style on <html> or a <style>/<link> element:
// - React removes every attribute of <html>, inline `style` included, whenever it acquires the
//   html singleton outside hydration (commitHostSingletonAcquisition, e.g. when a hydration error
//   outside a Suspense boundary switches the root to client rendering) or releases it
//   (releaseSingletonInstance). A later read then returns the CSS base `html { font-size: 90% }`
//   = 14.4px, the value a single read after an inline 200% write has reported under load.
//   Adopted stylesheets are not DOM nodes, so neither React nor Next touch them.
// - The CSP only admits <style> and <link> elements that carry the request nonce; constructable
//   stylesheets are not subject to style-src.
// - A new document (reload, hard navigation) starts without the override unless
//   `persistAcrossNavigation` re-adopts it from an init script at document start.
// After writing, the helper polls the computed root size, so a test measures only once the scale
// is in effect.

import { type Page, expect } from '@playwright/test';

const OVERRIDE_KEY = '__manawgE2eRootTextScale';
const BROWSER_DEFAULT_FONT_SIZE_PX = 16;
const persistentPages = new WeakSet<Page>();

type OverrideArgs = {
	key: string;
	/** Stylesheet text; omitted in the init script, which reads the persisted value instead. */
	css?: string;
	persist?: boolean;
};

// Serialized into the page, so it must stay self-contained.
function syncOverride({ key, css, persist }: OverrideArgs): void {
	let rule = css;
	try {
		if (rule === undefined) rule = sessionStorage.getItem(key) ?? undefined;
		else if (persist && rule) sessionStorage.setItem(key, rule);
		else sessionStorage.removeItem(key);
	} catch {
		// Opaque origins (about:blank) have no sessionStorage; the current document still applies.
	}
	const holder = window as unknown as Record<string, CSSStyleSheet | undefined>;
	let sheet = holder[key];
	if (!sheet) {
		if (!rule) return;
		sheet = new CSSStyleSheet();
		holder[key] = sheet;
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
	}
	sheet.replaceSync(rule ?? '');
}

function readRootFontSize(page: Page): Promise<string> {
	return page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
}

/**
 * Scales the root font size to `scalePercent` of the 16px browser default (200 = 32px) and
 * waits until `getComputedStyle(html).fontSize` reports it.
 *
 * With `persistAcrossNavigation`, later documents of the same origin in this page re-apply the
 * scale at document start; call it after the page reached the app origin.
 */
export async function applyRootTextScale(
	page: Page,
	scalePercent: number,
	options: { persistAcrossNavigation?: boolean } = {},
): Promise<void> {
	const persist = options.persistAcrossNavigation === true;
	if (persist && !persistentPages.has(page)) {
		persistentPages.add(page);
		await page.addInitScript(syncOverride, { key: OVERRIDE_KEY });
	}
	await page.evaluate(syncOverride, {
		key: OVERRIDE_KEY,
		css: `html { font-size: ${scalePercent}% !important; }`,
		persist,
	});
	const expected = `${(scalePercent * BROWSER_DEFAULT_FONT_SIZE_PX) / 100}px`;
	await expect
		.poll(() => readRootFontSize(page), { message: `root font size at ${scalePercent}% text` })
		.toBe(expected);
}

/**
 * Removes the override (including its persisted copy), so the root falls back to the app's own
 * fluid base size. Dropping an adopted rule takes effect on the next style read, so there is
 * nothing to wait for.
 */
export async function resetRootTextScale(page: Page): Promise<void> {
	await page.evaluate(syncOverride, { key: OVERRIDE_KEY, css: '' });
}
