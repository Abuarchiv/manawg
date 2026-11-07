import assert from 'node:assert/strict';
import test from 'node:test';

const { default: catalog } = await import('./messages');

// The sign-in page has no code field: members come back through their flats list and new
// members join with an invite link, so the offline flats card must not ask for a code.
for (const locale of ['de', 'en', 'es'] as const) {
	const flats = catalog[locale].offline.page.flats;

	test(`${locale} offline flats copy never asks for a code`, () => {
		for (const [key, message] of Object.entries(flats) as [string, string][]) {
			assert.doesNotMatch(
				message,
				/\b(?:code|c[oó]digo)\b/i,
				`offline.page.flats.${key} mentions a code`,
			);
		}
	});
}

test('en offline flats copy points to sign-in and invite links', () => {
	const flats = catalog.en.offline.page.flats;
	assert.match(flats.noneRemembered, /invite link/);
	assert.match(flats.noneRememberedOffline, /invite link/);
	assert.match(flats.codeMissing, /sign-in/);
});

test('de offline flats copy points to Anmeldung and Einladungslink', () => {
	const flats = catalog.de.offline.page.flats;
	assert.match(flats.noneRemembered, /Einladungslink/);
	assert.match(flats.noneRememberedOffline, /Einladungslink/);
	assert.match(flats.codeMissing, /Anmeldeseite/);
});
