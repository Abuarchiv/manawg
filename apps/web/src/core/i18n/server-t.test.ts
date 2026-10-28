import assert from 'node:assert/strict';
import test from 'node:test';

const { renderMessage, serverRootT, serverT } = await import('./server-t');
const { resolveMessage } = await import('@/shared/i18n/message');

test('serverT renders the catalog of the requested locale', () => {
	assert.equal(serverT('de', 'common')('skipToContent'), 'Zum Hauptinhalt springen');
	assert.equal(serverT('en', 'common')('skipToContent'), 'Skip to main content');
});

test('renderMessage resolves a message key through the root translator', () => {
	assert.equal(
		renderMessage(serverRootT('en'), { key: 'common.skipToContent' }),
		'Skip to main content',
	);
});

test('resolveMessage renders nested message values before the outer message', () => {
	const calls: string[] = [];
	const translate = (key: string, values?: Record<string, string | number>) => {
		calls.push(key);
		return `${key}(${Object.entries(values ?? {})
			.map(([k, v]) => `${k}=${v}`)
			.join(',')})`;
	};
	const out = resolveMessage(translate, {
		key: 'common.skipToContent',
		values: { n: 2, inner: { key: 'meta.brand.title', values: { x: 'a' } } },
	});
	assert.equal(out, 'common.skipToContent(n=2,inner=meta.brand.title(x=a))');
	assert.deepEqual(calls, ['meta.brand.title', 'common.skipToContent']);
});
