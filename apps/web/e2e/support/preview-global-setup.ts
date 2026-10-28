import { existsSync, lstatSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type APIRequestContext, type FullConfig, request } from '@playwright/test';
import { assertPreviewOrigin } from '../../scripts/release-workflow-gates.mjs';

export default async function setupPreview(config: FullConfig) {
	const origin = assertPreviewOrigin(process.env.BASE_URL ?? '');
	const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
	const statePath = config.projects[0]?.use.storageState;
	if (!secret) throw new Error('Preview bootstrap requires the bypass credential.');
	if (typeof statePath !== 'string') throw new Error('Missing private Preview storage path.');
	const directory = path.dirname(path.resolve(statePath));
	if (
		statePath !== path.join(directory, 'state.json') ||
		path.dirname(directory) !== path.resolve(tmpdir()) ||
		!/^manawg-preview-auth-[a-z0-9]+$/i.test(path.basename(directory)) ||
		!lstatSync(directory).isDirectory() ||
		(lstatSync(directory).mode & 0o077) !== 0 ||
		existsSync(statePath)
	) {
		throw new Error('Preview bootstrap requires a new private temporary storage path.');
	}
	const cleanup = () => {
		if (existsSync(statePath)) unlinkSync(statePath);
		rmdirSync(directory);
	};
	let context: APIRequestContext | undefined;
	let complete = false;
	try {
		context = await request.newContext({
			extraHTTPHeaders: {
				'x-vercel-protection-bypass': secret,
				'x-vercel-set-bypass-cookie': 'true',
			},
		});
		await context.get(new URL('/api/health', origin).href, { maxRedirects: 0 });
		const state = await context.storageState();
		const cookie = state.cookies.find(
			(entry) =>
				entry.name === '_vercel_jwt' &&
				entry.domain.replace(/^\./, '') === new URL(origin).hostname &&
				entry.secure,
		);
		if (!cookie) throw new Error('Vercel did not issue a deployment-scoped Preview cookie.');
		const scopedCookie = { ...cookie, domain: new URL(origin).hostname, path: '/' };
		writeFileSync(statePath, JSON.stringify({ cookies: [scopedCookie], origins: [] }), {
			mode: 0o600,
			flag: 'wx',
		});
		complete = true;
		return cleanup;
	} catch {
		// Playwright errors may include request headers; never forward them.
		throw new Error('Authorized Preview bootstrap failed.');
	} finally {
		await context?.dispose().catch(() => undefined);
		if (!complete) cleanup();
	}
}
