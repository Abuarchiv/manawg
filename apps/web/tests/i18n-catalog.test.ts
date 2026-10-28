import assert from 'node:assert/strict';
import test from 'node:test';
import { type MessageFormatElement, parse, TYPE } from '@formatjs/icu-messageformat-parser';
import { createTranslator } from 'use-intl/core';

const { default: messages } = await import('@/shared/i18n/messages');

type Tree = { [key: string]: string | Tree };
type Translate = (key: string, values?: Record<string, number>) => string;

const TIME_ZONE = 'Europe/Berlin';
const ENGLISH_GERMAN_EXEMPT = /^meta\.brand\./;

function flatten(tree: Tree, prefix = ''): Map<string, string> {
	const out = new Map<string, string>();
	for (const [key, value] of Object.entries(tree)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (typeof value === 'string') out.set(path, value);
		else for (const [inner, text] of flatten(value, path)) out.set(inner, text);
	}
	return out;
}

function collectArguments(elements: MessageFormatElement[], names: Set<string>): void {
	for (const element of elements) {
		if (element.type === TYPE.literal || element.type === TYPE.pound) continue;
		if (element.type === TYPE.tag) {
			collectArguments(element.children, names);
			continue;
		}
		names.add(element.value);
		if (element.type === TYPE.select || element.type === TYPE.plural) {
			for (const option of Object.values(element.options)) collectArguments(option.value, names);
		}
	}
}

/** Names of the ICU arguments in a message, from its AST; throws on malformed ICU. */
function argumentNames(message: string): string[] {
	const names = new Set<string>();
	collectArguments(parse(message), names);
	return [...names].sort();
}

const de = flatten(messages.de as Tree);
const en = flatten(messages.en as Tree);

function translator(locale: 'de' | 'en', source: object = messages[locale]): Translate {
	return createTranslator({
		locale,
		messages: source,
		timeZone: TIME_ZONE,
		onError: (error) => {
			throw error;
		},
	}) as unknown as Translate;
}

test('German and English catalogs hold the same keys', () => {
	assert.ok(de.size > 0);
	assert.deepEqual([...en.keys()].sort(), [...de.keys()].sort());
});

test('both catalogs use the same ICU argument names per key', () => {
	for (const [key, text] of de) {
		assert.deepEqual(argumentNames(en.get(key) ?? ''), argumentNames(text), key);
	}
});

test('no catalog value is empty', () => {
	for (const [locale, catalog] of [
		['de', de],
		['en', en],
	] as const) {
		for (const [key, text] of catalog) assert.notEqual(text.trim(), '', `${locale}:${key}`);
	}
});

test('every message renders with dummy arguments and leaves no brace behind', () => {
	for (const [locale, catalog] of [
		['de', de],
		['en', en],
	] as const) {
		const t = translator(locale);
		for (const [key, text] of catalog) {
			const values = Object.fromEntries(argumentNames(text).map((name) => [name, 1]));
			const rendered = t(key, values);
			assert.equal(typeof rendered, 'string', `${locale}:${key}`);
			assert.doesNotMatch(rendered, /[{}]/, `${locale}:${key} rendered ${rendered}`);
		}
	}
});

test('English values contain no sharp s or umlauts', () => {
	for (const [key, text] of en) {
		if (ENGLISH_GERMAN_EXEMPT.test(key)) continue;
		assert.doesNotMatch(text, /[äöüÄÖÜß]/, key);
	}
});

test('argument names come from the ICU tree, not from branch text', () => {
	assert.deepEqual(argumentNames('{gender, select, male {Er} other {Sie}}'), ['gender']);
	assert.deepEqual(argumentNames('{n, plural, one {# Tag} other {# Tage {name}}}'), ['n', 'name']);
	assert.throws(() => argumentNames('Hallo {name'));
});

test('the translator throws on malformed ICU and on missing arguments', () => {
	const t = translator('en', { broken: 'Hello {name', needsName: 'Hello {name}' });
	assert.throws(() => t('broken', { name: 1 }));
	assert.throws(() => t('needsName', { other: 1 }));
});
