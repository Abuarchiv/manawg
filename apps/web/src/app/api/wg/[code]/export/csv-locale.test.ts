import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const loaderLocales: unknown[] = [];
const ROWS = [
	{ id: 'e1', description: 'Reis', amountCents: 2480, currency: 'EUR', splits: [], paidBy: 'Anna' },
];

mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: true,
			wg: { id: 'wg', name: 'WG', shareCode: 'MTE8PZAT' },
			member: { memberId: 'member' },
		}),
	},
});
mock.module('@/core/rate-limit', {
	namedExports: { wgExportLimiter: {}, checkRateLimit: async () => ({ success: true }) },
});
mock.module('@/composition/export-queries', {
	namedExports: {
		MEMBER_NAME_SECTIONS: [],
		NO_EXPORT_LIMIT: Number.MAX_SAFE_INTEGER,
		buildSectionLoaders: (_wgId: string, _page: unknown, _members: unknown, locale: unknown) => {
			loaderLocales.push(locale);
			return { expenses: async () => ROWS };
		},
		countExportSections: async () => ({}),
		fetchMemberRows: async () => [],
		mapMemberRows: () => [],
		toMemberById: () => new Map(),
	},
});

const { GET } = await import('./route');

function download(cookie?: string, acceptLanguage?: string) {
	const headers = new Headers(acceptLanguage ? { 'accept-language': acceptLanguage } : {});
	return GET(
		{
			nextUrl: new URL('https://example.invalid/export?format=csv&section=expenses'),
			cookies: {
				get: (name: string) => (cookie && name === 'manawg_locale' ? { value: cookie } : undefined),
			},
			headers,
		} as never,
		{ params: Promise.resolve({ code: 'MTE8PZAT' }) } as never,
	);
}

test('an English downloader gets a comma-separated CSV with a decimal point', async () => {
	const text = await (await download('en')).text();
	assert.ok(text.includes('\ne1,Reis,'), text);
	assert.ok(text.includes(',24.80,'), text);
	assert.equal(loaderLocales.at(-1), 'en');
});

test('a German or undecided downloader keeps the semicolon CSV', async () => {
	for (const response of [await download('de'), await download(undefined, 'de-DE')]) {
		const text = await response.text();
		assert.ok(text.includes('\ne1;Reis;'), text);
		assert.ok(text.includes(';24,80;'), text);
		assert.equal(loaderLocales.at(-1), 'de');
	}
});
