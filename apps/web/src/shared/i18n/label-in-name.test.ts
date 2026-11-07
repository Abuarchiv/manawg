import assert from 'node:assert/strict';
import test from 'node:test';

const { default: catalog } = await import('./messages');

type Tree = { [key: string]: string | Tree };

// [namespace path, visible label key, aria-label key]
const PAIRS: ReadonlyArray<readonly [string, string, string]> = [
	['shopping.list', 'clearBought', 'clearBoughtAria'],
	['settings.notifications', 'sendTest', 'sendTestAria'],
	['settings.notifications', 'sendTest', 'sendingTestAria'],
	['settings.data', 'json', 'jsonAria'],
	['settings.data', 'json', 'jsonPendingAria'],
	['settings.data', 'csv', 'csvAria'],
	['settings.data', 'csv', 'csvPendingAria'],
	['expenses.recurring', 'edit', 'editAria'],
	['expenses.recurring', 'manual', 'manualAria'],
];

function lookup(tree: Tree, path: string): Tree {
	return path.split('.').reduce<Tree>((node, part) => node[part] as Tree, tree);
}

// Lowercases, drops ICU placeholders and collapses whitespace.
function normalize(message: string): string {
	return message
		.replace(/\{[^}]*\}/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

for (const locale of ['de', 'en'] as const) {
	for (const [path, visibleKey, ariaKey] of PAIRS) {
		test(`${locale} ${path}.${ariaKey} contains the visible text of ${visibleKey} (WCAG 2.5.3)`, () => {
			const namespace = lookup(catalog[locale] as unknown as Tree, path);
			const visible = namespace[visibleKey];
			const aria = namespace[ariaKey];
			assert.equal(typeof visible, 'string');
			assert.equal(typeof aria, 'string');
			assert.ok(
				normalize(aria as string).includes(normalize(visible as string)),
				`"${aria}" must contain "${visible}"`,
			);
		});
	}
}

// The shared new-tab wrapper embeds the visible label, so the accessible name
// of every link that uses it still contains the visible text (WCAG 2.5.3).
for (const locale of ['de', 'en'] as const) {
	test(`${locale} common.opensInNewTab embeds the wrapped label`, () => {
		const message = lookup(catalog[locale] as unknown as Tree, 'common').opensInNewTab;
		assert.equal(typeof message, 'string');
		assert.ok((message as string).includes('{label}'));
	});
}
