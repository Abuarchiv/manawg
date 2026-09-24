import { readFile } from 'node:fs/promises';
import pathModule from 'node:path';
import { expect, test } from '@playwright/test';
import { serverError } from '../src/core/errors';
import { apiFetch } from '../src/core/infra/api-client';
import { logApiError } from '../src/core/infra/observability';
import { createPresignedUpload } from '../src/core/infra/s3';
import { toCsv } from '../src/core/reads/export';

async function readSource(relativePath: string): Promise<string> {
	return readFile(pathModule.join(process.cwd(), 'src', relativePath), 'utf8');
}

test('apiFetch rejects non-empty non-JSON success responses', async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () =>
		new Response('not json', {
			status: 200,
			statusText: 'OK',
			headers: { 'content-type': 'text/plain' },
		});
	try {
		await expect(apiFetch('/api/test')).resolves.toEqual({
			ok: false,
			status: 200,
			error: 'OK',
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('CSV formula guards remain quoted after neutralization', () => {
	expect(toCsv([{ value: '=1+1' }], ['value'])).toBe('value\n"\'=1+1"');
});

test('presigned uploads reject path traversal keys before configuration lookup', async () => {
	await expect(createPresignedUpload('../outside.png', 'image/png', 1)).rejects.toThrow(
		'Invalid S3 key',
	);
});

test('serverError reports a null value safely and retains sanitized route labels', () => {
	const originalError = console.error;
	const calls: unknown[][] = [];
	console.error = (...args: unknown[]) => calls.push(args);
	try {
		const rawMessage = 'private provider response payload';
		const thrown = new Error(rawMessage);
		thrown.name = 'privateDbPassword123';
		const response = serverError(null);
		logApiError('[test route GET]', thrown);

		expect(response.status).toBe(500);
		expect(calls[0]).toEqual(['[error]', 'Error', {}]);
		expect(calls[1]).toEqual(['[test route GET]', 'Error']);
		expect(calls.flat().some((value) => value instanceof Error)).toBe(false);
		expect(JSON.stringify(calls)).not.toContain(rawMessage);
		expect(JSON.stringify(calls)).not.toContain('privateDbPassword123');
		expect(JSON.stringify(calls)).not.toContain('server_error');
	} finally {
		console.error = originalError;
	}
});

test('audit failures use error-level logging', async () => {
	const source = await readSource('core/audit.ts');

	expect(source).toContain("console.error('[audit] event not recorded'");
	expect(source).not.toContain("console.warn('[audit] event not recorded'");
});

test('chat responses expose only persisted mentions', async () => {
	const source = await readSource('app/api/wg/[code]/chat/messages/route.ts');

	expect(source).toContain('const insertedMentionRows =');
	expect(source).toMatch(/\.onConflictDoNothing\(\)\s*\.returning\(\{/);
	expect(source).toContain('mentions: persistedMentionIds');
});

test('analytics privacy parsing uses the final path delimiter and explicit duplicate check', async () => {
	const source = await readFile(
		pathModule.join(process.cwd(), 'scripts', 'check-analytics-privacy.mjs'),
		'utf8',
	);

	expect(source).toContain("item.lastIndexOf(': ')");
	expect(source).toContain('duplicate');
});

test('members POST validates the JSON value without a PostBody assertion', async () => {
	const source = await readSource('app/api/wg/[code]/members/route.ts');

	expect(source).not.toContain('as PostBody');
	expect(source).toContain('isPostBody');
	expect(source).toContain('joinMemberSchema.safeParse');
});

test('bulk shopping clear requires the WG admin role', async () => {
	const source = await readSource('app/api/wg/[code]/shopping/route.ts');

	expect(source).toContain('isWgAdmin(wgId, auth.member.memberId)');
});

test('missing required environment variables reach the boot log', async () => {
	const source = await readSource('instrumentation.ts');

	expect(source).toContain('console.error(report)');
});

test('imports preview authenticates before reading the capped body', async () => {
	const source = await readSource('app/api/wg/[code]/imports/preview/route.ts');

	expect(source.indexOf('const auth = await requireWgMember')).toBeLessThan(
		source.indexOf('const raw = await readImportJsonBody'),
	);
});
