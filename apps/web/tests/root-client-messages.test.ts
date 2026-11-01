import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import messages from '@/shared/i18n/messages';
import { pickMessages, ROOT_CLIENT_NAMESPACES } from '@/shared/i18n/root-client-messages';

const SRC = resolve(import.meta.dirname, '../src');
const PUBLIC_APP_DIRS = ['login', 'signup', 'invite', 'offline', 'auth', 'discover'];
// Reached only through the sign-out cleanup, which never shows a push error.
const NOT_RENDERED_PUBLICLY = ['settings.notifications.errors'];

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sources(path);
		return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
	});
}

function resolveImport(from: string, spec: string): string | undefined {
	const base = spec.startsWith('@/')
		? join(SRC, spec.slice(2))
		: spec.startsWith('.')
			? resolve(dirname(from), spec)
			: undefined;
	if (!base) return undefined;
	return [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find(
		(candidate) => existsSync(candidate) && statSync(candidate).isFile(),
	);
}

/** Message paths used by client code that the public (non-/wg) pages can reach. */
function publicClientPaths(): Map<string, string> {
	const app = join(SRC, 'app');
	const queue = [
		...['layout', 'page', 'error', 'global-error', 'not-found', 'EntryClient'].map((name) =>
			join(app, `${name}.tsx`),
		),
		...PUBLIC_APP_DIRS.flatMap((dir) => sources(join(app, dir))),
	].filter((file) => existsSync(file));
	const seen = new Set<string>();
	const paths = new Map<string, string>();
	for (let file = queue.pop(); file; file = queue.pop()) {
		if (seen.has(file)) continue;
		seen.add(file);
		const text = readFileSync(file, 'utf8');
		const where = relative(SRC, file);
		for (const match of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
			const target = resolveImport(file, match[1] as string);
			if (target) queue.push(target);
		}
		// Server components translate on the server and need nothing from the client provider.
		if (/^['"]use client['"]/m.test(text)) {
			for (const match of text.matchAll(/useTranslations\(\s*'([^']+)'/g)) {
				paths.set(match[1] as string, where);
			}
		}
		for (const match of text.matchAll(/\bkey:\s*'([\w-]+(?:\.[\w-]+)+)'/g)) {
			paths.set(match[1] as string, where);
		}
	}
	return paths;
}

const covered = (path: string) =>
	[...ROOT_CLIENT_NAMESPACES, ...NOT_RENDERED_PUBLICLY].some(
		(namespace) => path === namespace || path.startsWith(`${namespace}.`),
	);

test('every message path the public client code reads is in the root provider', () => {
	const missing = [...publicClientPaths()].filter(([path]) => !covered(path));
	assert.deepEqual(missing, []);
});

test('the root provider omits the /wg and server-only namespaces', () => {
	const picked = pickMessages(messages.de, ROOT_CLIENT_NAMESPACES);
	for (const namespace of ['chores', 'expenses-form', 'mail', 'meta', 'export', 'server-pages']) {
		assert.equal(namespace in picked, false, namespace);
	}
	assert.deepEqual(Object.keys(picked.settings as object).sort(), [
		'accountDelete',
		'actions',
		'profile',
	]);
	assert.deepEqual(picked.common, messages.de.common);
});
