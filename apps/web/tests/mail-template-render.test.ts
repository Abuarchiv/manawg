import assert from 'node:assert/strict';
import test from 'node:test';
import { renderTemplate } from '../../../supabase/templates/render.mjs';

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
