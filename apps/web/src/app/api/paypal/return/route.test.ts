import assert from 'node:assert/strict';
import test from 'node:test';

const { NextRequest } = await import('next/server');
const { GET } = await import('./route');

function request(headers: Record<string, string> = {}) {
	return new NextRequest('https://app.example/api/paypal/return', { headers });
}

test('paypal return page without a trusted origin is German by default', async () => {
	const res = GET(request());
	const html = await res.text();
	assert.equal(res.status, 503);
	assert.match(html, /<html lang="de">/);
	assert.match(html, /<title>PayPal-Verbindung – ManaWG<\/title>/);
	assert.match(html, /<h1>PayPal-Verbindung gerade nicht möglich<\/h1>/);
	assert.match(
		html,
		/<p>Die Verbindung konnte nicht abgeschlossen werden\. Öffne ManaWG und versuche es in den Einstellungen deiner WG erneut\.<\/p><p><a href="\/">Zu ManaWG<\/a><\/p>/,
	);
});

test('paypal return page follows the locale cookie and Accept-Language', async () => {
	const byCookie = await GET(request({ cookie: 'manawg_locale=en' })).text();
	assert.match(byCookie, /<html lang="en-GB">/);
	assert.match(byCookie, /<h1>PayPal connection is not available right now<\/h1>/);
	assert.match(byCookie, /<a href="\/">Go to ManaWG<\/a>/);
	const byHeader = await GET(request({ 'accept-language': 'en-GB,en;q=0.9' })).text();
	assert.match(byHeader, /<html lang="en-GB">/);
	const cookieWins = await GET(
		request({ cookie: 'manawg_locale=de', 'accept-language': 'en' }),
	).text();
	assert.match(cookieWins, /<html lang="de">/);
});
