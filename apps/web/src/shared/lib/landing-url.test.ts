import assert from 'node:assert/strict';
import test from 'node:test';
import { withEnv } from '../../../tests/support/env';

const NONE = {
	NEXT_PUBLIC_APP_URL: undefined,
	NEXT_PUBLIC_LEGAL_URL: undefined,
	NEXT_PUBLIC_SUPPORT_EMAIL: undefined,
};

// The modules read NEXT_PUBLIC_* once at load time, as the bundler inlines them; a query string
// gives each case a fresh copy.
let loads = 0;
async function loadWith(env: Record<string, string | undefined>) {
	const id = ++loads;
	return withEnv({ ...NONE, ...env }, async () => {
		const robots = await import(`../../app/robots.ts?case=${id}`);
		return {
			landing: await import(`./landing-url.ts?case=${id}`),
			support: await import(`./support-mailto.ts?case=${id}`),
			// robots() reads the env on every call.
			sitemap: (robots.default() as { sitemap?: string }).sitemap,
		};
	});
}

test('an empty env is not the official instance and has no legal pages or support address', async () => {
	const { landing, support } = await loadWith({});
	assert.equal(landing.IS_OFFICIAL_INSTANCE, false);
	assert.equal(landing.legalUrl('/impressum'), null);
	assert.equal(support.SUPPORT_MAILTO, null);
});

test('another app origin is not the official instance either', async () => {
	const { landing, support, sitemap } = await loadWith({
		NEXT_PUBLIC_APP_URL: 'https://wg.example.com',
	});
	assert.equal(landing.IS_OFFICIAL_INSTANCE, false);
	assert.equal(landing.legalUrl('/datenschutz'), null);
	assert.equal(support.SUPPORT_MAILTO, null);
	assert.equal(sitemap, undefined);
});

test('a self-hosted instance uses its own legal pages and support address', async () => {
	const { landing, support } = await loadWith({
		NEXT_PUBLIC_APP_URL: 'https://wg.example.com',
		NEXT_PUBLIC_LEGAL_URL: ' https://example.com/ ',
		NEXT_PUBLIC_SUPPORT_EMAIL: 'admin@example.com',
	});
	assert.equal(landing.IS_OFFICIAL_INSTANCE, false);
	assert.equal(landing.legalUrl('/agb'), 'https://example.com/agb');
	assert.equal(support.SUPPORT_MAILTO, 'mailto:admin@example.com?subject=Fehler%20in%20ManaWG');
});

test('the official app origin gets the landing legal pages, the support address and the sitemap', async () => {
	for (const appUrl of ['https://app.manawg.com', 'https://app.manawg.com/']) {
		const { landing, support, sitemap } = await loadWith({ NEXT_PUBLIC_APP_URL: appUrl });
		assert.equal(landing.IS_OFFICIAL_INSTANCE, true);
		assert.equal(landing.legalUrl('/impressum'), 'https://manawg.com/impressum');
		assert.equal(support.SUPPORT_MAILTO, 'mailto:info@manawg.com?subject=Fehler%20in%20ManaWG');
		assert.equal(sitemap, 'https://manawg.com/sitemap.xml');
	}
});

test('isOfficialInstance compares origins and ignores unusable values', async () => {
	const { landing } = await loadWith({});
	assert.equal(landing.isOfficialInstance('https://app.manawg.com/wg/x'), true);
	assert.equal(landing.isOfficialInstance('http://app.manawg.com'), false);
	assert.equal(landing.isOfficialInstance('https://manawg.com'), false);
	assert.equal(landing.isOfficialInstance('not a url'), false);
	assert.equal(landing.isOfficialInstance(undefined), false);
	assert.equal(landing.isOfficialInstance(''), false);
});
