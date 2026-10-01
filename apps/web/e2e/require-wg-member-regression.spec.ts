import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { isShareCodeLookup } from '../src/middleware';

test('anonymous WG requests return auth_required before WG lookup', async ({ request }) => {
	for (const path of [
		'chat/messages',
		'dashboard',
		'expenses',
		'recurring-expenses',
		'chores',
		'absences',
	]) {
		const response = await request.get(`/api/wg/MTE8PZAT/${path}`, { timeout: 120_000 });

		expect(response.status(), path).toBe(401);
		expect(await response.json(), path).toEqual({
			error: 'auth_required',
			code: 'auth_required',
		});
	}
});

test('keeps account membership out of the share-code rate-limit bucket', () => {
	expect(isShareCodeLookup('/api/wg/mine', 'GET')).toBe(false);
	expect(isShareCodeLookup('/api/wg/ABCDEFGH', 'GET')).toBe(true);
	expect(isShareCodeLookup('/api/wg/INVALID', 'GET')).toBe(true);
	expect(isShareCodeLookup('/api/wg/ABCDEFGH', 'POST')).toBe(false);
});

test('WG root verifies identity before looking up a live share code', () => {
	const source = readFileSync(join(__dirname, '../src/app/api/wg/[code]/route.ts'), 'utf8');
	const getHandler = source
		.split('export async function GET(')[1]
		?.split('export async function PATCH(')[0];
	if (!getHandler) throw new Error('GET handler not found');
	expect(getHandler.indexOf('if (isE2EDbDownMode())')).toBeLessThan(
		getHandler.indexOf('getAuthenticatedUser(req)'),
	);
	expect(getHandler.indexOf('getAuthenticatedUser(req)')).toBeLessThan(
		getHandler.indexOf('db.query.wgs.findFirst('),
	);
	expect(getHandler).toContain('requireMember(req, wg.id, user)');
});
