#!/usr/bin/env node
/**
 * Next.js inlines `NEXT_PUBLIC_*` values at build time, so the published Docker image is built
 * with the placeholders below. On container start this replaces them in the build output with the
 * values of this instance; the image itself stays instance-neutral. Runs before `server.js` in the
 * Docker image (Dockerfile CMD).
 */

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = 'manawg-selfhost';

/**
 * The placeholder each variable is built with, and what an empty value means: `fallback` names a
 * variable to use instead, `optional` leaves the value empty (the app then omits the feature).
 */
export const PUBLIC_ENV_PLACEHOLDERS = {
	NEXT_PUBLIC_APP_URL: { placeholder: `https://app.${MARKER}.invalid`, url: true },
	NEXT_PUBLIC_SUPABASE_URL: {
		placeholder: `https://supabase.${MARKER}.invalid`,
		url: true,
		fallback: 'NEXT_PUBLIC_APP_URL',
	},
	NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: { placeholder: `${MARKER}-publishable-key` },
	NEXT_PUBLIC_LEGAL_URL: {
		placeholder: `https://legal.${MARKER}.invalid`,
		url: true,
		optional: true,
	},
	// Error reports stay on the instance: without a support address they go to its sender address.
	NEXT_PUBLIC_SUPPORT_EMAIL: {
		placeholder: `support@${MARKER}.invalid`,
		fallback: 'SMTP_ADMIN_EMAIL',
	},
};

/**
 * Built in as Next's deployment id, which every asset URL carries as `?dpl=`. Chunk file names
 * hash the build, not these values, so the id changes with them: browsers and the service worker
 * then fetch chunks with the new values instead of serving cached ones.
 */
const ASSET_VERSION_PLACEHOLDER = `${MARKER}-config`;

const TEXT_FILE = /\.(?:js|mjs|cjs|json|html|rsc|body|meta|txt|xml|webmanifest)$/;

/** Placeholder -> value pairs for this environment; full URLs before their bare hosts. */
export function replacements(env) {
	const pairs = [];
	const hosts = [];
	for (const [name, spec] of Object.entries(PUBLIC_ENV_PLACEHOLDERS)) {
		let value = env[name]?.trim() || (spec.fallback && env[spec.fallback]?.trim()) || '';
		if (!value && !spec.optional) throw new Error(`${name} is not set.`);
		if (spec.url) {
			const url = value ? new URL(value) : null;
			value = url?.origin ?? '';
			hosts.push([new URL(spec.placeholder).host, url?.host ?? '']);
		}
		pairs.push([spec.placeholder, value]);
	}
	const version = createHash('sha256').update(JSON.stringify(pairs)).digest('hex').slice(0, 12);
	return [...pairs, ...hosts, [ASSET_VERSION_PLACEHOLDER, `c${version}`]];
}

export function replaceAll(text, pairs) {
	let result = text;
	for (const [placeholder, value] of pairs) result = result.replaceAll(placeholder, value);
	return result;
}

async function* textFiles(dir) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== 'cache') yield* textFiles(full);
		} else if (TEXT_FILE.test(entry.name)) {
			yield full;
		}
	}
}

async function main() {
	const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
	const pairs = replacements(process.env);
	let changed = 0;
	const leftovers = [];
	// server.js carries the Next config, deployment id included, inline.
	const files = [path.join(appDir, 'server.js')];
	for await (const file of textFiles(path.join(appDir, '.next'))) files.push(file);
	for (const file of files) {
		const text = await readFile(file, 'utf8');
		if (!text.includes(MARKER)) continue;
		const next = replaceAll(text, pairs);
		if (next !== text) {
			await writeFile(file, next);
			changed += 1;
		}
		if (next.includes(MARKER)) leftovers.push(path.relative(appDir, file));
	}
	process.stdout.write(`[public-env] ${changed} files configured for ${pairs[0][1]}\n`);
	if (leftovers.length > 0) {
		console.error(`[public-env] Unreplaced placeholders in: ${leftovers.slice(0, 5).join(', ')}`);
		process.exit(1);
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
