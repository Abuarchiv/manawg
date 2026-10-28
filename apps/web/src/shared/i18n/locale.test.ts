import assert from 'node:assert/strict';
import test from 'node:test';

const { DEFAULT_LOCALE, clearLocaleCookie, deviceLocale, htmlLang, localeCookie, resolveLocale } =
	await import('./locale');

test('a valid cookie wins over Accept-Language', () => {
	assert.equal(resolveLocale({ cookie: 'en', acceptLanguage: 'de-DE,de;q=0.9' }), 'en');
	assert.equal(resolveLocale({ cookie: 'de', acceptLanguage: 'en-GB' }), 'de');
});

test('an invalid or missing cookie falls through to Accept-Language', () => {
	assert.equal(resolveLocale({ cookie: 'fr', acceptLanguage: 'en' }), 'en');
	assert.equal(resolveLocale({ cookie: '', acceptLanguage: 'en' }), 'en');
	assert.equal(resolveLocale({ cookie: null, acceptLanguage: 'en-US' }), 'en');
});

test('Accept-Language is sorted by q and the first supported primary subtag wins', () => {
	assert.equal(resolveLocale({ acceptLanguage: 'de;q=0.5, en;q=0.9' }), 'en');
	assert.equal(resolveLocale({ acceptLanguage: 'en;q=0.4, de-AT;q=0.8' }), 'de');
	assert.equal(resolveLocale({ acceptLanguage: 'fr-FR, en;q=0.8, de;q=0.7' }), 'en');
	assert.equal(resolveLocale({ acceptLanguage: 'EN-gb' }), 'en');
});

test('equal q keeps header order', () => {
	assert.equal(resolveLocale({ acceptLanguage: 'en, de' }), 'en');
	assert.equal(resolveLocale({ acceptLanguage: 'de, en' }), 'de');
});

test('only unsupported languages fall back to English, unless English is refused', () => {
	assert.equal(resolveLocale({ acceptLanguage: 'fr, ja;q=0.8' }), 'en');
	assert.equal(resolveLocale({ acceptLanguage: 'tr-TR' }), 'en');
	assert.equal(resolveLocale({ acceptLanguage: 'tr-TR, de;q=0.5' }), 'de');
	assert.equal(resolveLocale({ acceptLanguage: 'en;q=0, fr' }), DEFAULT_LOCALE);
});

test('wildcard, q=0 and malformed q are ignored', () => {
	assert.equal(resolveLocale({ acceptLanguage: '*' }), DEFAULT_LOCALE);
	assert.equal(resolveLocale({ acceptLanguage: 'en;q=abc' }), DEFAULT_LOCALE);
	assert.equal(resolveLocale({ acceptLanguage: ';;,,' }), DEFAULT_LOCALE);
	assert.equal(resolveLocale({ acceptLanguage: '*, en;q=0.1' }), 'en');
});

test('nothing at all resolves to German', () => {
	assert.equal(resolveLocale({}), 'de');
	assert.equal(resolveLocale({ acceptLanguage: null, cookie: undefined }), 'de');
});

test('the cookie is path-wide, one year, Lax and Secure outside http', () => {
	assert.equal(
		localeCookie('en'),
		'manawg_locale=en; path=/; max-age=31536000; SameSite=Lax; Secure',
	);
});

test('the cookie drops Secure on a plain http page', () => {
	const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
	Object.defineProperty(globalThis, 'location', {
		value: { protocol: 'http:' },
		configurable: true,
	});
	try {
		assert.equal(localeCookie('de'), 'manawg_locale=de; path=/; max-age=31536000; SameSite=Lax');
	} finally {
		if (original) Object.defineProperty(globalThis, 'location', original);
		else Reflect.deleteProperty(globalThis, 'location');
	}
});

test('the html lang keeps German bare and marks English as en-GB', () => {
	assert.equal(htmlLang('de'), 'de');
	assert.equal(htmlLang('en'), 'en-GB');
});

test('clearing the cookie expires it at once', () => {
	assert.equal(clearLocaleCookie(), 'manawg_locale=; path=/; max-age=0; SameSite=Lax');
});

test('the device locale reads navigator.languages in order', () => {
	const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	const as = (languages: string[]) =>
		Object.defineProperty(globalThis, 'navigator', {
			value: { languages, language: languages[0] },
			configurable: true,
		});
	try {
		as(['en-US', 'de']);
		assert.equal(deviceLocale(), 'en');
		as(['es-ES', 'de-DE']);
		assert.equal(deviceLocale(), 'de');
		as(['es-ES']);
		assert.equal(deviceLocale(), 'en');
	} finally {
		if (original) Object.defineProperty(globalThis, 'navigator', original);
	}
});
