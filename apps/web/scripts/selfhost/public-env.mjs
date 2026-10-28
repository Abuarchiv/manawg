#!/usr/bin/env node
/**
 * Next.js inlines `NEXT_PUBLIC_*` values at build time, so the published Docker image is built
 * with the placeholders below. On container start this replaces them in the build output with the
 * values of this instance; the image itself stays instance-neutral. Runs before `server.js` in the
 * Docker image (Dockerfile CMD).
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = 'manawg-selfhost';

/** The placeholder each variable is built with, and its value when the instance leaves it empty. */
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
		default: 'https://manawg.com',
	},
	// Error reports stay on the instance: without a support address they go to its sender address.
	NEXT_PUBLIC_SUPPORT_EMAIL: {
		placeholder: `support@${MARKER}.invalid`,
		fallback: 'SMTP_ADMIN_EMAIL',
	},
};

const TEXT_FILE = /\.(?:js|mjs|cjs|json|html|rsc|body|meta|txt|xml|webmanifest)$/;

/** Placeholder -> value pairs for this environment; full URLs before their bare hosts. */
export function replacements(env) {
	const pairs = [];
	const hosts = [];
	for (const [name, spec] of Object.entries(PUBLIC_ENV_PLACEHOLDERS)) {
		let value = env[name]?.trim() || (spec.fallback && env[spec.fallback]?.trim()) || spec.default;
		if (!value) throw new Error(`${name} is not set.`);
		if (spec.url) {
			const url = new URL(value);
			value = url.origin;
			hosts.push([new URL(spec.placeholder).host, url.host]);
		}
		pairs.push([spec.placeholder, value]);
	}
	return [...pairs, ...hosts];
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
	for await (const file of textFiles(path.join(appDir, '.next'))) {
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
