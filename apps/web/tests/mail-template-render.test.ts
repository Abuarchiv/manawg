import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderTemplate, selectLocale } from '../../../supabase/templates/render.mjs';

const footer =
	'<a href="https://app.manawg.com" style="x">app.manawg.com</a> &middot; ' +
	'<a href="https://manawg.com/impressum" style="x">{{ if eq .Data.locale "en" }}Legal notice{{ else }}Impressum{{ end }}</a> &middot; ' +
	'<a href="https://manawg.com/datenschutz" style="x">Datenschutz</a>';

test('the footer points at the app and legal pages of the instance', () => {
	const out = renderTemplate(footer, 'https://wg.example.com', 'https://example.com');
	assert.match(out, /href="https:\/\/wg\.example\.com"[^>]*>wg\.example\.com</);
	assert.match(out, /href="https:\/\/example\.com\/impressum"/);
	assert.match(out, /href="https:\/\/example\.com\/datenschutz"/);
	assert.doesNotMatch(out, /manawg\.com/);
});

test('without legal pages the footer keeps only the app link', () => {
	const out = renderTemplate(footer, 'https://wg.example.com', null);
	assert.equal(out, '<a href="https://wg.example.com" style="x">wg.example.com</a>');
});

test('the password-changed mail only promises what the app does', () => {
	const html = readFileSync(
		new URL('../../../supabase/templates/password_changed.html', import.meta.url),
		'utf8',
	);
	assert.match(html, /<a href="\{\{ \.SiteURL \}\}\/login"/);
	for (const locale of ['de', 'en']) {
		const text = selectLocale(html, locale);
		assert.doesNotMatch(text, /sign out all sessions|sperren wir alle Sitzungen/i);
	}
	assert.match(selectLocale(html, 'de'), /„Passwort vergessen\?“/);
	assert.match(selectLocale(html, 'en'), /“Forgot your password\?”/);
});

test('the email-change mail names both addresses and says both links are needed', () => {
	const html = readFileSync(
		new URL('../../../supabase/templates/email_change.html', import.meta.url),
		'utf8',
	);
	const subjects = JSON.parse(
		readFileSync(new URL('../../../supabase/templates/subjects.json', import.meta.url), 'utf8'),
	);
	for (const [locale, both] of [
		['de', /beide/],
		['en', /both/],
	] as const) {
		const text = selectLocale(html, locale);
		assert.match(text, /\{\{ \.Email \}\}/);
		assert.match(text, /\{\{ \.NewEmail \}\}/);
		assert.match(text, both);
	}
	assert.doesNotMatch(subjects.email_change, /neue E-Mail-Adresse|new email address/);
});
