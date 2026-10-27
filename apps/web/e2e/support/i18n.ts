// Helpers for the English-locale E2E specs.

import { type BrowserContext, type Page, expect } from '@playwright/test';
import { LOCALE_COOKIE } from '../../src/shared/i18n/locale';

/** Sets the English language cookie for every page of `context`. */
export async function setEnglishLocale(context: BrowserContext, baseURL: string): Promise<void> {
	await context.addCookies([{ name: LOCALE_COOKIE, value: 'en', url: baseURL }]);
}

/** German UI words that must not appear in English chrome; fixture user content is not scanned. */
const GERMAN_CHROME_WORDS = [
	'Abbrechen',
	'Abmelden',
	'Abrechnung',
	'Aktivität',
	'Anmelden',
	'Ausgaben',
	'Bearbeiten',
	'Einkauf',
	'Einladung',
	'Einstellungen',
	'Erledigt',
	'Hinzufügen',
	'Kalender',
	'Löschen',
	'Mitbewohner',
	'Mitglieder',
	'Passwort',
	'Pinnwand',
	'Putzplan',
	'Schließen',
	'Schulden',
	'Speichern',
	'Vorräte',
	'Weiter',
	'Zum Hauptinhalt',
	'Zurück',
];

const CHROME_SELECTOR =
	'nav, header, button, [role=tab], label, h1, h2, h3, .skip-link, [aria-label], [placeholder]';

/** Fails when navigation, buttons, tabs, labels, headings, aria-labels or placeholders show German UI words. */
export async function expectNoGermanChrome(page: Page): Promise<void> {
	const pattern = GERMAN_CHROME_WORDS.map((word) => `(?<![\\p{L}])${word}(?![\\p{L}])`).join('|');
	const offenders = await page.evaluate(
		({ selector, source }) => {
			const re = new RegExp(source, 'u');
			const hits = new Set<string>();
			const check = (text: string | null) => {
				const match = text ? re.exec(text) : null;
				if (match) hits.add(match[0]);
			};
			for (const element of document.querySelectorAll(selector)) {
				check(element.textContent);
				check(element.getAttribute('aria-label'));
				check(element.getAttribute('placeholder'));
			}
			return [...hits];
		},
		{ selector: CHROME_SELECTOR, source: pattern },
	);
	expect(offenders, 'German UI words in English chrome').toEqual([]);
}

/** Fails when the page scrolls sideways at a 320px viewport. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
	await page.setViewportSize({ width: 320, height: 780 });
	const widths = await page.evaluate(() => ({
		scroll: document.documentElement.scrollWidth,
		client: document.documentElement.clientWidth,
	}));
	expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}
